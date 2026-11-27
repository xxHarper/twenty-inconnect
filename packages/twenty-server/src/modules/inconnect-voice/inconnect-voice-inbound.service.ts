import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { type Request } from 'express';
import Twilio from 'twilio';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import {
  INCONNECT_VOICE_PATH,
  type VoiceInboundConfig,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import {
  type VoiceInboundPlan,
  type VoiceInboundCandidate,
} from 'src/modules/inconnect-voice/inconnect-voice-distribution.store';
import { normalizeVoiceDialNumber } from 'src/modules/inconnect-voice/inconnect-voice-dial-number';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';
import {
  getVoiceInboundIdentity,
  InconnectVoiceInboundSessionService,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';
import {
  type InboundRoute,
  InconnectVoiceInboundStore,
  unavailableInbound,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound.store';
import { InconnectVoiceRoutingService } from 'src/modules/inconnect-voice/inconnect-voice-routing.service';
import {
  isTwilioCallSid,
  readTwilioProgress,
} from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';
import {
  InconnectVoiceProviderService,
  readSignedVoiceWebhook,
} from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

const PROGRESS_PATH = `/${INCONNECT_VOICE_PATH}/inbound-progress`;
const DIAL_EVENTS = ['initiated', 'ringing', 'answered', 'completed'] as const;
type SignedRequest = Request & { rawBody?: Buffer };
type Source = 'dial' | 'client' | 'screen';
const isCallbackSource = (input: string): input is Source =>
  input === 'dial' || input === 'client' || input === 'screen';

export const inboundProgressUrl = (
  config: VoiceInboundConfig,
  target?: { id: string; parentSid: string; source: Source },
) =>
  new URL(
    target
      ? `${PROGRESS_PATH}?id=${target.id}&parent=${target.parentSid}&source=${target.source}`
      : PROGRESS_PATH,
    config.inboundUrl,
  ).href;

const rejected = () => {
  const response = new Twilio.twiml.VoiceResponse();
  response.reject({ reason: 'rejected' });
  return response.toString();
};

@Injectable()
export class InconnectVoiceInboundService {
  private readonly logger = new Logger(InconnectVoiceInboundService.name);

  constructor(
    private readonly directory: InconnectVoiceDirectoryService,
    private readonly sessions: InconnectVoiceInboundSessionService,
    private readonly inbound: InconnectVoiceInboundStore,
    private readonly calls: InconnectVoiceCallStore,
    private readonly provider: InconnectVoiceProviderService,
    @Optional() private readonly routing?: InconnectVoiceRoutingService,
  ) {}

  private phone(config: VoiceInboundConfig) {
    return normalizeVoiceDialNumber(config.source, config);
  }

  private async offerScope(
    actor: UserWorkspaceAuthContext,
    config: VoiceInboundConfig,
  ) {
    if (config.distribution) {
      try {
        const lead = await this.directory.query(
          actor,
          config,
          this.phone(config),
        );
        const exact = lead.query.andWhere(`${lead.id} = call."recordId"`);
        return {
          sql: 'TRUE',
          name: `(${exact.clone().select(lead.name).getQuery()})`,
          visibleRecordId: `(${exact.select(lead.id).getQuery()})`,
          parameters: exact.getParameters(),
        };
      } catch {
        return {
          sql: 'TRUE',
          name: 'NULL::text',
          visibleRecordId: 'NULL::uuid',
          parameters: {},
        };
      }
    }
    const lead = await this.directory.query(
      actor,
      config,
      this.phone(config),
      true,
    );
    const exact = lead.query.andWhere(`${lead.id} = call."recordId"`);
    return {
      sql: `EXISTS (${exact.clone().select('1').getQuery()})`,
      name: `(${exact.select(lead.name).getQuery()})`,
      parameters: exact.getParameters(),
    };
  }

  async offer(
    request: Request,
    config: VoiceInboundConfig,
    id: string,
    sessionId: string,
    action?: 'accept' | 'decline' | 'reconcile',
  ) {
    const actor = await this.sessions.authorize(request, config);
    const mayReceive = config.distribution
      ? await this.sessions.canReceiveOffer(config, actor, sessionId)
      : await this.sessions.current(
          config,
          sessionId,
          actor.workspaceMemberId,
          action === 'accept',
        );
    if (
      !mayReceive &&
      (!config.distribution || action === 'accept' || action === 'decline')
    )
      throw unavailableInbound();
    const visibleScope = await this.offerScope(actor, config);
    // Revocation blocks new offers. An already screened call keeps its own progress channel.
    const scope = mayReceive
      ? visibleScope
      : {
          ...visibleScope,
          sql: `call."inboundScreenedAt" IS NOT NULL AND (${visibleScope.sql})`,
        };
    if (action === 'accept' || action === 'decline') {
      await this.inbound.decide(
        config,
        id,
        actor.workspaceMemberId,
        sessionId,
        scope,
        action,
      );
    }
    if (action === 'reconcile') {
      const target = await this.calls.leaseReconciliation(
        config,
        {
          workspaceId: config.workspaceId,
          actorMemberId: actor.workspaceMemberId,
        },
        id,
        {
          ...scope,
          sql: `call.direction = 'inbound' AND call."inboundSessionId" = :voiceInboundActorSession AND (${scope.sql})`,
          parameters: {
            ...scope.parameters,
            voiceInboundActorSession: sessionId,
          },
        },
      );
      if (target) await this.provider.reconcile(config, target);
    }
    const offer = await this.inbound.read(
      config,
      id,
      actor.workspaceMemberId,
      sessionId,
      scope,
    );
    return { ...offer, observedAt: Date.now() };
  }

  private async resolve(
    config: VoiceInboundConfig,
  ): Promise<InboundRoute | null> {
    const ready = await this.sessions.readyActor(config);
    if (!ready) return null;

    const { actor, sessionId } = ready;
    const lead = await this.directory.query(
      actor,
      config,
      this.phone(config),
      true,
    );
    const match = await lead.query
      .clone()
      .select(lead.id, 'recordId')
      .limit(1)
      .getRawOne<{ recordId: string }>();
    if (
      !match ||
      !(await this.sessions.current(config, sessionId, actor.workspaceMemberId))
    )
      return null;

    return {
      actorMemberId: actor.workspaceMemberId,
      actorLabel: [actor.user.firstName, actor.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim(),
      recordId: match.recordId,
      sessionId,
      scope: {
        sql: `EXISTS (${lead.query.select('1').andWhere(`${lead.id} = call."recordId"`).getQuery()})`,
        parameters: lead.query.getParameters(),
      },
    };
  }

  private async stillAvailable(
    config: VoiceInboundConfig,
    candidate: VoiceInboundCandidate,
  ) {
    try {
      const fresh = await this.sessions.candidate(
        config,
        candidate.userWorkspaceId,
      );
      return (
        fresh?.sessionId === candidate.sessionId &&
        fresh.actor.workspaceMemberId === candidate.actorMemberId
      );
    } catch {
      return false;
    }
  }

  async receive(request: SignedRequest, config: VoiceInboundConfig) {
    if (!config.inboundEnabled) throw unavailableInbound();
    const params = readSignedVoiceWebhook(request, config, config.inboundUrl);
    if (
      !isTwilioCallSid(params.CallSid) ||
      params.Direction !== 'inbound' ||
      params.ParentCallSid ||
      params.To !== config.receiver
    )
      throw unavailableInbound();

    if (!this.isAllowedSource(params.From, config)) return rejected();

    if (config.distribution) {
      let plan: VoiceInboundPlan;
      try {
        plan = this.routing
          ? await this.routing.plan(config)
          : { reason: 'configuration-incomplete' };
      } catch {
        plan = { reason: 'resolution-error' };
        this.logger.warn(
          'Inbound Voice routing authority could not be resolved',
        );
      }
      const id = randomUUID();
      const selected = await this.inbound.distribute(
        config,
        id,
        params.CallSid,
        plan,
        (candidate) => this.stillAvailable(config, candidate),
      );
      return selected
        ? this.dial(config, id, params.CallSid, selected)
        : rejected();
    }

    let route: InboundRoute | null = null;
    let failure = false;
    try {
      route = await this.resolve(config);
      if (route) {
        const recovery = await this.calls.leaseReconciliation(config, {
          workspaceId: config.workspaceId,
          actorMemberId: route.actorMemberId,
        });
        if (recovery) await this.provider.reconcile(config, recovery);
      }
    } catch {
      route = null;
      failure = true;
      this.logger.warn(
        'Inbound Voice pilot routing could not establish authority',
      );
    }

    const id = randomUUID();
    const parentSid = params.CallSid;
    if (
      !(await this.inbound.create(config, id, parentSid, route, failure)) ||
      !route
    )
      return rejected();

    return this.dial(config, id, parentSid, route);
  }

  private dial(
    config: VoiceInboundConfig,
    id: string,
    parentSid: string,
    route: Pick<VoiceInboundCandidate, 'sessionId'> &
      Partial<Pick<VoiceInboundCandidate, 'userWorkspaceId'>> & {
        offerId?: string;
        ringSeconds?: number;
      },
  ) {
    // Only the opaque logical call ID is sent to the SDK. The browser reads CRM context through Twenty.
    const response = new Twilio.twiml.VoiceResponse();
    const callback = { id: route.offerId ?? id, parentSid };
    const client = response
      .dial({
        action: inboundProgressUrl(config, { ...callback, source: 'dial' }),
        method: 'POST',
        answerOnBridge: true,
        timeout: route.ringSeconds ?? config.distribution?.ringSeconds ?? 25,
        timeLimit: 300,
        record: 'do-not-record',
      })
      .client({
        url: inboundProgressUrl(config, { ...callback, source: 'screen' }),
        method: 'POST',
        statusCallback: inboundProgressUrl(config, {
          ...callback,
          source: 'client',
        }),
        statusCallbackMethod: 'POST',
        statusCallbackEvent: [...DIAL_EVENTS],
      });
    client.identity(
      getVoiceInboundIdentity(config, route.sessionId, route.userWorkspaceId),
    );
    client.parameter({ name: 'inconnectVoiceCallId', value: id });
    return response.toString();
  }

  private isAllowedSource(
    input: string | undefined,
    config: VoiceInboundConfig,
  ) {
    if (!input || !/^\+[1-9]\d{6,14}$/.test(input)) return false;
    try {
      return normalizeVoiceDialNumber(input, config).number === config.source;
    } catch {
      return false;
    }
  }

  async callback(request: SignedRequest, config: VoiceInboundConfig) {
    const response = new Twilio.twiml.VoiceResponse();
    if (request.originalUrl === PROGRESS_PATH) {
      const params = readSignedVoiceWebhook(
        request,
        config,
        inboundProgressUrl(config),
      );
      if (
        !isTwilioCallSid(params.CallSid) ||
        params.To !== config.receiver ||
        params.Direction !== 'inbound'
      )
        throw unavailableInbound();
      if (!this.isAllowedSource(params.From, config))
        return response.toString();

      const progress = readTwilioProgress({
        status: params.CallStatus,
        eventTime: params.Timestamp,
      });
      if (progress?.status === 'finished') {
        const target = await this.inbound.settle(
          config,
          { id: null, parentSid: params.CallSid, childSid: null },
          progress,
          false,
        );
        if (target) await this.provider.reconcile(config, target);
      }
      return response.toString();
    }

    const match =
      /\?id=([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})&parent=(CA[a-fA-F0-9]{32})&source=(dial|client|screen)$/.exec(
        request.originalUrl,
      );
    if (!match || !isCallbackSource(match[3])) throw unavailableInbound();
    const [, id, parentSid, source] = match;
    const params = readSignedVoiceWebhook(
      request,
      config,
      inboundProgressUrl(config, { id, parentSid, source }),
    );
    const dial = source === 'dial';
    const childSid = dial ? params.DialCallSid || null : params.CallSid;
    if (
      (childSid !== null &&
        (!isTwilioCallSid(childSid) || childSid === parentSid)) ||
      (dial &&
        (params.CallSid !== parentSid || params.To !== config.receiver)) ||
      (source === 'client' &&
        (params.ParentCallSid !== parentSid ||
          params.CallbackSource !== 'call-progress-events')) ||
      (source === 'screen' &&
        params.ParentCallSid &&
        params.ParentCallSid !== parentSid)
    )
      throw unavailableInbound();

    const event = { id, parentSid, childSid };
    if (source === 'screen') {
      let allowed = false;
      try {
        const ready = config.distribution
          ? await this.sessions.screenActor(config, params.To)
          : await this.sessions.readyActor(config);
        if (
          ready &&
          params.To ===
            `client:${getVoiceInboundIdentity(config, ready.sessionId, config.distribution ? ready.actor.userWorkspaceId : undefined)}`
        ) {
          const scope = await this.offerScope(ready.actor, config);
          allowed = await this.inbound.screen(
            config,
            event,
            ready.actor.workspaceMemberId,
            ready.sessionId,
            scope,
            ...(config.distribution
              ? ([
                  () =>
                    this.sessions.canReceiveOffer(
                      config,
                      ready.actor,
                      ready.sessionId,
                    ),
                ] as const)
              : []),
          );
        }
      } catch {
        this.logger.warn('Inbound Voice bridge authorization failed');
      }
      if (!allowed) response.hangup();
    } else if (source === 'client') {
      const progress = readTwilioProgress({ status: params.CallStatus });
      if (!progress) throw unavailableInbound();
      const target = await this.inbound.progress(
        config,
        event,
        progress.status === 'finished',
      );
      if (target) await this.provider.reconcile(config, target);
    } else {
      if (params.DialBridged !== 'true' && params.DialBridged !== 'false')
        throw unavailableInbound();
      const bridged = params.DialBridged === 'true';
      if (bridged && (params.DialCallStatus !== 'completed' || !childSid))
        throw unavailableInbound();
      const progress = readTwilioProgress({
        status: bridged
          ? 'completed'
          : params.DialCallStatus === 'completed'
            ? 'failed'
            : params.DialCallStatus,
        duration: bridged ? params.DialCallDuration : undefined,
        eventTime: params.Timestamp,
      });
      if (progress?.status !== 'finished') throw unavailableInbound();
      if (config.distribution) {
        let nextPlan: VoiceInboundPlan | null = null;
        if (
          !bridged &&
          progress.result !== 'canceled' &&
          config.distribution.retryUnanswered &&
          this.routing &&
          (await this.provider.hasActiveInboundCaller(config, parentSid))
        ) {
          try {
            nextPlan = await this.routing.plan(config, true);
          } catch {
            this.logger.warn(
              'Inbound Voice retry authority could not be resolved',
            );
          }
        }
        const completed = await this.inbound.completeDistribution(
          config,
          event,
          progress,
          nextPlan,
          (candidate) => this.stillAvailable(config, candidate),
        );
        if (completed.kind === 'next')
          return this.dial(
            config,
            completed.callId,
            parentSid,
            completed.selected,
          );
        if (completed.kind === 'duplicate') return response.toString();
      } else {
        await this.inbound.settle(config, event, progress, true);
      }
      response.hangup();
    }
    return response.toString();
  }
}

export const runInboundCallback = async (operation: () => Promise<string>) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ForbiddenException) throw error;
    throw new ServiceUnavailableException(
      'Inbound Voice callback is unavailable',
    );
  }
};
