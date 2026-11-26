import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { type Request } from 'express';
import Twilio from 'twilio';
import { z } from 'zod';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import {
  credentialSchema,
  getVoiceCredential,
  getVoiceIdentity,
  resolveVoiceActor,
} from 'src/modules/inconnect-voice/inconnect-voice-actor';
import {
  type VoiceInboundConfig,
  VOICE_TOKEN_TTL_SECONDS,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';

const LEASE_SECONDS = 35;
const leaseSchema = z
  .object({
    id: z.string().uuid(),
    memberId: z.string().uuid(),
    registered: z.boolean(),
    credential: credentialSchema,
  })
  .strict();

const replaceLease = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  if ARGV[2] == '' then return redis.call('DEL', KEYS[1]) end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
`;

const unavailable = () =>
  new ForbiddenException('Inbound Voice is unavailable');

export const getVoiceInboundIdentity = (
  config: VoiceInboundConfig,
  id: string,
) => `${getVoiceIdentity(config)}_${id.replace(/-/g, '')}`;

@Injectable()
export class InconnectVoiceInboundSessionService {
  constructor(
    private readonly redis: RedisClientService,
    private readonly encryption: SecretEncryptionService,
    private readonly directory: InconnectVoiceDirectoryService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  private key(config: VoiceInboundConfig) {
    return `inconnectVoice:inbound:${config.accountSid}:${getVoiceIdentity(config)}`;
  }

  private seal(lease: z.infer<typeof leaseSchema>, config: VoiceInboundConfig) {
    return this.encryption.encryptVersioned(
      plaintextStringSchema.parse(JSON.stringify(lease)),
      { workspaceId: config.workspaceId },
    );
  }

  private token(config: VoiceInboundConfig, id: string) {
    const token = new Twilio.jwt.AccessToken(
      config.accountSid,
      config.apiKeySid,
      config.apiKeySecret,
      {
        identity: getVoiceInboundIdentity(config, id),
        ttl: VOICE_TOKEN_TTL_SECONDS,
      },
    );
    token.addGrant(
      new Twilio.jwt.AccessToken.VoiceGrant({ incomingAllow: true }),
    );
    return token.toJwt();
  }

  private async read(config: VoiceInboundConfig) {
    const sealed = await this.redis.getClient().get(this.key(config));
    if (!sealed) return null;
    const lease = leaseSchema.parse(
      JSON.parse(
        this.encryption.decryptVersionedOrThrow(sealed as EncryptedString, {
          workspaceId: config.workspaceId,
        }),
      ),
    );
    return { sealed, lease };
  }

  async authorize(request: Request, config: VoiceInboundConfig) {
    if (!config.inboundEnabled) throw unavailable();
    const actor = resolveVoiceActor(request, config);
    await this.directory.rolePermissions(actor);
    return actor;
  }

  async start(request: Request, config: VoiceInboundConfig) {
    const actor = await this.authorize(request, config);
    const id = randomUUID();
    const token = this.token(config, id);
    const lease = this.seal(
      {
        id,
        memberId: actor.workspaceMemberId,
        registered: false,
        credential: getVoiceCredential(request),
      },
      config,
    );
    if (
      (await this.redis
        .getClient()
        .set(this.key(config), lease, 'EX', LEASE_SECONDS, 'NX')) !== 'OK'
    )
      throw new ConflictException('An inbound Voice session already exists');
    return { id, token };
  }

  async update(
    request: Request,
    config: VoiceInboundConfig,
    id: string,
    state: 'registered' | 'offline' | 'stop',
    refresh: boolean,
  ) {
    const actor =
      state === 'stop'
        ? resolveVoiceActor(request, config)
        : await this.authorize(request, config);
    const current = await this.read(config);
    if (
      current?.lease.id !== id ||
      current.lease.memberId !== actor.workspaceMemberId
    ) {
      if (state === 'stop') return {};
      throw unavailable();
    }

    const replacement =
      state === 'stop'
        ? ''
        : this.seal(
            {
              ...current.lease,
              credential: getVoiceCredential(request),
              registered: state === 'registered',
            },
            config,
          );
    const result = await this.redis
      .getClient()
      .eval(
        replaceLease,
        1,
        this.key(config),
        current.sealed,
        replacement,
        LEASE_SECONDS,
      );
    if (result !== 1 && state !== 'stop') throw unavailable();
    return refresh && state !== 'stop' ? { token: this.token(config, id) } : {};
  }

  async current(
    config: VoiceInboundConfig,
    id: string,
    memberId: string,
    requireRegistered = true,
  ) {
    if (!config.inboundEnabled) return false;
    const current = await this.read(config);
    return (
      current?.lease.id === id &&
      current.lease.memberId === memberId &&
      (!requireRegistered || current.lease.registered)
    );
  }

  async readyActor(config: VoiceInboundConfig) {
    if (!config.inboundEnabled) return null;
    const current = await this.read(config);
    if (!current?.lease.registered) return null;
    const auth = await this.accessTokens.validateTokenByRequest({
      headers: current.lease.credential,
    } as Request);
    const actor = resolveVoiceActor(auth, config);
    if (actor.workspaceMemberId !== current.lease.memberId) throw unavailable();
    return { actor, sessionId: current.lease.id };
  }
}
