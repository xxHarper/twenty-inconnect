import { inboundFixture } from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/inbound-attention.fixtures';
import { INBOUND_ATTENTION_ADMISSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/inbound-attention-sql';
import {
  bundle,
  conversation,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  ATTENTION_INSERT_AUDIT_SQL,
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_INSERT_OUTBOX_SQL,
  ATTENTION_INSERT_RECEIPT_SQL,
  ATTENTION_UPDATE_CONVERSATION_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import {
  apply,
  identifier,
  initial,
  pending,
  physicalRows,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('inert signed inbound with the real C2 writer/reader/C1/reducer', () => {
  it.each([
    ['kind', 'STATUS_CALLBACK'],
    ['contentType', 'application/json'],
    ['rawBody', 'Body=unsigned'],
    ['routingKey', 'another-connection'],
  ])(
    'rejects an unsupported or unbound request %s before admission reads',
    async (field, value) => {
      const fixture = inboundFixture();
      Object.assign(fixture.request, { [field]: value });
      // Before and after admission are writer session checks; no admission query.
      fixture.scenario.steps.splice(fixture.scenario.readerLength + 2, 3);
      fixture.scenario.steps.splice(fixture.scenario.readerLength + 3);
      const result = fixture.run();
      await expect(result.promise).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'AUTHORITY_REQUIRED' },
      });
      result.done();
      expect(fixture.decrypt).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['ATTENDED', '0'],
    ['PENDING', '4'],
    ['PENDING', '92233720368547758081234567890'],
  ] as const)(
    'opens or renews %s/%s after real Twilio signature verification',
    async (status, revision) => {
      const before = status === 'PENDING' ? pending(revision) : initial();
      const fixture = inboundFixture(
        { current: conversation(status, revision) },
        before,
      );
      const result = fixture.run();
      await expect(result.promise).resolves.toMatchObject({
        status: 'PREPARED',
        value: {
          snapshot: {
            status: 'PENDING',
            revision: (BigInt(revision) + BigInt(1)).toString(),
          },
        },
      });
      result.done();
      const statements = result.calls.map((call) => call.sql);
      expect(statements.indexOf(ATTENTION_CONFIGURATION_SQL)).toBeLessThan(
        statements.indexOf(ATTENTION_CONVERSATION_LOCK_SQL),
      );
      expect(statements.indexOf(ATTENTION_INSERT_AUDIT_SQL)).toBeLessThan(
        statements.indexOf(ATTENTION_UPDATE_CONVERSATION_SQL),
      );
      expect(
        statements.indexOf(ATTENTION_UPDATE_CONVERSATION_SQL),
      ).toBeLessThan(statements.indexOf(ATTENTION_INSERT_OUTBOX_SQL));
      expect(fixture.decrypt).toHaveBeenCalledWith(
        'workspace-encrypted-credentials',
        expect.objectContaining({ workspaceId: expect.any(String) }),
      );
      expect(fixture.clientFactory.create).not.toHaveBeenCalled();
      expect(fixture.secureHttp.getHttpClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['signature', 'invalid'],
    [
      'effectiveUrl',
      'https://wrong.example.test/webhooks/inconnect-messaging/twilio/whatsapp/private-route/inbound',
    ],
  ])(
    'denies changed %s and throws instead of returning a committable error',
    async (field, value) => {
      const fixture = inboundFixture();
      Object.assign(fixture.request, { [field]: value });
      // Rejection still verifies session after admission, but performs no DML.
      fixture.scenario.steps.splice(fixture.scenario.readerLength + 6);
      const result = fixture.run();
      await expect(result.promise).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'AUTHORITY_REQUIRED' },
      });
      result.done();
      expect(
        result.calls.some((call) => call.sql.includes('INSERT INTO')),
      ).toBe(false);
    },
  );

  it.each([
    ['routingCount', '2'],
    ['routingCount', '0'],
    ['inboundRoutingKey', 'foreign-route'],
    ['provider', 'OTHER'],
    ['channel', 'EMAIL'],
    ['lifecycleStatus', 'DISABLED'],
    ['eventKind', 'STATUS_CALLBACK'],
    ['processingState', 'PROCESSED'],
    ['leaseToken', 'different-token'],
    ['leaseValid', false],
    ['direction', 'OUTBOUND'],
    ['payloadHash', 'different-hash'],
    ['idempotencyKey', 'different-key'],
    ['externalAddressNormalized', '+14155238886'],
    ['providerMessageId', 'foreign-message'],
    ['body', 'tampered'],
    ['type', 'IMAGE'],
    ['providerMetadata', {}],
    ['normalizedMetadata', {}],
    ['encryptedCredentials', null],
  ])('rejects inconsistent backend %s', async (field, value) => {
    const fixture = inboundFixture();
    Object.assign(fixture.admissionRow, { [field]: value });
    fixture.scenario.steps.splice(fixture.scenario.readerLength + 6);
    const result = fixture.run();
    await expect(result.promise).rejects.toMatchObject({
      callerMustRollback: true,
      failure: { code: 'AUTHORITY_REQUIRED' },
    });
    result.done();
  });

  it.each([
    ATTENTION_INSERT_EFFECT_SQL,
    ATTENTION_INSERT_AUDIT_SQL,
    ATTENTION_INSERT_RECEIPT_SQL,
    ATTENTION_UPDATE_CONVERSATION_SQL,
    ATTENTION_INSERT_OUTBOX_SQL,
  ])(
    'requires whole-unit rollback on writer failure at %s',
    async (statement) => {
      const fixture = inboundFixture();
      const index = fixture.scenario.steps.findIndex(
        (step) => step.sql === statement,
      );
      fixture.scenario.steps[index].error = {
        code: '23514',
        message: 'sensitive driver detail',
      };
      fixture.scenario.steps.splice(index + 1);
      const result = fixture.run();
      await expect(result.promise).rejects.toMatchObject({
        callerMustRollback: true,
      });
      result.done();
      // This proves rejection and stopping, not physical rollback of earlier SQL.
    },
  );

  it.each([
    [
      'schema absent',
      {
        installed: false,
        mode: null,
        protocolVersion: null,
        gateUpdatedAt: null,
      },
      'SCHEMA_NOT_INSTALLED',
    ],
    ['disabled', { mode: 'DISABLED' }, 'TRACKING_DISABLED'],
    ['preparing', { mode: 'PREPARING' }, 'TRACKING_PREPARING'],
    ['suspended', { mode: 'SUSPENDED' }, 'TRACKING_SUSPENDED'],
  ])(
    'refuses %s without querying attention tables or falling back',
    async (_name, changes, code) => {
      const fixture = inboundFixture();
      const index = fixture.scenario.steps.findIndex(
        (step) => step.sql === ATTENTION_CONFIGURATION_SQL,
      );
      fixture.scenario.steps[index].rows = [
        { ...(fixture.scenario.steps[index].rows[0] as object), ...changes },
      ];
      fixture.scenario.steps.splice(index + 1);
      const result = fixture.run();
      await expect(result.promise).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code },
      });
      result.done();
      expect(
        result.calls.some((call) =>
          call.sql.includes('FROM core."inconnectMessagingAttention'),
        ),
      ).toBe(false);
    },
  );

  it('does not turn an admission query error into missing facts or legacy permission', async () => {
    const fixture = inboundFixture();
    const index = fixture.scenario.steps.findIndex(
      (step) => step.sql === INBOUND_ATTENTION_ADMISSION_SQL,
    );
    fixture.scenario.steps[index].error = new Error('private credentials');
    fixture.scenario.steps.splice(index + 1);
    const result = fixture.run();
    await expect(result.promise).rejects.toMatchObject({
      callerMustRollback: true,
      failure: { code: 'ADMISSION_FAILED' },
    });
    result.done();
  });

  it.each(['canonical replay', 'new alias', 'alias replay'])(
    'preserves historical originals for %s',
    async (kind) => {
      const incoming = inboundFixture().scenario.event;
      const canonical =
        kind === 'canonical replay'
          ? incoming
          : { ...incoming, eventKey: 'canonical-delivery' };
      const rows = physicalRows(canonical);
      const duplicate = apply(rows.transition.state, incoming);
      const { state: aliasState, ...aliasResult } = duplicate;
      const aliasAudit = {
        ...rows.canonicalAudit,
        id: identifier(32),
        eventKey: incoming.eventKey,
        result: aliasResult,
      };
      const aliasReceipt = {
        ...rows.canonicalReceipt,
        id: identifier(31),
        eventKey: incoming.eventKey,
        originalAuditId: aliasAudit.id,
      };
      const fixture = inboundFixture(
        {
          current: conversation('PENDING', '1'),
          effect: rows.effect,
          receipt:
            kind === 'canonical replay'
              ? rows.canonicalReceipt
              : kind === 'alias replay'
                ? aliasReceipt
                : null,
          originalAudit:
            kind === 'canonical replay' ? rows.canonicalAudit : aliasAudit,
          bundles: { [rows.effect.id]: bundle(rows) },
        },
        kind === 'alias replay' ? aliasState : rows.transition.state,
      );
      const result = fixture.run();
      await expect(result.promise).resolves.toMatchObject({
        value: {
          outcome: { kind: 'DUPLICATE' },
          snapshot: { revision: '1' },
          originals: {
            effectResult: { kind: 'APPLIED' },
            eventResult: {
              kind: kind === 'canonical replay' ? 'APPLIED' : 'DUPLICATE',
            },
          },
        },
      });
      result.done();
      expect(
        result.calls.some(
          (call) =>
            call.sql === ATTENTION_INSERT_EFFECT_SQL ||
            call.sql === ATTENTION_UPDATE_CONVERSATION_SQL ||
            call.sql === ATTENTION_INSERT_OUTBOX_SQL,
        ),
      ).toBe(false);
    },
  );

  it.each([
    [
      'image',
      {
        NumMedia: '1',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/media/image',
      },
    ],
    [
      'audio',
      {
        NumMedia: '1',
        MediaContentType0: 'audio/ogg',
        MediaUrl0: 'https://api.twilio.com/media/audio',
      },
    ],
    ['location', { Latitude: '19.4', Longitude: '-99.1' }],
    [
      'contact',
      {
        NumMedia: '1',
        MediaContentType0: 'text/vcard',
        MediaUrl0: 'https://api.twilio.com/media/contact',
      },
    ],
  ] as const)(
    'authenticates normalized %s without provider or storage I/O',
    async (_kind, parameters) => {
      const fixture = inboundFixture({}, initial(), parameters);
      const result = fixture.run();
      await expect(result.promise).resolves.toMatchObject({
        status: 'PREPARED',
      });
      result.done();
      expect(fixture.clientFactory.create).not.toHaveBeenCalled();
      expect(fixture.secureHttp.getHttpClient).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing scoped backend join instead of granting authority from UUIDs', async () => {
    const fixture = inboundFixture();
    const index = fixture.scenario.steps.findIndex(
      (step) => step.sql === INBOUND_ATTENTION_ADMISSION_SQL,
    );
    fixture.scenario.steps[index].rows = [];
    fixture.scenario.steps.splice(fixture.scenario.readerLength + 6);
    const result = fixture.run();
    await expect(result.promise).rejects.toMatchObject({
      callerMustRollback: true,
      failure: { code: 'AUTHORITY_REQUIRED' },
    });
    result.done();
  });

  it('captures the signed request before waiting for locks', async () => {
    const fixture = inboundFixture();
    fixture.scenario.steps[0].onQuery = () => {
      fixture.request.parameters.Body = 'mutated after invocation';
      fixture.request.rawBody = 'mutated';
      fixture.request.signature = 'mutated';
    };
    const result = fixture.run();
    await expect(result.promise).resolves.toMatchObject({ status: 'PREPARED' });
    result.done();
  });

  it('waits for the common Conversation lock before admission and writes', async () => {
    const fixture = inboundFixture();
    let releaseLock: () => void = () => {};
    let lockReached: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      lockReached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lock = fixture.scenario.steps.find(
      (step) => step.sql === ATTENTION_CONVERSATION_LOCK_SQL,
    );
    if (!lock) throw new Error('missing lock');
    lock.onQuery = async () => {
      lockReached();
      await held;
    };
    const result = fixture.run();
    await reached;
    expect(fixture.decrypt).not.toHaveBeenCalled();
    expect(result.calls.some((call) => call.sql.includes('INSERT INTO'))).toBe(
      false,
    );
    releaseLock();
    await expect(result.promise).resolves.toMatchObject({ status: 'PREPARED' });
    result.done();
  });
});
