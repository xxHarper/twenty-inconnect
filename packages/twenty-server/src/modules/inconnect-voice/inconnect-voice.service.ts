import {
  ForbiddenException,
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
  INCONNECT_VOICE_PATH,
  type InconnectVoiceConfig,
  VOICE_INTENT_TTL_SECONDS,
  VOICE_TOKEN_TTL_SECONDS,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceDestinationService } from 'src/modules/inconnect-voice/inconnect-voice-destination.service';

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
    userWorkspaceId !== config.userWorkspaceId ||
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

    let stage: 'encrypt-intent' | 'sign-token' | 'store-intent' =
      'encrypt-intent';
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

      return { token: jwt, intentId, intentExpiresAt, destination };
    } catch (error) {
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
    const signature = request.headers['x-twilio-signature'];
    const rawBody = request.rawBody;

    if (
      !config?.enabled ||
      request.originalUrl !== `/${INCONNECT_VOICE_PATH}/twiml` ||
      typeof signature !== 'string' ||
      !/^[a-zA-Z0-9+/]{27}=$/.test(signature) ||
      !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers['content-type'] ?? '',
      ) ||
      !rawBody?.length ||
      rawBody.length > 16_384
    ) {
      throw forbidden();
    }

    try {
      const entries = [...new URLSearchParams(rawBody.toString('utf8'))];
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        throw forbidden();

      const params = Object.fromEntries(entries);
      if (
        !Twilio.validateRequest(
          config.authToken,
          signature,
          config.voiceUrl,
          params,
        ) ||
        params.AccountSid !== config.accountSid ||
        params.From !== `client:${getIdentity(config)}` ||
        !/^CA[a-fA-F0-9]{32}$/.test(params.CallSid ?? '') ||
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
          callerId: config.callerId,
          record: 'do-not-record',
          timeLimit: 300,
        })
        .number(destination);

      return response.toString();
    } catch {
      throw forbidden();
    }
  }
}
