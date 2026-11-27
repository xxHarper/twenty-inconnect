import { type Request } from 'express';
import Twilio from 'twilio';

import { type AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { getVoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';
import {
  getVoiceInboundIdentity,
  InconnectVoiceInboundSessionService,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound-session.service';
import {
  inboundProgressUrl,
  InconnectVoiceInboundService,
} from 'src/modules/inconnect-voice/inconnect-voice-inbound.service';
import { type InconnectVoiceInboundStore } from 'src/modules/inconnect-voice/inconnect-voice-inbound.store';
import { type InconnectVoiceProviderService } from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const memberId = '00000000-0000-4000-8000-000000000002';
const recordId = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004';
const sessionId = '00000000-0000-4000-8000-000000000005';
const parentSid = `CA${'a'.repeat(32)}`;
const childSid = `CA${'b'.repeat(32)}`;
const env = {
  INCONNECT_VOICE_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  INCONNECT_VOICE_API_KEY_SID: `SK${'a'.repeat(32)}`,
  INCONNECT_VOICE_TWIML_APP_SID: `AP${'a'.repeat(32)}`,
  INCONNECT_VOICE_AUTH_TOKEN: 'callback-test-token',
  INCONNECT_VOICE_API_KEY_SECRET: 'test-secret',
  INCONNECT_VOICE_URL: 'https://voice.example.com/auth/inconnect-voice/twiml',
  INCONNECT_VOICE_CALLER_ID: '+12015550123',
  INCONNECT_VOICE_ALLOWED_DESTINATION: '+12015550124',
  INCONNECT_VOICE_WORKSPACE_ID: workspaceId,
  INCONNECT_VOICE_USER_WORKSPACE_ID: memberId,
  INCONNECT_VOICE_LEAD_OBJECT_ID: recordId,
  INCONNECT_VOICE_PHONE_FIELD_ID: id,
  INCONNECT_VOICE_ENABLE_OUTBOUND: 'false',
  INCONNECT_VOICE_ENABLE_INBOUND: 'true',
  INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID: memberId,
  INCONNECT_VOICE_INBOUND_URL:
    'https://voice.example.com/auth/inconnect-voice/inbound',
  INCONNECT_VOICE_INBOUND_NUMBER: '+12015550125',
  INCONNECT_VOICE_INBOUND_TEST_SOURCE: '+525512345678',
};
const config = getVoiceInboundConfig(env);
if (!config) throw new Error('Expected test config');

it('allows the outbound caller ID as the inbound receiver with an independent source and flag', () => {
  const shared = {
    ...env,
    INCONNECT_VOICE_INBOUND_NUMBER: env.INCONNECT_VOICE_CALLER_ID,
  };
  expect(getVoiceInboundConfig(shared)).toMatchObject({
    callerId: env.INCONNECT_VOICE_CALLER_ID,
    receiver: env.INCONNECT_VOICE_CALLER_ID,
    source: env.INCONNECT_VOICE_INBOUND_TEST_SOURCE,
    enabled: false,
    inboundEnabled: true,
  });
  expect(
    getVoiceInboundConfig({
      ...shared,
      INCONNECT_VOICE_INBOUND_TEST_SOURCE: env.INCONNECT_VOICE_CALLER_ID,
    }),
  ).toBeNull();
});

const multi = getVoiceInboundConfig({
  ...env,
  INCONNECT_VOICE_RECEIVE_USER_WORKSPACE_IDS: `${memberId},${recordId}`,
  INCONNECT_VOICE_ROUND_ROBIN_USER_WORKSPACE_IDS: recordId,
});
if (!multi) throw new Error('Expected multi-agent test config');

it('requires an explicit bounded receive pool and rejects a foreign round-robin identity', () => {
  expect(multi.distribution).toMatchObject({
    receiveUserWorkspaceIds: [memberId, recordId],
    roundRobinUserWorkspaceIds: [recordId],
    fallbackUnavailable: false,
    retryUnanswered: false,
  });
  expect(
    getVoiceInboundConfig({
      ...env,
      INCONNECT_VOICE_RECEIVE_USER_WORKSPACE_IDS: memberId,
      INCONNECT_VOICE_ROUND_ROBIN_USER_WORKSPACE_IDS: recordId,
    }),
  ).toBeNull();
  expect(
    getVoiceInboundConfig({
      ...env,
      INCONNECT_VOICE_RECEIVE_USER_WORKSPACE_IDS: '',
    }),
  ).toBeNull();
});

const sign = (
  url: string,
  fields: Record<string, string>,
  authToken = config.authToken,
) => {
  const { pathname, search } = new URL(url);
  const body = { AccountSid: config.accountSid, ...fields };
  return {
    originalUrl: pathname + search,
    rawBody: Buffer.from(new URLSearchParams(body).toString()),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': Twilio.getExpectedTwilioSignature(
        authToken,
        url,
        body,
      ),
    },
  } as unknown as Request & { rawBody: Buffer };
};

const incoming = {
  Direction: 'inbound',
  CallSid: parentSid,
  To: config.receiver,
  From: '+5215512345678',
};
const actor = {
  workspace: { id: workspaceId },
  workspaceMemberId: memberId,
  user: { firstName: 'Operator' },
};

describe('Voice V2 agent availability', () => {
  it('renews registration with a compare-and-set lease and fences a stopped tab', async () => {
    let sealed: string | null = null;
    const client = {
      get: jest.fn(async () => sealed),
      set: jest.fn(async (_key: string, replacement: string) => {
        if (sealed !== null) return null;
        sealed = replacement;
        return 'OK';
      }),
      eval: jest.fn(
        async (
          _script: string,
          _keyCount: number,
          _key: string,
          expected: string,
          replacement: string,
        ) => {
          if (sealed !== expected) return 0;
          sealed = replacement || null;
          return 1;
        },
      ),
    };
    const request = {
      headers: { authorization: 'Bearer agent-test' },
      tokenType: JwtTokenTypeEnum.ACCESS,
      user: { id },
      workspace: { id: workspaceId },
      workspaceMember: { id: memberId, userId: id },
      workspaceMemberId: memberId,
      userWorkspaceId: memberId,
    } as unknown as Request;
    const validateTokenByRequest = jest.fn().mockResolvedValue(request);
    const sessions = new InconnectVoiceInboundSessionService(
      { getClient: () => client } as unknown as RedisClientService,
      {
        encryptVersioned: (value: string) => value,
        decryptVersionedOrThrow: (value: string) => value,
      } as unknown as SecretEncryptionService,
      {
        rolePermissions: jest.fn().mockResolvedValue({}),
      } as unknown as InconnectVoiceDirectoryService,
      { validateTokenByRequest } as unknown as AccessTokenService,
    );

    const first = await sessions.start(request, config);
    expect(client.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'EX',
      35,
      'NX',
    );
    expect(await sessions.readyActor(config)).toBeNull();
    await expect(sessions.start(request, config)).rejects.toThrow(
      'session already exists',
    );
    await sessions.update(request, config, first.id, 'registered', true);
    expect(await sessions.readyActor(config)).toMatchObject({
      sessionId: first.id,
      actor: { workspaceMemberId: memberId },
    });
    expect(validateTokenByRequest).toHaveBeenCalledWith({
      headers: request.headers,
    });
    await sessions.update(request, config, first.id, 'offline', false);
    expect(await sessions.readyActor(config)).toBeNull();
    await sessions.update(request, config, first.id, 'stop', false);
    const second = await sessions.start(request, config);
    expect(second.id).not.toBe(first.id);
    await expect(
      sessions.update(request, config, first.id, 'registered', false),
    ).rejects.toThrow();
    await sessions.update(request, config, first.id, 'stop', false);
    expect(await sessions.current(config, second.id, memberId, false)).toBe(
      true,
    );

    sealed = null;
    expect(await sessions.readyActor(config)).toBeNull();
    expect(await sessions.current(config, second.id, memberId, false)).toBe(
      false,
    );
  });
});

describe('Voice V2 signed inbound and authenticated decisions', () => {
  const query = {
    clone: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue('SELECT 1'),
    getParameters: jest.fn().mockReturnValue({}),
    getRawOne: jest.fn(),
  };
  const directory = {
    query: jest
      .fn()
      .mockResolvedValue({ query, id: 'lead.id', name: 'lead.name' }),
  };
  const sessions = {
    readyActor: jest.fn(),
    current: jest.fn(),
    authorize: jest.fn(),
  };
  const store = {
    create: jest.fn(),
    settle: jest.fn(),
    screen: jest.fn(),
    read: jest.fn(),
    decide: jest.fn(),
    progress: jest.fn(),
  };
  const calls = { leaseReconciliation: jest.fn() };
  const provider = { reconcile: jest.fn() };
  const inbound = new InconnectVoiceInboundService(
    directory as unknown as InconnectVoiceDirectoryService,
    sessions as unknown as InconnectVoiceInboundSessionService,
    store as unknown as InconnectVoiceInboundStore,
    calls as unknown as InconnectVoiceCallStore,
    provider as unknown as InconnectVoiceProviderService,
  );

  beforeEach(() => {
    sessions.readyActor.mockResolvedValue({ actor, sessionId });
    sessions.current.mockResolvedValue(true);
    sessions.authorize.mockResolvedValue(actor);
    query.getRawOne.mockReset().mockResolvedValue({ recordId });
    store.create.mockReset().mockResolvedValue(true);
    store.screen.mockReset().mockResolvedValue(true);
  });

  it('requires independent activation and rejects invalid signatures, accounts and receivers', async () => {
    const disabled = getVoiceInboundConfig({
      ...env,
      INCONNECT_VOICE_ENABLE_INBOUND: 'false',
      INCONNECT_VOICE_ENABLE_OUTBOUND: 'true',
    });
    expect(disabled?.inboundEnabled).toBe(false);
    await expect(
      inbound.receive(sign(config.inboundUrl, incoming), {
        ...config,
        inboundEnabled: false,
      }),
    ).rejects.toThrow();
    await expect(
      inbound.receive(sign(config.inboundUrl, incoming, 'wrong'), config),
    ).rejects.toThrow();
    await expect(
      inbound.receive(
        sign(config.inboundUrl, {
          ...incoming,
          AccountSid: `AC${'b'.repeat(32)}`,
        }),
        config,
      ),
    ).rejects.toThrow();
    await expect(
      inbound.receive(
        sign(config.inboundUrl, { ...incoming, To: config.callerId }),
        config,
      ),
    ).rejects.toThrow();
    await expect(
      inbound.receive(
        sign(config.inboundUrl, { ...incoming, From: config.callerId }),
        config,
      ),
    ).resolves.toContain('<Reject');
    expect(store.create).not.toHaveBeenCalled();
  });

  it('routes a normalized exact match to a single registered identity and suppresses duplicate Dial', async () => {
    const request = sign(config.inboundUrl, incoming);
    const xml = await inbound.receive(request, config);
    expect(xml).toContain('answerOnBridge="true"');
    expect(xml).toContain('record="do-not-record"');
    expect(xml).toContain(getVoiceInboundIdentity(config, sessionId));
    expect(xml).toMatch(
      /<Parameter name="inconnectVoiceCallId" value="[^"]+"\/>/,
    );
    expect(xml).not.toContain(recordId);
    expect(directory.query).toHaveBeenCalledWith(
      actor,
      config,
      expect.objectContaining({ number: config.source }),
      true,
    );
    expect(store.create).toHaveBeenCalledWith(
      config,
      expect.any(String),
      parentSid,
      expect.objectContaining({ recordId, actorMemberId: memberId, sessionId }),
      false,
    );
    store.create.mockResolvedValueOnce(false);
    const duplicate = await inbound.receive(request, config);
    expect(duplicate).toContain('<Reject');
    expect(duplicate).not.toContain('<Dial');
  });

  it('records offline and unavailable lookups without dialing another agent', async () => {
    store.create.mockResolvedValue(false);
    sessions.readyActor.mockResolvedValueOnce(null);
    expect(
      await inbound.receive(sign(config.inboundUrl, incoming), config),
    ).toContain('<Reject');
    expect(store.create).toHaveBeenLastCalledWith(
      config,
      expect.any(String),
      parentSid,
      null,
      false,
    );
    query.getRawOne.mockRejectedValueOnce(new Error('resolution failed'));
    expect(
      await inbound.receive(sign(config.inboundUrl, incoming), config),
    ).toContain('<Reject');
    expect(store.create).toHaveBeenLastCalledWith(
      config,
      expect.any(String),
      parentSid,
      null,
      true,
    );
  });

  it('reauthorizes Accept and Decline and screens the browser leg under the same identity', async () => {
    const request = {} as Request;
    store.read.mockResolvedValue({ id, recordId, status: 'ringing' });
    await inbound.offer(request, config, id, sessionId, 'accept');
    await inbound.offer(request, config, id, sessionId, 'decline');
    expect(store.decide).toHaveBeenCalledWith(
      config,
      id,
      memberId,
      sessionId,
      expect.objectContaining({ sql: expect.stringContaining('EXISTS') }),
      'accept',
    );
    expect(store.decide).toHaveBeenCalledWith(
      config,
      id,
      memberId,
      sessionId,
      expect.anything(),
      'decline',
    );
    const screen = inboundProgressUrl(config, {
      id,
      parentSid,
      source: 'screen',
    });
    const fields = {
      CallSid: childSid,
      ParentCallSid: parentSid,
      To: `client:${getVoiceInboundIdentity(config, sessionId)}`,
    };
    expect(await inbound.callback(sign(screen, fields), config)).not.toContain(
      '<Hangup',
    );
    expect(store.screen).toHaveBeenCalledWith(
      config,
      { id, parentSid, childSid },
      memberId,
      sessionId,
      expect.anything(),
    );
    store.screen.mockResolvedValueOnce(false);
    expect(await inbound.callback(sign(screen, fields), config)).toContain(
      '<Hangup',
    );
    sessions.current.mockResolvedValueOnce(false);
    await expect(
      inbound.offer(request, config, id, sessionId, 'accept'),
    ).rejects.toThrow();
  });

  it('uses a signed Dial bridge verdict for answered duration and handles parent cancellation', async () => {
    const dial = inboundProgressUrl(config, { id, parentSid, source: 'dial' });
    const fields = {
      ...incoming,
      DialCallSid: childSid,
      DialBridged: 'true',
      DialCallStatus: 'completed',
      DialCallDuration: '27',
    };
    expect(await inbound.callback(sign(dial, fields), config)).toContain(
      '<Hangup',
    );
    expect(store.settle).toHaveBeenCalledWith(
      config,
      { id, parentSid, childSid },
      expect.objectContaining({ result: 'answered', durationSeconds: 27 }),
      true,
    );
    await inbound.callback(
      sign(inboundProgressUrl(config), { ...incoming, CallStatus: 'canceled' }),
      config,
    );
    expect(store.settle).toHaveBeenLastCalledWith(
      config,
      { id: null, parentSid, childSid: null },
      expect.objectContaining({ result: 'canceled', durationSeconds: null }),
      false,
    );
    await expect(
      inbound.callback(sign(dial, { ...fields, CallSid: childSid }), config),
    ).rejects.toThrow();
    await expect(
      inbound.callback(
        sign(dial, { ...fields, DialBridged: 'missing' }),
        config,
      ),
    ).rejects.toThrow();
  });

  it('correlates a terminal Client event, and lets Dial finish if the executive hangs up first', async () => {
    const target = { id, parentSid, childSid, direction: 'inbound' };
    const client = inboundProgressUrl(config, {
      id,
      parentSid,
      source: 'client',
    });
    const fields = {
      CallSid: childSid,
      ParentCallSid: parentSid,
      CallbackSource: 'call-progress-events',
    };
    store.progress.mockResolvedValueOnce(null).mockResolvedValueOnce(target);
    await inbound.callback(
      sign(client, { ...fields, CallStatus: 'in-progress' }),
      config,
    );
    expect(provider.reconcile).not.toHaveBeenCalled();
    await inbound.callback(
      sign(client, { ...fields, CallStatus: 'completed', CallDuration: '31' }),
      config,
    );
    expect(provider.reconcile).toHaveBeenCalledWith(config, target);
    const dial = inboundProgressUrl(config, { id, parentSid, source: 'dial' });
    const ending = sign(dial, {
      ...incoming,
      DialCallSid: childSid,
      DialBridged: 'true',
      DialCallStatus: 'completed',
      DialCallDuration: '30',
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await inbound.callback(ending, config)).toContain('<Hangup');
    }
    expect(store.settle).toHaveBeenLastCalledWith(
      config,
      { id, parentSid, childSid },
      expect.objectContaining({ result: 'answered', durationSeconds: 30 }),
      true,
    );
  });
});

describe('Voice V2.1 phone versus CRM authority', () => {
  it('allows the offered receiver to decide with the Lead fields redacted', async () => {
    const session = {
      authorize: jest
        .fn()
        .mockResolvedValue({ ...actor, userWorkspaceId: memberId }),
      canReceiveOffer: jest.fn().mockResolvedValue(true),
    };
    const read = jest
      .fn()
      .mockResolvedValue({ id, recordId: null, name: null });
    const decide = jest.fn();
    const inbound = new InconnectVoiceInboundService(
      {
        query: jest.fn().mockRejectedValue(new Error('Lead out of scope')),
      } as unknown as InconnectVoiceDirectoryService,
      session as unknown as InconnectVoiceInboundSessionService,
      { read, decide } as unknown as InconnectVoiceInboundStore,
      {} as InconnectVoiceCallStore,
      {} as InconnectVoiceProviderService,
    );
    await expect(
      inbound.offer({} as Request, multi, id, sessionId, 'accept'),
    ).resolves.toMatchObject({
      id,
      recordId: null,
      name: null,
    });
    expect(decide).toHaveBeenCalledWith(
      multi,
      id,
      memberId,
      sessionId,
      expect.objectContaining({
        sql: 'TRUE',
        visibleRecordId: 'NULL::uuid',
        name: 'NULL::text',
      }),
      'accept',
    );
    expect(session.canReceiveOffer).toHaveBeenCalledWith(
      multi,
      expect.objectContaining({ workspaceMemberId: memberId }),
      sessionId,
    );
  });
  it('denies a new accept after revocation and scopes progress to the prior screened offer', async () => {
    const session = {
      authorize: jest
        .fn()
        .mockResolvedValue({ ...actor, userWorkspaceId: memberId }),
      canReceiveOffer: jest.fn().mockResolvedValue(false),
    };
    const read = jest.fn().mockResolvedValue({ id, status: 'answered' });
    const decide = jest.fn();
    const inbound = new InconnectVoiceInboundService(
      {
        query: jest.fn().mockRejectedValue(new Error('Lead out of scope')),
      } as unknown as InconnectVoiceDirectoryService,
      session as unknown as InconnectVoiceInboundSessionService,
      { read, decide } as unknown as InconnectVoiceInboundStore,
      {} as InconnectVoiceCallStore,
      {} as InconnectVoiceProviderService,
    );
    await expect(
      inbound.offer({} as Request, multi, id, sessionId, 'accept'),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
    await expect(
      inbound.offer({} as Request, multi, id, sessionId),
    ).resolves.toMatchObject({ id, status: 'answered' });
    expect(read).toHaveBeenCalledWith(
      multi,
      id,
      memberId,
      sessionId,
      expect.objectContaining({
        sql: 'call."inboundScreenedAt" IS NOT NULL AND (TRUE)',
      }),
    );
  });
});

describe('Voice V2.1 presence leases', () => {
  it('keeps two identities separate and retains an active reservation through preference and lease changes', async () => {
    const values = new Map<string, string>();
    const client = {
      get: jest.fn(async (key: string) => values.get(key) ?? null),
      set: jest.fn(async (key: string, value: string, expiry?: string) => {
        if (expiry && values.has(key)) return null;
        values.set(key, value);
        return 'OK';
      }),
      eval: jest.fn(
        async (
          _code: string,
          keys: number,
          key: string,
          expected: string,
          replacement: string,
        ) => {
          if (keys === 2) {
            values.set(key, 'offline');
            values.delete(expected);
            return 1;
          }
          if (values.get(key) !== expected) return 0;
          if (replacement) values.set(key, replacement);
          else values.delete(key);
          return 1;
        },
      ),
    };
    const requestFor = (userWorkspaceId: string) =>
      ({
        headers: { authorization: `Bearer agent-${userWorkspaceId}` },
        tokenType: JwtTokenTypeEnum.ACCESS,
        user: { id },
        workspace: { id: workspaceId },
        workspaceMember: { id: userWorkspaceId, userId: id },
        workspaceMemberId: userWorkspaceId,
        userWorkspaceId,
      }) as unknown as Request;
    const first = requestFor(memberId);
    const second = requestFor(recordId);
    const busy = jest.fn().mockResolvedValue(null);
    const sessions = new InconnectVoiceInboundSessionService(
      { getClient: () => client } as unknown as RedisClientService,
      {
        encryptVersioned: (value: string) => value,
        decryptVersionedOrThrow: (value: string) => value,
      } as unknown as SecretEncryptionService,
      {
        rolePermissions: jest.fn().mockResolvedValue({}),
      } as unknown as InconnectVoiceDirectoryService,
      {
        validateTokenByRequest: jest.fn(async (request: Request) =>
          request.headers.authorization === first.headers.authorization
            ? first
            : second,
        ),
      } as unknown as AccessTokenService,
      {
        activeReservation: busy,
        withReservationAuthority: async (
          _workspaceId: string,
          write: () => Promise<unknown>,
        ) => write(),
      } as unknown as InconnectVoiceCallStore,
    );
    const firstLease = await sessions.start(first, multi);
    const secondLease = await sessions.start(second, multi);
    await sessions.update(first, multi, firstLease.id, 'registered', false);
    await sessions.update(second, multi, secondLease.id, 'registered', false);
    await expect(
      sessions.update(second, multi, firstLease.id, 'registered', false),
    ).rejects.toThrow();
    await expect(sessions.candidate(multi, memberId)).resolves.toBeNull();
    await expect(
      sessions.availability(first, multi, 'available'),
    ).resolves.toMatchObject({
      effective: 'available',
      registered: true,
    });
    await expect(sessions.candidate(multi, memberId)).resolves.toMatchObject({
      sessionId: firstLease.id,
    });

    busy.mockResolvedValue('busy');
    await expect(
      sessions.availability(first, multi, 'unavailable'),
    ).resolves.toMatchObject({
      effective: 'busy',
      preference: 'unavailable',
    });
    const firstKey = [...values.keys()].find(
      (key) =>
        key.includes(':session:') && key.endsWith(memberId.replace(/-/g, '')),
    );
    if (!firstKey) throw new Error('Missing first lease');
    values.delete(firstKey);
    await expect(sessions.availability(first, multi)).resolves.toMatchObject({
      effective: 'busy',
      registered: false,
    });
    const offline = await sessions.availability(second, multi, 'offline');
    expect(offline).toMatchObject({
      preference: 'offline',
      registered: false,
      effective: 'busy',
    });
    await expect(sessions.candidate(multi, recordId)).resolves.toBeNull();
    await expect(
      sessions.update(second, multi, secondLease.id, 'registered', false),
    ).rejects.toThrow();
    await expect(sessions.start(second, multi)).rejects.toThrow();
    busy.mockResolvedValue(null);
    await expect(sessions.availability(second, multi)).resolves.toMatchObject({
      preference: 'offline',
      registered: false,
      effective: 'offline',
    });
    await sessions.availability(second, multi, 'available');
    const newLease = await sessions.start(second, multi);
    await sessions.update(second, multi, secondLease.id, 'stop', false);
    await sessions.update(second, multi, newLease.id, 'registered', false);
    busy.mockResolvedValue(null);
    await expect(sessions.availability(first, multi)).resolves.toMatchObject({
      effective: 'offline',
      preference: 'unavailable',
    });
    await expect(sessions.availability(second, multi)).resolves.toMatchObject({
      effective: 'available',
      registered: true,
    });
  });
});
