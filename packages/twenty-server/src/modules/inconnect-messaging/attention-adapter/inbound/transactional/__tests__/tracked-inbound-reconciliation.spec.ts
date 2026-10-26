import { causalFixture } from './tracked-inbound.fixtures';
import {
  reconcileTrackedInbound,
  INBOUND_COMMITTED_FACT_SQL,
  INBOUND_COMMITTED_ORIGINAL_SQL,
  INBOUND_RECONCILE_MESSAGE_SQL,
} from '../reconcile-tracked-inbound';
import {
  INBOUND_LOCATOR_SQL,
  INBOUND_ORIGINAL_OUTBOX_SQL,
} from '../tracked-inbound-sql';
import {
  physicalRows,
  initial,
  apply,
  scope,
  identifier,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  bundle,
  conversation,
  script,
  sessionRow,
  step,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { writerRunner } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import { READ_RECEIPT_INGRESS_CONTRACT_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import { DURABLE_INBOUND_FACT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

const reconciliationFixture = async () => {
  const fixture = await causalFixture();
  const rows = physicalRows(fixture.event, initial());
  const fact = {
    ...fixture.durable.fact,
    processingState: 'PROCESSED',
    leaseToken: null,
    leaseValid: null,
    processedAt: '2026-10-23 12:00:00.123456+00',
  };
  const authenticationReference = JSON.stringify([
    'durable-inbound-t1-v1',
    identifier(27),
    fixture.durable.stored.payloadHash,
  ]);
  const correlationReference = JSON.stringify([
    'inbound-cause-v1',
    identifier(27),
    identifier(10),
    'provider-message',
  ]);
  Object.assign(rows.canonicalAudit, {
    authenticationReference,
    correlationReference,
  });
  const reading = script({
    event: fixture.event,
    current: conversation('PENDING', '1'),
    effect: rows.effect,
    receipt: rows.canonicalReceipt,
    originalAudit: rows.canonicalAudit,
    bundles: { [rows.effect.id]: bundle(rows) },
  });
  const parameters = [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
  ];
  const payload = {
    messageId: identifier(10),
    conversationId: scope.conversationId,
    providerConnectionId: scope.providerConnectionId,
    messageType: fixture.durable.normalized.messageType,
    effectiveInboundAt: fixture.durable.normalized.effectiveInboundAt,
  };
  const key = `inconnect-messaging:receipt:${identifier(27)}:message`;
  const original = {
    outboxId: identifier(103),
    authorityKind: 'BACKEND',
    authenticationReference,
    correlationReference,
  };
  const inbound = {
    id: identifier(200),
    workspaceId: scope.workspaceId,
    aggregateType: 'MESSAGE',
    aggregateId: identifier(10),
    eventType: 'INBOUND_MESSAGE_RECEIVED',
    immutablePayload: payload,
    deduplicationKey: key,
  };
  const steps = [
    step(ATTENTION_SESSION_SQL, [], [sessionRow]),
    step(
      INBOUND_LOCATOR_SQL,
      [identifier(27), scope.workspaceId, scope.providerConnectionId],
      [fixture.locator],
    ),
    step(
      INBOUND_RECONCILE_MESSAGE_SQL,
      [scope.workspaceId, scope.providerConnectionId, 'provider-message'],
      [
        {
          id: identifier(10),
          conversationId: scope.conversationId,
          attentionTrackingEpochId: scope.trackingEpochId,
        },
      ],
    ),
    ...reading.steps,
    step(
      RECEIPT_INGRESS_SCHEMA_SQL,
      [],
      [{ installed: true, compatible: true }],
    ),
    step(
      READ_RECEIPT_INGRESS_CONTRACT_SQL,
      [identifier(27), scope.workspaceId, scope.providerConnectionId],
      [{ installed: true, version: 1 }],
    ),
    step(
      INBOUND_COMMITTED_FACT_SQL,
      [...parameters, identifier(27), identifier(10)],
      [fact],
    ),
    step(
      INBOUND_COMMITTED_ORIGINAL_SQL,
      [...parameters, fixture.event.eventKey],
      [original],
    ),
    step(INBOUND_ORIGINAL_OUTBOX_SQL, [key], [inbound]),
    step(ATTENTION_SESSION_SQL, [], [sessionRow]),
  ];
  const start = () => {
    const harness = writerRunner(steps);
    Object.assign(harness.runner.manager, {
      query: async (statement: string, values: unknown[]) =>
        (await harness.queryRunner.query(statement, values, true)).records,
    });
    return {
      ...harness,
      reconcile: () =>
        reconcileTrackedInbound(harness.queryRunner, fixture.claim),
    };
  };
  return { fixture, fact, original, inbound, rows, reading, steps, start };
};

describe('commit reconciliation reads durable PROCESSED originals without a fake claim', () => {
  it('recovers committed identity and both outboxes using real C2-II and C1', async () => {
    const fixture = await reconciliationFixture();
    const harness = fixture.start();
    const result = await harness.reconcile();
    harness.done();
    expect(result.status).toBe('RECONCILED');
    expect(result.originals.eventResult).toEqual(result.originals.effectResult);
    expect(result.originals.effectResult.kind).toBe('APPLIED');
    expect(result.publicationRequests).toHaveLength(2);
    expect(
      harness.calls.every(
        (call) => !/INSERT INTO|UPDATE core|SET CONSTRAINTS/.test(call.sql),
      ),
    ).toBe(true);
    expect(INBOUND_COMMITTED_FACT_SQL).not.toBe(DURABLE_INBOUND_FACT_SQL);
    expect(INBOUND_COMMITTED_FACT_SQL).toContain(
      'w."processedAt"::text AS "processedAt"',
    );
  });

  it.each([
    { processingState: 'RECEIVED' },
    { processingState: 'PROCESSING' },
    { leaseToken: identifier(28) },
    { body: 'different' },
    { originEpochId: null },
    { direction: 'OUTBOUND' },
    { lifecycleStatus: 'DISABLED' },
  ])('refuses unproven committed state %j', async (changes) => {
    const fixture = await reconciliationFixture();
    Object.assign(fixture.fact, changes);
    fixture.steps.splice(
      fixture.steps.findIndex(
        (entry) => entry.sql === INBOUND_COMMITTED_FACT_SQL,
      ) + 1,
    );
    const harness = fixture.start();
    await expect(harness.reconcile()).rejects.toMatchObject({
      category: 'RECONCILIATION_NOT_PROVEN',
    });
    harness.done();
  });

  it.each(['authenticationReference', 'correlationReference', 'authorityKind'])(
    'requires the original durable %s',
    async (field) => {
      const fixture = await reconciliationFixture();
      Object.assign(fixture.original, { [field]: 'different' });
      fixture.steps.splice(
        fixture.steps.findIndex(
          (entry) => entry.sql === INBOUND_COMMITTED_ORIGINAL_SQL,
        ) + 1,
      );
      const harness = fixture.start();
      await expect(harness.reconcile()).rejects.toMatchObject({
        category: 'RECONCILIATION_NOT_PROVEN',
      });
      harness.done();
    },
  );

  it.each([INBOUND_COMMITTED_ORIGINAL_SQL, INBOUND_ORIGINAL_OUTBOX_SQL])(
    'rejects a missing original/Outbox at %s',
    async (statement) => {
      const fixture = await reconciliationFixture();
      const index = fixture.steps.findIndex((entry) => entry.sql === statement);
      fixture.steps[index].rows = [];
      fixture.steps.splice(index + 1);
      const harness = fixture.start();
      await expect(harness.reconcile()).rejects.toBeInstanceOf(Error);
      harness.done();
    },
  );

  it('does not reinterpret a legacy PROCESSED receipt with no ledger as a new event', async () => {
    const fixture = await reconciliationFixture();
    const absent = script({
      event: fixture.fixture.event,
      current: conversation('PENDING', '1'),
    });
    fixture.steps.splice(3, fixture.steps.length - 3, ...absent.steps);
    const harness = fixture.start();
    await expect(harness.reconcile()).rejects.toMatchObject({
      category: 'RECONCILIATION_NOT_PROVEN',
    });
    harness.done();
    expect(apply(initial(), fixture.fixture.event).kind).toBe('APPLIED');
  });
});
