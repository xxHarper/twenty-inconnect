import { durableFixture } from './durable-inbound.fixtures';
import {
  DURABLE_INBOUND_FACT_SQL,
  DURABLE_INBOUND_RECEIPT_LOCK_SQL,
} from '../durable-inbound-sql';

import { identifier } from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_SESSION_SQL,
  ATTENTION_SLOTS_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  ATTENTION_CAUSAL_MESSAGE_SQL,
  ATTENTION_WEBHOOK_LOCK_SQL,
  ATTENTION_COMPLETE_SQL,
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_INSERT_AUDIT_SQL,
  ATTENTION_INSERT_RECEIPT_SQL,
  ATTENTION_UPDATE_CONVERSATION_SQL,
  ATTENTION_INSERT_OUTBOX_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { READ_RECEIPT_INGRESS_CONTRACT_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('durable admission errors preserve caller-owned abort semantics', () => {
  it.each([
    ATTENTION_SLOTS_SQL.NONE,
    RECEIPT_INGRESS_SCHEMA_SQL,
    DURABLE_INBOUND_RECEIPT_LOCK_SQL,
    READ_RECEIPT_INGRESS_CONTRACT_SQL,
    DURABLE_INBOUND_FACT_SQL,
    ATTENTION_INSERT_EFFECT_SQL,
    ATTENTION_INSERT_AUDIT_SQL,
    ATTENTION_INSERT_RECEIPT_SQL,
    ATTENTION_UPDATE_CONVERSATION_SQL,
    ATTENTION_INSERT_OUTBOX_SQL,
    ATTENTION_COMPLETE_SQL,
  ])('requires rollback after SQL failure at %s', async (sql) => {
    const fixture = await durableFixture();
    fixture.scenario.steps.find((entry) => entry.sql === sql)!.error = {
      code: '57014',
      message: 'private payload',
    };
    fixture.stopAfter(sql);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it.each([
    RECEIPT_INGRESS_SCHEMA_SQL,
    DURABLE_INBOUND_RECEIPT_LOCK_SQL,
    READ_RECEIPT_INGRESS_CONTRACT_SQL,
    DURABLE_INBOUND_FACT_SQL,
  ])('rejects missing or ambiguous cardinality for %s', async (sql) => {
    for (const count of [0, 2]) {
      const fixture = await durableFixture();
      const entry = fixture.scenario.steps.find((entry) => entry.sql === sql)!;
      entry.rows = count === 0 ? [] : [entry.rows[0], entry.rows[0]];
      fixture.stopAfter(sql);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'ADMISSION_FAILED' },
      });
      harness.done();
    }
  });

  it('rejects a version projection reporting pre-DDL even after nominal schema detection', async () => {
    const fixture = await durableFixture();
    fixture.version.installed = false;
    fixture.stopAfter(READ_RECEIPT_INGRESS_CONTRACT_SQL, 2);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it.each(['createdHere', 'leaseValid'])(
    'lets the actual writer revalidate %s',
    async (field) => {
      const fixture = await durableFixture();
      const sql =
        field === 'createdHere'
          ? ATTENTION_CAUSAL_MESSAGE_SQL
          : ATTENTION_WEBHOOK_LOCK_SQL;
      const entry = fixture.scenario.steps.find((entry) => entry.sql === sql)!;
      entry.rows = [{ ...(entry.rows[0] as object), [field]: false }];
      fixture.stopAfter(sql);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'CAUSALITY_VIOLATION' },
      });
      harness.done();
    },
  );

  it.each(['infinity', '2026-02-30T12:00:00.000000Z', '0000-01-01T00:00:00Z'])(
    'rejects invalid raw timestamp %s',
    async (timestamp) => {
      const fixture = await durableFixture();
      fixture.fact.serverReceivedAt = timestamp;
      fixture.stopAfter(DURABLE_INBOUND_FACT_SQL);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'ADMISSION_FAILED' },
      });
      harness.done();
    },
  );

  it.each(['replica', 'inactive', 'different-manager', 'disconnected'])(
    'rejects runner %s without creating another',
    async (kind) => {
      const fixture = await durableFixture();
      fixture.scenario.steps.splice(0);
      const harness = fixture.start();
      if (kind === 'replica') harness.runner.mode = 'slave';
      if (kind === 'inactive') harness.runner.isTransactionActive = false;
      if (kind === 'different-manager') harness.runner.manager.queryRunner = {};
      if (kind === 'disconnected')
        Object.assign(harness.runner, { databaseConnection: null });
      await expect(harness.prepare()).rejects.toMatchObject({
        callerMustRollback: true,
        failure: { code: 'INCORRECT_TRANSACTION' },
      });
      harness.done();
    },
  );

  it('pins the manager and connection across the original R2 version reader', async () => {
    const fixture = await durableFixture();
    const entry = fixture.scenario.steps.find(
      (entry) => entry.sql === READ_RECEIPT_INGRESS_CONTRACT_SQL,
    )!;
    fixture.stopAfter(READ_RECEIPT_INGRESS_CONTRACT_SQL);
    const harness = fixture.start();
    entry.onQuery = () => {
      harness.runner.databaseConnection = {};
    };
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('rejects malformed structured SQL envelopes rather than asserting absence', async () => {
    const fixture = await durableFixture();
    fixture.scenario.steps.find(
      ({ sql }) => sql === DURABLE_INBOUND_FACT_SQL,
    )!.result = { records: [], raw: [], affected: 1 };
    fixture.stopAfter(DURABLE_INBOUND_FACT_SQL);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('captures backend references before its first await', async () => {
    const fixture = await durableFixture();
    const harness = fixture.start();
    fixture.scenario.steps[0].onQuery = () => {
      Object.assign(harness.input, {
        receiptId: identifier(99),
        leaseToken: identifier(99),
        messageId: identifier(99),
      });
      Object.assign(harness.input.scope, {
        workspaceId: identifier(99),
        trackingEpochId: identifier(99),
      });
    };
    await expect(harness.prepare()).resolves.toMatchObject({
      status: 'PREPARED',
    });
    harness.done();
  });

  it('waits for Conversation before receipt admission and checks lease after the receipt lock', async () => {
    const fixture = await durableFixture();
    let releaseConversation = () => {};
    let reachedConversation = () => {};
    const held = new Promise<void>((resolve) => {
      releaseConversation = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      reachedConversation = resolve;
    });
    fixture.scenario.steps.find(
      ({ sql }) => sql === ATTENTION_CONVERSATION_LOCK_SQL,
    )!.onQuery = async () => {
      reachedConversation();
      await held;
    };
    const harness = fixture.start();
    const preparing = harness.prepare();
    await reached;
    expect(
      harness.calls.some(({ sql }) => sql === DURABLE_INBOUND_RECEIPT_LOCK_SQL),
    ).toBe(false);
    releaseConversation();
    await preparing;
    harness.done();
    const indexOf = (sql: string) =>
      harness.calls.findIndex((call) => call.sql === sql);
    expect(indexOf(ATTENTION_CONFIGURATION_SQL)).toBeLessThan(
      indexOf(ATTENTION_CONVERSATION_LOCK_SQL),
    );
    expect(indexOf(ATTENTION_CONVERSATION_LOCK_SQL)).toBeLessThan(
      indexOf(DURABLE_INBOUND_RECEIPT_LOCK_SQL),
    );
    expect(indexOf(DURABLE_INBOUND_RECEIPT_LOCK_SQL)).toBeLessThan(
      indexOf(DURABLE_INBOUND_FACT_SQL),
    );
    expect(indexOf(DURABLE_INBOUND_FACT_SQL)).toBeLessThan(
      indexOf(ATTENTION_CAUSAL_MESSAGE_SQL),
    );
    expect(indexOf(ATTENTION_CAUSAL_MESSAGE_SQL)).toBeLessThan(
      indexOf(ATTENTION_INSERT_EFFECT_SQL),
    );
    // This proves emitted order only. The caller's PRE-INSERT locks are a precondition.
  });

  it('throws through a transactional callback after partial DML instead of allowing normal commit', async () => {
    const fixture = await durableFixture();
    fixture.scenario.steps.find(
      ({ sql }) => sql === ATTENTION_INSERT_OUTBOX_SQL,
    )!.error = new Error('write failed');
    fixture.stopAfter(ATTENTION_INSERT_OUTBOX_SQL);
    const harness = fixture.start();
    const normalCompletion = jest.fn();
    const callerUnit = async () => {
      await harness.prepare();
      normalCompletion();
    };
    await expect(callerUnit()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    expect(normalCompletion).not.toHaveBeenCalled();
    expect(
      harness.calls.some(({ sql }) => sql === ATTENTION_INSERT_AUDIT_SQL),
    ).toBe(true);
    harness.done();
    // No mock claims PostgreSQL rolled back. The real caller must abort its unit.
  });

  it('catches incompatible session isolation before querying business authority', async () => {
    const fixture = await durableFixture();
    const entry = fixture.scenario.steps[0];
    entry.rows = [
      { ...(entry.rows[0] as object), isolation: 'repeatable read' },
    ];
    fixture.stopAfter(ATTENTION_SESSION_SQL);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });
});
