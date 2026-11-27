import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { type Request } from 'express';
import Twilio from 'twilio';
import { z } from 'zod';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
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
  canReceiveVoice,
  type VoiceInboundConfig,
  VOICE_TOKEN_TTL_SECONDS,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';

import {
  getVoiceEffectiveAvailability,
  type VoicePreference,
} from 'src/modules/inconnect-voice/inconnect-voice-availability';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';

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

const disableReception = `
  redis.call('SET', KEYS[1], 'offline')
  redis.call('DEL', KEYS[2])
  return 1
`;

const unavailable = () =>
  new ForbiddenException('Inbound Voice is unavailable');

export const getVoiceInboundIdentity = (
  config: VoiceInboundConfig,
  id: string,
  userWorkspaceId = config.userWorkspaceId,
) =>
  `${getVoiceIdentity({ ...config, userWorkspaceId })}_${id.replace(/-/g, '')}`;

@Injectable()
export class InconnectVoiceInboundSessionService {
  constructor(
    private readonly redis: RedisClientService,
    private readonly encryption: SecretEncryptionService,
    private readonly directory: InconnectVoiceDirectoryService,
    private readonly accessTokens: AccessTokenService,
    @Optional() private readonly calls?: InconnectVoiceCallStore,
  ) {}

  private key(
    config: VoiceInboundConfig,
    userWorkspaceId = config.userWorkspaceId,
  ) {
    const namespace = `inconnectVoice:inbound:${config.accountSid}`;
    const identity = getVoiceIdentity({ ...config, userWorkspaceId });
    return config.distribution
      ? `${namespace}:session:${identity}`
      : `${namespace}:${identity}`;
  }

  private preferenceKey(config: VoiceInboundConfig, userWorkspaceId: string) {
    return `inconnectVoice:inbound:${config.accountSid}:preference:${getVoiceIdentity({ ...config, userWorkspaceId })}`;
  }

  private actor(
    request: Parameters<typeof resolveVoiceActor>[0],
    config: VoiceInboundConfig,
  ) {
    if (!canReceiveVoice(config, request.userWorkspaceId)) throw unavailable();
    return resolveVoiceActor(request, {
      ...config,
      dialUserWorkspaceIds: config.distribution?.receiveUserWorkspaceIds ?? [
        config.userWorkspaceId,
      ],
    });
  }

  private async preference(
    config: VoiceInboundConfig,
    userWorkspaceId: string,
  ): Promise<VoicePreference> {
    if (!config.distribution) return 'available';
    const saved = await this.redis
      .getClient()
      .get(this.preferenceKey(config, userWorkspaceId));
    if (saved === null || saved === 'unavailable') return 'unavailable';
    if (saved === 'available' || saved === 'offline') return saved;
    throw unavailable();
  }

  async availability(
    request: Request,
    config: VoiceInboundConfig,
    next?: VoicePreference,
  ) {
    const actor = await this.authorize(request, config);
    if (!config.distribution) return { available: true };
    if (!this.calls) throw unavailable();
    if (next) {
      const preferenceKey = this.preferenceKey(config, actor.userWorkspaceId);
      await this.calls.withReservationAuthority(
        config.workspaceId,
        async () => {
          const client = this.redis.getClient();
          if (next === 'offline') {
            // Offline applies to the operator, including the lease held by another tab.
            await client.eval(
              disableReception,
              2,
              preferenceKey,
              this.key(config, actor.userWorkspaceId),
            );
          } else {
            await client.set(preferenceKey, next);
          }
        },
      );
    }
    const [preference, session, active] = await Promise.all([
      this.preference(config, actor.userWorkspaceId),
      this.readyActor(config, actor.userWorkspaceId).catch(() => null),
      this.calls.activeReservation(config.workspaceId, actor.workspaceMemberId),
    ]);
    const registered =
      preference !== 'offline' &&
      session?.actor.workspaceMemberId === actor.workspaceMemberId;
    return {
      available: true,
      preference,
      registered,
      effective: getVoiceEffectiveAvailability(preference, registered, active),
    };
  }

  private seal(lease: z.infer<typeof leaseSchema>, config: VoiceInboundConfig) {
    return this.encryption.encryptVersioned(
      plaintextStringSchema.parse(JSON.stringify(lease)),
      { workspaceId: config.workspaceId },
    );
  }

  private token(
    config: VoiceInboundConfig,
    id: string,
    userWorkspaceId: string,
  ) {
    const token = new Twilio.jwt.AccessToken(
      config.accountSid,
      config.apiKeySid,
      config.apiKeySecret,
      {
        identity: getVoiceInboundIdentity(config, id, userWorkspaceId),
        ttl: VOICE_TOKEN_TTL_SECONDS,
      },
    );
    token.addGrant(
      new Twilio.jwt.AccessToken.VoiceGrant({ incomingAllow: true }),
    );
    return token.toJwt();
  }

  private async read(
    config: VoiceInboundConfig,
    userWorkspaceId = config.userWorkspaceId,
  ) {
    const sealed = await this.redis
      .getClient()
      .get(this.key(config, userWorkspaceId));
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
    const actor = this.actor(request, config);
    await this.directory.rolePermissions(actor);
    return actor;
  }

  async start(request: Request, config: VoiceInboundConfig) {
    const actor = await this.authorize(request, config);
    const id = randomUUID();
    const token = this.token(config, id, actor.userWorkspaceId);
    const lease = this.seal(
      {
        id,
        memberId: actor.workspaceMemberId,
        registered: false,
        credential: getVoiceCredential(request),
      },
      config,
    );
    await this.withReceptionAuthority(config, async () => {
      if ((await this.preference(config, actor.userWorkspaceId)) === 'offline')
        throw unavailable();
      if (
        (await this.redis
          .getClient()
          .set(
            this.key(config, actor.userWorkspaceId),
            lease,
            'EX',
            LEASE_SECONDS,
            'NX',
          )) !== 'OK'
      )
        throw new ConflictException('An inbound Voice session already exists');
    });
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
        ? this.actor(request, config)
        : await this.authorize(request, config);
    return this.withReceptionAuthority(config, async () => {
      const current = await this.read(config, actor.userWorkspaceId);
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
          this.key(config, actor.userWorkspaceId),
          current.sealed,
          replacement,
          LEASE_SECONDS,
        );
      if (result !== 1)
        throw new ConflictException('Inbound Voice session changed');
      return refresh && state !== 'stop'
        ? { token: this.token(config, id, actor.userWorkspaceId) }
        : {};
    });
  }

  private withReceptionAuthority<T>(
    config: VoiceInboundConfig,
    operation: () => Promise<T>,
  ) {
    if (!config.distribution) return operation();
    if (!this.calls) throw unavailable();
    return this.calls.withReservationAuthority(config.workspaceId, operation);
  }

  async current(
    config: VoiceInboundConfig,
    id: string,
    memberId: string,
    requireRegistered = true,
    userWorkspaceId = config.userWorkspaceId,
  ) {
    if (!config.inboundEnabled || !canReceiveVoice(config, userWorkspaceId))
      return false;
    const current = await this.read(config, userWorkspaceId);
    return (
      current?.lease.id === id &&
      current.lease.memberId === memberId &&
      (!requireRegistered || current.lease.registered)
    );
  }

  async readyActor(
    config: VoiceInboundConfig,
    userWorkspaceId = config.userWorkspaceId,
  ) {
    if (!config.inboundEnabled || !canReceiveVoice(config, userWorkspaceId))
      return null;
    const current = await this.read(config, userWorkspaceId);
    if (!current?.lease.registered) return null;
    const auth = await this.accessTokens.validateTokenByRequest({
      headers: current.lease.credential,
    } as Request);
    const actor = this.actor(auth, config);
    if (
      actor.userWorkspaceId !== userWorkspaceId ||
      actor.workspaceMemberId !== current.lease.memberId
    )
      throw unavailable();
    if (config.distribution) await this.directory.rolePermissions(actor);
    return { actor, sessionId: current.lease.id };
  }

  async candidate(config: VoiceInboundConfig, userWorkspaceId: string) {
    if ((await this.preference(config, userWorkspaceId)) !== 'available')
      return null;
    const ready = await this.readyActor(config, userWorkspaceId);
    if (
      !ready ||
      !(await this.canReceiveOffer(config, ready.actor, ready.sessionId))
    )
      return null;
    return ready;
  }

  async canReceiveOffer(
    config: VoiceInboundConfig,
    actor: UserWorkspaceAuthContext,
    sessionId: string,
  ) {
    return (
      (await this.preference(config, actor.userWorkspaceId)) === 'available' &&
      (await this.current(
        config,
        sessionId,
        actor.workspaceMemberId,
        true,
        actor.userWorkspaceId,
      ))
    );
  }

  async screenActor(config: VoiceInboundConfig, to: string | undefined) {
    if (!config.distribution) return this.readyActor(config);
    const userWorkspaceId = config.distribution.receiveUserWorkspaceIds.find(
      (id) =>
        to?.startsWith(
          `client:${getVoiceIdentity({ ...config, userWorkspaceId: id })}_`,
        ),
    );
    return userWorkspaceId ? this.candidate(config, userWorkspaceId) : null;
  }
}
