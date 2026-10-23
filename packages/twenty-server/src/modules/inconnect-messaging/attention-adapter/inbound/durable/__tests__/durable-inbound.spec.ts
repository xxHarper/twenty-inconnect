import { durableEvent, durableFixture } from './durable-inbound.fixtures';
import { DURABLE_INBOUND_FACT_SQL } from '../durable-inbound-sql';
import { prepareDurableInboundAttentionWrite } from '../prepare-durable-inbound-attention-write';

import {
  apply,
  identifier,
  initial,
  pending,
  physicalRows,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  bundle,
  conversation,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_EFFECT_LINKS_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SOURCE_MESSAGE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  ATTENTION_INSERT_AUDIT_SQL,
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_INSERT_OUTBOX_SQL,
  ATTENTION_UPDATE_CONVERSATION_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { READ_RECEIPT_INGRESS_CONTRACT_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('durable v1 inbound with the actual reader/writer/C1/reducer', () => {
  it.each([
    ['new inbound', initial()],
    ['PENDING renew', pending('12')],
    ['ATTENDED reopen', { ...initial(), revision: '12' }],
    ['BigInt revision', pending('922337203685477580812345678901234567890')],
  ])('prepares %s using the exact decimal revision', async (_name, before) => {
    const fixture = await durableFixture(
      { current: conversation(before.status, before.revision) },
      before,
    );
    const harness = fixture.start();
    const result = await harness.prepare();
    expect(result).toMatchObject({
      ok: true,
      status: 'PREPARED',
      value: {
        outcome: { kind: 'APPLIED' },
        snapshot: {
          status: 'PENDING',
          revision: (BigInt(before.revision) + BigInt(1)).toString(),
        },
        originals: {
          eventResult: { kind: 'APPLIED' },
          effectResult: { kind: 'APPLIED' },
        },
      },
    });
    harness.done();
    expect(harness.managerQuery).toHaveBeenCalledWith(
      READ_RECEIPT_INGRESS_CONTRACT_SQL,
      [identifier(27), scope.workspaceId, scope.providerConnectionId],
    );
  });

  it('recovers a serialized v1 fact without request, capability or historical authToken', async () => {
    const fixture = await durableFixture();
    fixture.issuance.rotate();
    fixture.fact.credentialsVersion =
      fixture.issuance.connection.credentialsVersion;
    const decryptCount = fixture.issuance.decrypt.mock.calls.length;
    const queryCount = fixture.issuance.query.mock.calls.length;
    // No issuer/verifier service is passed to the recreated internal caller.
    const recreated = { prepare: prepareDurableInboundAttentionWrite };
    const harness = fixture.start();
    await expect(recreated.prepare(harness.input)).resolves.toMatchObject({
      status: 'PREPARED',
    });
    harness.done();
    expect(fixture.issuance.decrypt).toHaveBeenCalledTimes(decryptCount);
    expect(fixture.issuance.query).toHaveBeenCalledTimes(queryCount);
    expect(fixture.issuance.external).not.toHaveBeenCalled();
    expect(Object.keys(harness.input).sort()).toEqual([
      'leaseToken',
      'messageId',
      'queryRunner',
      'receiptId',
      'scope',
    ]);
    expect(JSON.stringify(fixture.stored)).not.toMatch(
      /signature|authToken|rawBody|encryptedCredentials/,
    );
  });

  it.each([null, 2, 0, -1, 1.1, '1', true, undefined])(
    'rejects durable version %j',
    async (version) => {
      const fixture = await durableFixture();
      fixture.version.version = version;
      fixture.stopAfter(READ_RECEIPT_INGRESS_CONTRACT_SQL, 2);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'AUTHORITY_REQUIRED' },
      });
      harness.done();
      expect(
        harness.calls.some(
          ({ sql }) =>
            sql === DURABLE_INBOUND_FACT_SQL || sql.includes('INSERT INTO'),
        ),
      ).toBe(false);
    },
  );

  it.each([
    ['pre-DDL ingress', { installed: false, compatible: true }],
    ['partial ingress schema', { installed: true, compatible: false }],
  ])(
    'rejects %s without authorization or legacy fallback',
    async (_name, schema) => {
      const fixture = await durableFixture();
      Object.assign(fixture.schema, schema);
      fixture.stopAfter(RECEIPT_INGRESS_SCHEMA_SQL, 1);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
      });
      harness.done();
    },
  );

  it.each([
    [
      'pre-DDL attention',
      {
        installed: false,
        mode: null,
        protocolVersion: null,
        gateUpdatedAt: null,
      },
      'SCHEMA_NOT_INSTALLED',
    ],
    ['DISABLED', { mode: 'DISABLED' }, 'TRACKING_DISABLED'],
    ['PREPARING', { mode: 'PREPARING' }, 'TRACKING_PREPARING'],
    ['SUSPENDED', { mode: 'SUSPENDED' }, 'TRACKING_SUSPENDED'],
    ['unsupported protocol', { protocolVersion: 2 }, 'INCOMPATIBLE_VERSION'],
  ])(
    'refuses %s via C2-II before durable admission',
    async (_name, change, code) => {
      const fixture = await durableFixture();
      const entry = fixture.scenario.steps.find(
        ({ sql }) => sql === ATTENTION_CONFIGURATION_SQL,
      )!;
      entry.rows = [{ ...(entry.rows[0] as object), ...change }];
      fixture.stopAfter(ATTENTION_CONFIGURATION_SQL);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        failure: { code },
        callerMustRollback: true,
      });
      harness.done();
      expect(
        harness.calls.some(({ sql }) => sql === RECEIPT_INGRESS_SCHEMA_SQL),
      ).toBe(false);
    },
  );

  it.each([
    ['workspaceId', identifier(99)],
    ['providerConnectionId', identifier(99)],
    ['connectionId', identifier(99)],
    ['connectionWorkspaceId', identifier(99)],
    ['conversationId', identifier(99)],
    ['currentEpochId', identifier(99)],
    ['messageId', identifier(99)],
    ['messageWorkspaceId', identifier(99)],
    ['messageConnectionId', identifier(99)],
    ['messageConversationId', identifier(99)],
    ['originEpochId', identifier(99)],
    ['originEpochId', null],
    ['receiptId', identifier(99)],
    ['leaseToken', identifier(99)],
    ['leaseValid', false],
    ['leaseValid', null],
    ['processingState', 'PROCESSED'],
    ['processingState', 'FAILED'],
    ['processingState', 'RECEIVED'],
    ['processedAt', '2026-10-22T12:00:00.000Z'],
    ['attemptCount', 0],
    ['lifecycleStatus', 'DISABLED'],
    ['provider', 'OTHER'],
    ['channel', 'SMS'],
    ['inboundRoutingKey', ''],
    ['credentialsVersion', null],
    ['credentialsVersion', 0],
    ['credentialsConfigured', false],
    ['routingCount', '0'],
    ['routingCount', '2'],
    ['eventKind', 'STATUS_CALLBACK'],
    ['direction', 'OUTBOUND'],
    ['sendMode', 'FREEFORM'],
    ['outboundState', 'SENT'],
    ['providerMessageId', 'foreign-message'],
    ['idempotencyKey', 'foreign-key'],
    ['payloadHash', 'fake'],
    ['body', 'alterado'],
    ['type', 'IMAGE'],
    ['providerMetadata', {}],
    ['externalAddressNormalized', '+14155238886'],
    ['serverReceivedAt', '2026-10-22T12:00:00.000001Z'],
    ['firstReceivedAt', '2026-10-22T12:00:00.000001Z'],
    ['effectiveInboundAt', '2026-10-22T12:00:00.001Z'],
    ['providerOccurredAt', '2026-10-22T12:00:00.000Z'],
    ['timestampSource', 'PROVIDER'],
    ['normalizedMetadata', {}],
    [
      'attachments',
      [
        {
          ordinal: 0,
          type: 'IMAGE',
          declaredMimeType: 'image/jpeg',
          safeFilename: 'extra',
        },
      ],
    ],
  ])('fails closed for backend mismatch %s=%j', async (field, value) => {
    const fixture = await durableFixture();
    fixture.fact[field] = value;
    // Decoder exceptions are caught as ADMISSION_FAILED; a null denial still
    // executes the writer's continuity check. Invalid timestamp syntax is tested separately.
    fixture.stopAfter(DURABLE_INBOUND_FACT_SQL, 2);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
      failure: { code: 'AUTHORITY_REQUIRED' },
    });
    harness.done();
    expect(harness.calls.some(({ sql }) => sql.includes('INSERT INTO'))).toBe(
      false,
    );
  });

  it.each([
    ['normalizer version', { normalizerVersion: 2 }],
    ['unknown field', { authenticated: true }],
    [
      'metadata version',
      { providerMetadata: { provider: 'TWILIO', version: 2 } },
    ],
    ['key contradiction', { idempotencyKey: 'different' }],
    ['waId contradiction', { waId: 'different' }],
    ['timestamp contradiction', { timestampSource: 'PROVIDER' }],
  ])('rejects %s in the frozen v1 normalized shape', async (_name, change) => {
    const fixture = await durableFixture();
    Object.assign(fixture.normalized, change);
    fixture.stopAfter(DURABLE_INBOUND_FACT_SQL, 2);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it.each(['canonical replay', 'new alias', 'alias replay'])(
    'preserves separate originals for %s',
    async (kind) => {
      const incoming = durableEvent();
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
      const fixture = await durableFixture(
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
      const harness = fixture.start();
      await expect(harness.prepare()).resolves.toMatchObject({
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
      harness.done();
      expect(
        harness.calls.some(({ sql }) =>
          [
            ATTENTION_INSERT_EFFECT_SQL,
            ATTENTION_UPDATE_CONVERSATION_SQL,
            ATTENTION_INSERT_OUTBOX_SQL,
          ].includes(sql),
        ),
      ).toBe(false);
    },
  );

  it('propagates a real C1 conflict, never returning PREPARED normally', async () => {
    const rows = physicalRows({ ...durableEvent(), messageId: identifier(11) });
    const fixture = await durableFixture(
      {
        current: conversation('PENDING', '1'),
        receipt: rows.canonicalReceipt,
        effect: null,
        originalAudit: rows.canonicalAudit,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
      rows.transition.state,
    );
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
      failure: { code: 'CAUSAL_OPERATION_REJECTED' },
    });
    harness.done();
    expect(
      harness.calls.some(({ sql }) => sql === ATTENTION_INSERT_AUDIT_SQL),
    ).toBe(true);
    expect(
      harness.calls.some(({ sql }) => sql === ATTENTION_INSERT_EFFECT_SQL),
    ).toBe(false);
  });

  it('rejects a forged IGNORED inbound original rather than inventing inbound semantics', async () => {
    const rows = physicalRows(durableEvent());
    const fixture = await durableFixture(
      {
        current: conversation('PENDING', '1'),
        receipt: rows.canonicalReceipt,
        effect: rows.effect,
        originalAudit: rows.canonicalAudit,
        bundles: {
          [rows.effect.id]: bundle({
            ...rows,
            canonicalAudit: {
              ...rows.canonicalAudit,
              result: { ...rows.canonicalAudit.result, kind: 'IGNORED' },
            },
          }),
        },
      },
      rows.transition.state,
    );
    fixture.stopAfter(ATTENTION_EFFECT_LINKS_SQL);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('refuses a legacy source Message without adopting an epoch', async () => {
    const fixture = await durableFixture();
    const entry = fixture.scenario.steps.find(
      ({ sql }) => sql === ATTENTION_SOURCE_MESSAGE_SQL,
    )!;
    entry.rows = [
      {
        message: {
          ...(entry.rows[0] as { message: object }).message,
          attentionTrackingEpochId: null,
        },
      },
    ];
    fixture.stopAfter(ATTENTION_SOURCE_MESSAGE_SQL);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it.each(['PREPARING', 'SUSPENDED', 'CLOSED'])(
    'requires a READY epoch rather than %s',
    async (lifecycle) => {
      const fixture = await durableFixture();
      const entry = fixture.scenario.steps.find(
        ({ sql }) => sql === ATTENTION_ROOT_SQL,
      )!;
      const root = entry.rows[0] as { conversation: object; epoch: object };
      entry.rows = [
        {
          ...root,
          epoch: {
            ...root.epoch,
            lifecycle,
            ...(lifecycle === 'PREPARING' ? { activatedAt: null } : {}),
            ...(lifecycle === 'CLOSED'
              ? { closedAt: '2026-10-22T00:00:00.000Z' }
              : {}),
          },
        },
      ];
      fixture.stopAfter(ATTENTION_ROOT_SQL);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: `EPOCH_${lifecycle}` },
      });
      harness.done();
    },
  );

  it('does not claim that a last connection SELECT serializes a nonparticipating revoker', async () => {
    const fixture = await durableFixture();
    const entry = fixture.scenario.steps.find(
      ({ sql }) => sql === ATTENTION_INSERT_EFFECT_SQL,
    )!;
    entry.onQuery = () => {
      fixture.issuance.connection.lifecycleStatus = 'DISABLED';
    };
    const harness = fixture.start();
    // Counterexample under mocked interleaving, not a PostgreSQL acceptance claim.
    await expect(harness.prepare()).resolves.toMatchObject({
      status: 'PREPARED',
    });
    expect(fixture.issuance.connection.lifecycleStatus).toBe('DISABLED');
    harness.done();
  });
});
