import {
  ForbiddenException,
  ConflictException,
  Injectable,
  Optional,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { type Request } from 'express';
import Twilio from 'twilio';
import { PermissionFlagType } from 'twenty-shared/constants';
import { z } from 'zod';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import {
  getInconnectVoiceConfig,
  getVoiceInboundConfig,
  type InconnectVoiceConfig,
  VOICE_INTENT_TTL_SECONDS,
  VOICE_TOKEN_TTL_SECONDS,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { InconnectVoiceDestinationService } from 'src/modules/inconnect-voice/inconnect-voice-destination.service';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';
import {
  canDialVoiceNumber,
  normalizeVoiceDialNumber,
  requireVoiceDialNumber,
} from 'src/modules/inconnect-voice/inconnect-voice-dial-number';
import { isTwilioCallSid } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';
import {
  InconnectVoiceProviderService,
  readSignedVoiceWebhook,
  voiceProgressUrl,
} from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

import {
  credentialSchema,
  getVoiceCredential,
  getVoiceIdentity,
  resolveVoiceActor,
  type VoiceAuthContext,
} from 'src/modules/inconnect-voice/inconnect-voice-actor';

import {
  getVoiceInboundIdentity,
  InconnectVoiceInboundSessionService,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';

const intentSchema = z
  .object({
    intentId: z.string().uuid(),
    recordId: z.string().uuid().nullable(),
    manual: z.literal(true).optional(),
    browserIdentity: z
      .string()
      .regex(/^inc_[a-f0-9_]+$/i)
      .optional(),
    actorMemberId: z.string().uuid(),
    destination: z.string(),
    callerId: z.string(),
    expiresAt: z.number().int(),
    credential: credentialSchema,
  })
  .strict()
  .refine((intent) => intent.recordId !== null || intent.manual === true);

const forbidden = () => new ForbiddenException('Voice call is unavailable');

const getIntentKey = (config: InconnectVoiceConfig, intentId: string) =>
  `inconnectVoice:intent:${config.accountSid}:${config.applicationSid}:${getVoiceIdentity(config)}:${intentId}`;

const consumeIntentScript = `
  local intent = redis.call('GET', KEYS[1])
  if not intent then return false end
  if redis.call('DEL', KEYS[1]) ~= 1 then return false end
  return intent
`;

@Injectable()
export class InconnectVoiceService {
  private readonly logger = new Logger(InconnectVoiceService.name);

  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly destination: InconnectVoiceDestinationService,
    private readonly redis: RedisClientService,
    private readonly encryption: SecretEncryptionService,
    private readonly calls: InconnectVoiceCallStore,
    private readonly provider: InconnectVoiceProviderService,
    private readonly directory: InconnectVoiceDirectoryService,
    private readonly permissions: PermissionsService,
    @Optional()
    private readonly inboundSessions?: InconnectVoiceInboundSessionService,
  ) {}

  status(context: VoiceAuthContext): {
    status: 'not-configured' | 'disabled' | 'ready';
  } {
    const config = getInconnectVoiceConfig();

    if (!config) return { status: 'not-configured' };
    resolveVoiceActor(context, config);

    return { status: config.enabled ? 'ready' : 'disabled' };
  }

  async phoneAccess(request: Request) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const inbound = getVoiceInboundConfig();
    const actor = resolveVoiceActor(
      request,
      inbound && request.userWorkspaceId === inbound.userWorkspaceId
        ? inbound
        : config,
    );
    await this.directory.rolePermissions(actor);

    return { available: true };
  }

  private async hasFlag(
    actor: UserWorkspaceAuthContext,
    flag: PermissionFlagType,
  ) {
    const { rolePermissionConfig } =
      await this.directory.rolePermissions(actor);
    return this.permissions.checkRolesPermissions(
      rolePermissionConfig,
      actor.workspace.id,
      flag,
    );
  }

  private async throttle(
    config: InconnectVoiceConfig,
    action: 'lookup' | 'manual-session',
    seconds: number,
  ) {
    let accepted: string | null;
    try {
      accepted = await this.redis
        .getClient()
        .set(getIntentKey(config, action), '1', 'EX', seconds, 'NX');
    } catch {
      throw new ServiceUnavailableException('Voice is unavailable');
    }
    if (accepted !== 'OK')
      throw new HttpException(
        'Too many Voice requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async lookup(request: Request, input: string, after?: string) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const actor = resolveVoiceActor(request, config);
    await this.throttle(config, 'lookup', 1);
    const phone = normalizeVoiceDialNumber(input, config);
    const result = await this.directory.lookup(actor, config, phone, after);
    const canCall = config.enabled && canDialVoiceNumber(phone, config);

    return {
      ...result,
      destination: phone.number,
      canCall,
      canCallUnlinked:
        !after &&
        result.candidates.length === 0 &&
        canCall &&
        (await this.hasFlag(actor, PermissionFlagType.DIAL_INCONNECT_VOICE)),
    };
  }

  private async manualAuthority(
    actor: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    input: string,
    recordId: string | null,
  ) {
    const phone = requireVoiceDialNumber(input, config);
    if (
      recordId === null &&
      !(await this.hasFlag(actor, PermissionFlagType.DIAL_INCONNECT_VOICE))
    )
      throw forbidden();

    // A zero visible match has the same outcome whether restricted Leads exist or not.
    // Recheck the authorized exact set in both the reservation and the routing claim.
    const scope = await this.directory.dialCondition(
      actor,
      config,
      phone,
      recordId,
    );
    return { destination: phone.number, scope };
  }

  async issue(
    request: Request,
    recordId: string | null,
    manualInput?: string,
    inboundSessionId?: string,
  ) {
    const config = getInconnectVoiceConfig();

    if (!config?.enabled)
      throw new ServiceUnavailableException('Outbound Voice is unavailable');

    const actor = resolveVoiceActor(request, config);
    const credential = getVoiceCredential(request);
    const manual = manualInput !== undefined;
    if (manual) await this.throttle(config, 'manual-session', 10);
    const { destination, scope } = manual
      ? await this.manualAuthority(actor, config, manualInput, recordId)
      : await this.linkedAuthority(actor, config, recordId);
    const inbound = getVoiceInboundConfig();
    const useRegisteredDevice = Boolean(
      inboundSessionId &&
      inbound &&
      inbound.userWorkspaceId === actor.userWorkspaceId &&
      (await this.inboundSessions?.current(
        inbound,
        inboundSessionId,
        actor.workspaceMemberId,
        false,
      )),
    );
    if (inboundSessionId && !useRegisteredDevice) throw forbidden();
    const browserIdentity =
      inboundSessionId && inbound
        ? getVoiceInboundIdentity(inbound, inboundSessionId)
        : getVoiceIdentity(config);
    const intentId = randomUUID();
    const intentExpiresAt = Date.now() + VOICE_INTENT_TTL_SECONDS * 1_000;
    const intent = {
      intentId,
      recordId,
      ...(manual ? { manual: true } : {}),
      ...(useRegisteredDevice ? { browserIdentity } : {}),
      actorMemberId: actor.workspaceMemberId,
      destination,
      expiresAt: intentExpiresAt,
      callerId: config.callerId,
      credential,
    };

    let stage:
      | 'encrypt-intent'
      | 'sign-token'
      | 'store-intent'
      | 'reserve-call' = 'encrypt-intent';
    let reason = 'operation-failed';

    try {
      // Seal only the original credential needed to revalidate this human at the callback.
      const sealed = this.encryption.encryptVersioned(
        plaintextStringSchema.parse(JSON.stringify(intent)),
        { workspaceId: config.workspaceId },
      );
      stage = 'sign-token';
      const token = new Twilio.jwt.AccessToken(
        config.accountSid,
        config.apiKeySid,
        config.apiKeySecret,
        {
          identity: browserIdentity,
          ttl: VOICE_TOKEN_TTL_SECONDS,
        },
      );
      token.addGrant(
        new Twilio.jwt.AccessToken.VoiceGrant({
          outgoingApplicationSid: config.applicationSid,
          incomingAllow: useRegisteredDevice,
        }),
      );
      const jwt = token.toJwt();
      stage = 'store-intent';
      const stored = await this.redis
        .getClient()
        .set(
          getIntentKey(config, intentId),
          sealed,
          'EX',
          VOICE_INTENT_TTL_SECONDS,
          'NX',
        );
      if (stored !== 'OK') {
        reason = 'intent-not-stored';
        throw forbidden();
      }

      stage = 'reserve-call';
      const authority = {
        workspaceId: actor.workspace.id,
        actorMemberId: actor.workspaceMemberId,
      };
      const recovery = await this.calls.leaseReconciliation(config, authority);
      if (recovery) await this.provider.reconcile(config, recovery);

      const actorLabel = [actor.user.firstName, actor.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (
        !(await this.calls.reserve(
          config,
          {
            ...authority,
            id: intentId,
            recordId,
            destination,
            expiresAt: intentExpiresAt,
          },
          actorLabel,
          scope,
        ))
      ) {
        throw new ConflictException(
          'Another Voice call is active or pending confirmation',
        );
      }

      return { token: jwt, intentId, intentExpiresAt, destination };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (stage === 'reserve-call' && error instanceof ForbiddenException)
        throw error;
      if (
        stage === 'store-intent' &&
        error instanceof Error &&
        error.message.startsWith('NOPERM ')
      ) {
        reason = 'redis-acl-denied';
      }

      // Redis errors may contain the key, account identifiers, or connection details.
      this.logger.warn({ event: 'voice-session-unavailable', stage, reason });
      throw new ServiceUnavailableException('Outbound Voice is unavailable');
    }
  }

  private async linkedAuthority(
    actor: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    recordId: string | null,
  ) {
    if (!recordId) throw forbidden();
    const destination = await this.destination.resolve(actor, config, recordId);
    const scope = await this.destination.getRecordCondition(actor, config);
    return { destination, scope };
  }

  async renderTwiml(request: Request & { rawBody?: Buffer }) {
    const config = getInconnectVoiceConfig();
    if (!config?.enabled) throw forbidden();
    let reservation:
      | Parameters<InconnectVoiceCallStore['denyRouting']>[1]
      | undefined;

    try {
      const params = readSignedVoiceWebhook(request, config, config.voiceUrl);
      if (
        (params.From !== `client:${getVoiceIdentity(config)}` &&
          !params.From?.startsWith(`client:${getVoiceIdentity(config)}_`)) ||
        !isTwilioCallSid(params.CallSid) ||
        !z.string().uuid().safeParse(params.intentId).success
      ) {
        throw forbidden();
      }

      // Consume before any remote instructions can be returned, including concurrent retries.
      const sealed = await this.redis
        .getClient()
        .eval(consumeIntentScript, 1, getIntentKey(config, params.intentId));
      if (typeof sealed !== 'string') throw forbidden();
      const intent = intentSchema.parse(
        JSON.parse(
          this.encryption.decryptVersionedOrThrow(sealed as EncryptedString, {
            workspaceId: config.workspaceId,
          }),
        ),
      );
      if (
        intent.intentId !== params.intentId ||
        params.From !==
          `client:${intent.browserIdentity ?? getVoiceIdentity(config)}` ||
        intent.expiresAt <= Date.now() ||
        intent.callerId !== config.callerId
      )
        throw forbidden();

      reservation = {
        id: intent.intentId,
        workspaceId: config.workspaceId,
        actorMemberId: intent.actorMemberId,
        recordId: intent.recordId,
        destination: intent.destination,
        expiresAt: intent.expiresAt,
      };

      // The standard validator uses only the credential headers for this request shape.
      const auth = await this.accessTokens.validateTokenByRequest({
        headers: intent.credential,
      } as Request);
      const actor = resolveVoiceActor(auth, config);
      if (actor.workspaceMemberId !== intent.actorMemberId) throw forbidden();
      const { destination, scope } = intent.manual
        ? await this.manualAuthority(
            actor,
            config,
            intent.destination,
            intent.recordId,
          )
        : await this.linkedAuthority(actor, config, intent.recordId);
      if (destination !== intent.destination || intent.expiresAt <= Date.now())
        throw forbidden();

      const response = new Twilio.twiml.VoiceResponse();
      response
        .dial({
          action: voiceProgressUrl(config, intent.intentId, 'dial'),
          method: 'POST',
          callerId: config.callerId,
          record: 'do-not-record',
          timeLimit: 300,
        })
        .number(
          {
            statusCallback: voiceProgressUrl(config, intent.intentId, 'number'),
            statusCallbackMethod: 'POST',
            statusCallbackEvent: [
              'initiated',
              'ringing',
              'answered',
              'completed',
            ],
          },
          destination,
        );

      if (!(await this.calls.claim(config, reservation, params.CallSid, scope)))
        throw forbidden();

      return response.toString();
    } catch {
      if (reservation) {
        try {
          await this.calls.denyRouting(config, reservation);
        } catch {
          this.logger.warn('Voice routing denial could not be persisted');
        }
      }
      throw forbidden();
    }
  }

  async progressCallback(request: Request & { rawBody?: Buffer }) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    try {
      return await this.provider.callback(request, config);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      // Failed persistence must remain retryable and must not expose bound SQL parameters.
      throw new ServiceUnavailableException('Voice callback is unavailable');
    }
  }

  private async historyAuthority(request: Request, recordId: string) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const inbound = getVoiceInboundConfig();
    const baseHistory =
      request.userWorkspaceId === config.userWorkspaceId ||
      (request.userWorkspaceId &&
        config.historyUserWorkspaceIds.includes(request.userWorkspaceId));
    const actor = resolveVoiceActor(
      request,
      baseHistory ? config : (inbound ?? config),
      true,
    );
    const scope = await this.destination.authorizeHistory(
      actor,
      config,
      recordId,
    );

    return {
      config,
      scope: baseHistory
        ? scope
        : {
            ...scope,
            sql: `call.direction = 'inbound' AND call."actorMemberId" = :inboundHistoryMember AND (${scope.sql})`,
            parameters: {
              ...scope.parameters,
              inboundHistoryMember: actor.workspaceMemberId,
            },
          },
      authority: {
        workspaceId: actor.workspace.id,
        actorMemberId: actor.workspaceMemberId,
      },
    };
  }

  async historyAccess(request: Request, recordId: string) {
    const { config } = await this.historyAuthority(request, recordId);
    return { objectMetadataId: config.objectId };
  }

  async history(request: Request, recordId: string, before?: string) {
    const { config, scope, authority } = await this.historyAuthority(
      request,
      recordId,
    );
    const data = await this.calls.history(
      config,
      recordId,
      scope,
      authority.actorMemberId,
      before,
    );
    if (!data)
      throw new ServiceUnavailableException('Voice history is unavailable');

    return {
      ...data,
      rows: data.rows.slice(0, 20),
      next: data.rows.length > 20 ? data.rows[19].id : null,
    };
  }

  async recents(request: Request, before?: string) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const inbound = getVoiceInboundConfig();
    const canReadOutbound = request.userWorkspaceId === config.userWorkspaceId;
    const actor = resolveVoiceActor(
      request,
      canReadOutbound ? config : (inbound ?? config),
    );
    const unlinked = await this.hasFlag(
      actor,
      PermissionFlagType.READ_UNLINKED_INCONNECT_VOICE_HISTORY,
    );
    const conditions =
      canReadOutbound && unlinked
        ? [
            `(call.direction = 'outbound' AND call."recordId" IS NULL AND call."objectMetadataId" IS NULL)`,
          ]
        : [];
    let name = 'NULL::text';
    let parameters: Record<string, unknown> = {};
    try {
      const phone = normalizeVoiceDialNumber(config.allowedDestination, config);
      const lead = canReadOutbound
        ? await this.directory.query(actor, config, phone)
        : null;
      if (lead) {
        lead.query.andWhere(`${lead.id} = call."recordId"`);
        conditions.push(`(call.direction = 'outbound' AND call."objectMetadataId" = :voiceObjectId AND call.destination = :voiceRecentDestination
        AND EXISTS (${lead.query.clone().select('1').getQuery()}))`);
        name = `CASE WHEN call."recordId" IS NOT NULL THEN (${lead.query.select(lead.name).getQuery()}) END`;
        parameters = {
          ...lead.query.getParameters(),
          voiceObjectId: config.objectId,
          voiceRecentDestination: phone.number,
        };
      }
    } catch (error) {
      if (!(error instanceof ForbiddenException) || !unlinked) throw error;
    }

    if (inbound && request.userWorkspaceId === inbound.userWorkspaceId) {
      try {
        const phone = normalizeVoiceDialNumber(inbound.source, inbound);
        const lead = await this.directory.query(actor, inbound, phone);
        lead.query.andWhere(`${lead.id} = call."recordId"`);
        const ownParams = lead.query.getParameters();
        const namespace = (sql: string) =>
          sql.replace(
            /(?<!:):(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/g,
            (original: string, spread: string | undefined, key: string) =>
              Object.prototype.hasOwnProperty.call(ownParams, key)
                ? `:${spread ?? ''}inbound_${key}`
                : original,
          );
        conditions.push(`(call.direction = 'inbound' AND call."objectMetadataId" = :inboundObject
          AND call."callerId" = :inboundSource AND call.destination = :inboundReceiver
          AND EXISTS (${namespace(lead.query.clone().select('1').getQuery())}))`);
        name = `CASE WHEN call.direction = 'inbound' THEN (${namespace(lead.query.select(lead.name).getQuery())}) ELSE ${name} END`;
        parameters = {
          ...parameters,
          ...Object.fromEntries(
            Object.entries(ownParams).map(([key, value]) => [
              `inbound_${key}`,
              value,
            ]),
          ),
          inboundObject: inbound.objectId,
          inboundSource: phone.number,
          inboundReceiver: inbound.receiver,
        };
      } catch (error) {
        if (!(error instanceof ForbiddenException) || !conditions.length)
          throw error;
      }
    }

    return this.calls.recents(
      {
        workspaceId: actor.workspace.id,
        actorMemberId: actor.workspaceMemberId,
      },
      { sql: `(${conditions.join(' OR ') || 'FALSE'})`, parameters },
      name,
      before,
    );
  }

  async callStatus(
    request: Request,
    recordId: string | null,
    callId: string,
    action?: 'cancel' | 'reconcile',
    manual = false,
  ) {
    const getAuthority = () =>
      recordId === null
        ? this.unlinkedProgressAuthority(request)
        : manual
          ? this.linkedProgressAuthority(request, recordId)
          : this.historyAuthority(request, recordId);
    const { config, scope, authority } = await getAuthority();
    const read = (condition: typeof scope) =>
      this.calls.callStatus(
        config,
        recordId,
        condition,
        callId,
        authority.actorMemberId,
      );
    const current = await read(scope);
    if (!current) throw forbidden();
    if (!action) return { ...current, observedAt: Date.now() };

    if (action === 'cancel' || current.status === 'reserved') {
      await this.calls.cancelReservation(
        authority,
        callId,
        action !== 'cancel',
        scope,
      );
    } else {
      const target = await this.calls.leaseReconciliation(
        config,
        authority,
        callId,
        { ...scope, sql: `call.direction = 'outbound' AND (${scope.sql})` },
      );
      if (target) await this.provider.reconcile(config, target);
    }

    const refreshed = await getAuthority();
    const updated = await read(refreshed.scope);
    if (!updated) throw forbidden();
    return { ...updated, observedAt: Date.now() };
  }

  private async linkedProgressAuthority(request: Request, recordId: string) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const actor = resolveVoiceActor(request, config);
    const phone = normalizeVoiceDialNumber(config.allowedDestination, config);
    const scope = await this.directory.dialCondition(
      actor,
      config,
      phone,
      recordId,
    );
    return {
      config,
      scope: {
        sql: `call."objectMetadataId" = :voiceProgressObject AND call."recordId" = :voiceProgressRecord
          AND call.destination = :voiceProgressDestination AND (${scope.sql})`,
        parameters: {
          ...scope.parameters,
          voiceProgressObject: config.objectId,
          voiceProgressRecord: recordId,
          voiceProgressDestination: phone.number,
        },
      },
      authority: {
        workspaceId: actor.workspace.id,
        actorMemberId: actor.workspaceMemberId,
      },
    };
  }

  private async unlinkedProgressAuthority(request: Request) {
    const config = getInconnectVoiceConfig();
    if (!config) throw forbidden();
    const actor = resolveVoiceActor(request, config);
    if (!(await this.hasFlag(actor, PermissionFlagType.DIAL_INCONNECT_VOICE)))
      throw forbidden();

    return {
      config,
      scope: {
        sql: `call."objectMetadataId" IS NULL AND call."recordId" IS NULL
          AND call."expiresAt" > clock_timestamp() - interval '8 minutes'`,
        parameters: {},
      },
      authority: {
        workspaceId: actor.workspace.id,
        actorMemberId: actor.workspaceMemberId,
      },
    };
  }
}
