import {
  ForbiddenException,
  Injectable,
  Logger,
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
  ) {}

  private phone(config: VoiceInboundConfig) {
    return normalizeVoiceDialNumber(config.source, config);
  }

  private async offerScope(
    actor: UserWorkspaceAuthContext,
    config: VoiceInboundConfig,
  ) {
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
    if (
      !(await this.sessions.current(
        config,
        sessionId,
        actor.workspaceMemberId,
        action === 'accept',
      ))
    )
      throw unavailableInbound();
    const scope = await this.offerScope(actor, config);
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
        { ...scope, sql: `call.direction = 'inbound' AND (${scope.sql})` },
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

    // Only the opaque logical call ID is sent to the SDK. The browser reads CRM context through Twenty.
    const response = new Twilio.twiml.VoiceResponse();
    const client = response
      .dial({
        action: inboundProgressUrl(config, { id, parentSid, source: 'dial' }),
        method: 'POST',
        answerOnBridge: true,
        timeout: 25,
        timeLimit: 300,
        record: 'do-not-record',
      })
      .client({
        url: inboundProgressUrl(config, { id, parentSid, source: 'screen' }),
        method: 'POST',
        statusCallback: inboundProgressUrl(config, {
          id,
          parentSid,
          source: 'client',
        }),
        statusCallbackMethod: 'POST',
        statusCallbackEvent: [...DIAL_EVENTS],
      });
    client.identity(getVoiceInboundIdentity(config, route.sessionId));
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
        const ready = await this.sessions.readyActor(config);
        if (
          ready &&
          params.To ===
            `client:${getVoiceInboundIdentity(config, ready.sessionId)}`
        ) {
          const scope = await this.offerScope(ready.actor, config);
          allowed = await this.inbound.screen(
            config,
            event,
            ready.actor.workspaceMemberId,
            ready.sessionId,
            scope,
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
      await this.inbound.settle(config, event, progress, true);
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
