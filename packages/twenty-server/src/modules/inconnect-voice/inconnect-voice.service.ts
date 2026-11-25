import {
  ForbiddenException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { type Request } from 'express';
import Twilio from 'twilio';
import { z } from 'zod';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type RawAuthContext } from 'src/engine/core-modules/auth/types/raw-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { USER_SESSION_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-cookie-name.constant';
import { USER_SESSION_SECURE_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-secure-cookie-name.constant';
import {
  getInconnectVoiceConfig,
  type InconnectVoiceConfig,
  VOICE_INTENT_TTL_SECONDS,
  VOICE_TOKEN_TTL_SECONDS,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { InconnectVoiceDestinationService } from 'src/modules/inconnect-voice/inconnect-voice-destination.service';
import { isTwilioCallSid } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';
import {
  InconnectVoiceProviderService,
  readSignedVoiceWebhook,
  voiceProgressUrl,
} from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

const credentialSchema = z.union([
  z
    .object({
      authorization: z
        .string()
        .max(8192)
        .regex(/^Bearer [\w.\-]+$/i),
    })
    .strict(),
  z.object({ cookie: z.string().min(1).max(8192) }).strict(),
]);

const intentSchema = z
  .object({
    intentId: z.string().uuid(),
    recordId: z.string().uuid(),
    actorMemberId: z.string().uuid(),
    destination: z.string(),
    callerId: z.string(),
    expiresAt: z.number().int(),
    credential: credentialSchema,
  })
  .strict();

const forbidden = () => new ForbiddenException('Voice call is unavailable');

type VoiceAuthContext = Pick<
  RawAuthContext,
  | 'user'
  | 'workspace'
  | 'workspaceMember'
  | 'workspaceMemberId'
  | 'userWorkspaceId'
  | 'tokenType'
  | 'application'
  | 'apiKey'
  | 'impersonationContext'
>;

const resolveActor = (
  context: VoiceAuthContext,
  config: InconnectVoiceConfig,
  allowHistory = false,
) => {
  const {
    user,
    workspace,
    workspaceMember,
    workspaceMemberId,
    userWorkspaceId,
  } = context;

  if (
    context.tokenType !== JwtTokenTypeEnum.ACCESS ||
    context.application ||
    context.apiKey ||
    context.impersonationContext?.impersonatorUserWorkspaceId ||
    context.impersonationContext?.impersonatedUserWorkspaceId ||
    !user ||
    !workspace ||
    !workspaceMember ||
    !workspaceMemberId ||
    !userWorkspaceId ||
    workspace.id !== config.workspaceId ||
    (userWorkspaceId !== config.userWorkspaceId &&
      !(
        allowHistory && config.historyUserWorkspaceIds.includes(userWorkspaceId)
      )) ||
    workspaceMember.id !== workspaceMemberId ||
    workspaceMember.userId !== user.id
  ) {
    throw forbidden();
  }

  return buildUserAuthContext({
    user,
    workspace,
    workspaceMember,
    workspaceMemberId,
    userWorkspaceId,
  });
};

const getCredential = (request: Request) => {
  const { authorization, cookie } = request.headers;
  const sessionNames = [
    USER_SESSION_COOKIE_NAME,
    USER_SESSION_SECURE_COOKIE_NAME,
  ];
  const sessionCookies = cookie
    ?.split(';')
    .map((entry) => entry.trim())
    .filter((entry) =>
      sessionNames.some((name) => entry.startsWith(`${name}=`)),
    )
    .join('; ');
  const parsed = credentialSchema.safeParse(
    authorization === undefined
      ? { cookie: sessionCookies }
      : { authorization },
  );

  if (!parsed.success) throw forbidden();

  return parsed.data;
};

const getIdentity = ({ workspaceId, userWorkspaceId }: InconnectVoiceConfig) =>
  `inc_${workspaceId.replace(/-/g, '')}_${userWorkspaceId.replace(/-/g, '')}`;

const getIntentKey = (config: InconnectVoiceConfig, intentId: string) =>
  `inconnectVoice:intent:${config.accountSid}:${config.applicationSid}:${getIdentity(config)}:${intentId}`;

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
  ) {}

  status(context: VoiceAuthContext): {
    status: 'not-configured' | 'disabled' | 'ready';
  } {
    const config = getInconnectVoiceConfig();

    if (!config) return { status: 'not-configured' };
    resolveActor(context, config);

    return { status: config.enabled ? 'ready' : 'disabled' };
  }

  async issue(request: Request, recordId: string) {
    const config = getInconnectVoiceConfig();

    if (!config?.enabled)
      throw new ServiceUnavailableException('Outbound Voice is unavailable');

    const actor = resolveActor(request, config);
    const credential = getCredential(request);
    const destination = await this.destination.resolve(actor, config, recordId);
    const intentId = randomUUID();
    const intentExpiresAt = Date.now() + VOICE_INTENT_TTL_SECONDS * 1_000;
    const intent = {
      intentId,
      recordId,
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
          identity: getIdentity(config),
          ttl: VOICE_TOKEN_TTL_SECONDS,
        },
      );
      token.addGrant(
        new Twilio.jwt.AccessToken.VoiceGrant({
          outgoingApplicationSid: config.applicationSid,
          incomingAllow: false,
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
      const scope = await this.destination.getRecordCondition(actor, config);
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

  async renderTwiml(request: Request & { rawBody?: Buffer }) {
    const config = getInconnectVoiceConfig();
    if (!config?.enabled) throw forbidden();
    let reservation:
      | Parameters<InconnectVoiceCallStore['denyRouting']>[1]
      | undefined;

    try {
      const params = readSignedVoiceWebhook(request, config, config.voiceUrl);
      if (
        params.From !== `client:${getIdentity(config)}` ||
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
      const actor = resolveActor(auth, config);
      if (actor.workspaceMemberId !== intent.actorMemberId) throw forbidden();
      const destination = await this.destination.resolve(
        actor,
        config,
        intent.recordId,
      );
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

      const scope = await this.destination.getRecordCondition(actor, config);
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
    const actor = resolveActor(request, config, true);
    const scope = await this.destination.authorizeHistory(
      actor,
      config,
      recordId,
    );

    return {
      config,
      scope,
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

  async callStatus(
    request: Request,
    recordId: string,
    callId: string,
    action?: 'cancel' | 'reconcile',
  ) {
    const { config, scope, authority } = await this.historyAuthority(
      request,
      recordId,
    );
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
      );
      if (target) await this.provider.reconcile(config, target);
    }

    const refreshed = await this.historyAuthority(request, recordId);
    const updated = await read(refreshed.scope);
    if (!updated) throw forbidden();
    return { ...updated, observedAt: Date.now() };
  }
}
