import {
  scope,
  identifier,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_ROOT_SQL,
  ATTENTION_CONFIGURATION_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  ATTENTION_INSERT_AUDIT_SQL,
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_INSERT_RECEIPT_SQL,
  ATTENTION_INSERT_OUTBOX_SQL,
  ATTENTION_CAUSAL_MESSAGE_SQL,
  ATTENTION_COMPLETE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { DURABLE_INBOUND_FACT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';
import * as sql from '../tracked-inbound-sql';
import { causalFixture } from './tracked-inbound.fixtures';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('causal unit aborts at every boundary without a partial success', () => {
  it.each([
    sql.INBOUND_CREATE_CONVERSATION_SQL,
    sql.INBOUND_LOCK_CONVERSATION_SQL,
    sql.INBOUND_CREATE_EPOCH_SQL,
    sql.INBOUND_PREPARE_POINTER_SQL,
    sql.INBOUND_READY_EPOCH_SQL,
    sql.INBOUND_LOCK_RECEIPT_SQL,
    sql.INBOUND_INSERT_MESSAGE_SQL,
    sql.INBOUND_INSERT_ATTACHMENT_SQL,
    sql.INBOUND_UPDATE_ACTIVITY_SQL,
    ATTENTION_INSERT_EFFECT_SQL,
    ATTENTION_INSERT_AUDIT_SQL,
    ATTENTION_INSERT_RECEIPT_SQL,
    ATTENTION_INSERT_OUTBOX_SQL,
    ATTENTION_COMPLETE_SQL,
    sql.INBOUND_INSERT_OUTBOX_SQL,
    sql.INBOUND_FINALIZE_RECEIPT_SQL,
  ])('requires full rollback when SQL fails at %s', async (statement) => {
    const fixture = await causalFixture({
      form: {
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media',
        MediaContentType0: 'image/jpeg',
      },
    });
    const index = fixture.steps.findIndex((entry) => entry.sql === statement);
    expect(index).toBeGreaterThanOrEqual(0);
    fixture.steps[index].error = Object.assign(
      new Error('unsafe driver text'),
      { code: '57014' },
    );
    fixture.steps.splice(index + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toBeInstanceOf(Error);
    harness.done();
    expect(harness.runner.commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    sql.INBOUND_CREATE_EPOCH_SQL,
    sql.INBOUND_PREPARE_POINTER_SQL,
    sql.INBOUND_READY_EPOCH_SQL,
    sql.INBOUND_INSERT_MESSAGE_SQL,
    sql.INBOUND_INSERT_OUTBOX_SQL,
    sql.INBOUND_FINALIZE_RECEIPT_SQL,
  ])('rejects affected=0 at %s', async (statement) => {
    const fixture = await causalFixture();
    const index = fixture.steps.findIndex((entry) => entry.sql === statement);
    fixture.steps[index].rows = [];
    fixture.steps.splice(index + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toBeInstanceOf(Error);
    harness.done();
  });

  it.each(['DISABLED', 'PREPARING', 'SUSPENDED', 'invalid'])(
    'rejects gate %s before Conversation/Message writes',
    async (mode) => {
      const fixture = await causalFixture();
      const index = fixture.steps.findIndex(
        (entry) => entry.sql === ATTENTION_CONFIGURATION_SQL,
      );
      fixture.steps[index].rows = [
        { ...(fixture.steps[index].rows[0] as object), mode },
      ];
      fixture.steps.splice(index + 1);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        category: 'TRACKING_NOT_READY',
      });
      harness.done();
    },
  );

  it.each([null, 2, '1'])(
    'never promotes receipt version %s',
    async (version) => {
      const fixture = await causalFixture();
      fixture.locator.version = version as number;
      fixture.steps.splice(
        fixture.steps.findIndex(
          (entry) => entry.sql === sql.INBOUND_LOCATOR_SQL,
        ) + 1,
      );
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        category: 'UNACCREDITED_RECEIPT',
      });
      harness.done();
    },
  );

  it.each(['PREPARING', 'SUSPENDED', 'CLOSED'])(
    'rejects existing Epoch %s',
    async (lifecycle) => {
      const fixture = await causalFixture({ fresh: false });
      Object.assign(fixture.root.epoch, {
        lifecycle,
        closedAt:
          lifecycle === 'CLOSED' ? fixture.root.epoch.activatedAt : null,
      });
      fixture.steps.splice(
        fixture.steps.findIndex((entry) => entry.sql === ATTENTION_ROOT_SQL) +
          1,
      );
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toBeInstanceOf(Error);
      harness.done();
    },
  );

  it('leaves an unprepared historical Conversation NOT_READY', async () => {
    const fixture = await causalFixture({ fresh: false });
    Object.assign(fixture.root.conversation, {
      attentionTrackingEpochId: null,
      attentionRevision: null,
      attentionStatus: null,
    });
    fixture.steps.splice(
      fixture.steps.findIndex((entry) => entry.sql === ATTENTION_ROOT_SQL) + 1,
    );
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      category: 'HISTORICAL_CONVERSATION_NOT_READY',
    });
    harness.done();
  });

  it.each([
    { direction: 'OUTBOUND' },
    { attentionTrackingEpochId: null },
    { attentionTrackingEpochId: identifier(99) },
    { workspaceId: identifier(99) },
    { conversationId: identifier(99) },
  ])(
    'rejects contradictory Message %j without adopting its epoch',
    async (changes) => {
      const fixture = await causalFixture({ fresh: false, duplicate: true });
      const index = fixture.steps.findIndex(
        (entry) => entry.sql === sql.INBOUND_MESSAGE_SQL,
      );
      Object.assign(fixture.steps[index].rows[0] as object, changes);
      fixture.steps.splice(index + 1);
      const harness = fixture.start();
      await expect(harness.prepare()).rejects.toMatchObject({
        category: 'CONTRADICTORY_MESSAGE',
      });
      harness.done();
    },
  );

  it.each([
    { leaseToken: identifier(99) },
    { leaseValid: false },
    { processingState: 'PROCESSED' },
    { processingState: 'RECEIVED' },
    { attemptCount: 0 },
    { unfinished: false },
  ])('revalidates lease after waits: %j', async (changes) => {
    const fixture = await causalFixture();
    Object.assign(fixture.lease, changes);
    fixture.steps.splice(
      fixture.steps.findIndex(
        (entry) => entry.sql === sql.INBOUND_RECEIPT_LEASE_SQL,
      ) + 1,
    );
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      category: 'LEASE_LOST',
    });
    harness.done();
  });

  it('does not confirm Message after R3 detects a content mismatch', async () => {
    const fixture = await causalFixture();
    fixture.durable.fact.body = 'changed';
    const index = fixture.steps.findIndex(
      (entry) => entry.sql === DURABLE_INBOUND_FACT_SQL,
    );
    // Admission verifies its session before returning authority=null; III-A
    // then checks its outer session before classifying the denial.
    fixture.steps.splice(index + 3);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('rejects an old Message with no consumed effect instead of fabricating a causal INSERT', async () => {
    const fixture = await causalFixture({ fresh: false, duplicate: true });
    const index = fixture.steps.findIndex(
      (entry) => entry.sql === ATTENTION_CAUSAL_MESSAGE_SQL,
    );
    Object.assign(fixture.steps[index].rows[0] as object, {
      createdHere: false,
    });
    fixture.steps.splice(index + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('revalidates the entire Receipt after acquiring its lock', async () => {
    const fixture = await causalFixture();
    const indices = fixture.steps
      .map((entry, index) =>
        entry.sql === sql.INBOUND_LOCATOR_SQL ? index : -1,
      )
      .filter((index) => index >= 0);
    fixture.steps[indices[1]].rows = [
      { ...fixture.locator, payloadHash: 'changed' },
    ];
    fixture.steps.splice(indices[1] + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      category: 'RECEIPT_FACT_CHANGED',
    });
    harness.done();
  });

  it('rejects a disabled/revoked connection before inserting Conversation', async () => {
    const fixture = await causalFixture();
    const index = fixture.steps.findIndex(
      (entry) => entry.sql === sql.INBOUND_CONNECTION_SQL,
    );
    fixture.steps[index].rows = [];
    fixture.steps.splice(index + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toBeInstanceOf(Error);
    harness.done();
  });

  it.each([
    { installed: false },
    { protocolVersion: 2 },
    { gateUpdatedAt: null },
  ])('rejects incomplete ENABLED %j before causal DML', async (changes) => {
    const fixture = await causalFixture();
    const index = fixture.steps.findIndex(
      (entry) => entry.sql === ATTENTION_CONFIGURATION_SQL,
    );
    Object.assign(fixture.steps[index].rows[0] as object, changes);
    fixture.steps.splice(index + 1);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      category: 'TRACKING_NOT_READY',
    });
    harness.done();
  });

  it('waits for the winning Conversation lock before reading its epoch or Receipt', async () => {
    const fixture = await causalFixture();
    let unblock: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    fixture.steps.find(
      (entry) => entry.sql === sql.INBOUND_LOCK_CONVERSATION_SQL,
    )!.onQuery = () => barrier;
    const harness = fixture.start();
    const result = harness.prepare();
    for (let count = 0; count < 50; count++) await Promise.resolve();
    expect(harness.calls[harness.calls.length - 1].sql).toBe(
      sql.INBOUND_LOCK_CONVERSATION_SQL,
    );
    expect(
      harness.calls.some((call) => call.sql === sql.INBOUND_LOCK_RECEIPT_SQL),
    ).toBe(false);
    unblock();
    await result;
    harness.done();
    expect(scope.workspaceId).toBe(fixture.claim.workspaceId);
  });
});
