import { type Repository } from 'typeorm';

import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { legacyInboundFixture } from '../../__tests__/legacy-inbound.fixtures';
import {
  INBOUND_ROUTE_SQL,
  INBOUND_ROUTE_PAUSE_CATEGORY,
  INBOUND_ROUTE_PAUSE_MILLISECONDS,
} from '../inbound-route-boundary';
import { cooldownOrmFixture } from './inbound-cooldown-orm.fixtures';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service',
  () => ({ InconnectMessagingOutboxService: class {} }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service',
  () => ({ InconnectMessagingMediaIngestionService: class {} }),
);

const gate = (mode: string) => ({
  columns: 3,
  mode,
  protocolVersion: 1,
  gateUpdatedAt: '2026-10-26T12:00:00.000Z',
});
const fixtureWithGate = (
  readGate: (number: number) => unknown | Promise<unknown>,
) => {
  const fixture = legacyInboundFixture();
  let reads = 0;
  const query = jest.fn(async (statement) => {
    expect(statement).toBe(INBOUND_ROUTE_SQL);
    return readGate(++reads);
  });
  const originalTransaction = fixture.transaction.getMockImplementation()!;
  fixture.transaction.mockImplementation(async (callback) =>
    originalTransaction(async (manager) => {
      Object.assign(manager, { query });
      const repository = manager.getRepository(
        InconnectMessagingWebhookReceiptEntity,
      );
      // These are lifecycle doubles only; SQL/persistence is covered separately
      // by inbound-cooldown-orm with the real Repository and pg boundary.
      jest.mocked(repository.findOne).mockImplementation(async () => {
        const receipt =
          fixture.receipt as InconnectMessagingWebhookReceiptEntity;
        if (
          receipt.eventKind === 'INBOUND_MESSAGE' &&
          receipt.processingState === 'RECEIVED' &&
          receipt.error?.category === INBOUND_ROUTE_PAUSE_CATEGORY &&
          receipt.updatedAt.getTime() + INBOUND_ROUTE_PAUSE_MILLISECONDS >
            Date.now()
        )
          return null;
        return receipt;
      });
      return callback(manager);
    }),
  );
  return {
    ...fixture,
    receipt: fixture.receipt as InconnectMessagingWebhookReceiptEntity,
    query,
  };
};

describe('F1 operational worker preserves paused inbound without charging attempts', () => {
  it.each(['PREPARING', 'SUSPENDED', 'ENABLED'])(
    'keeps RECEIVED for %s before transport claim and emits no causal writes',
    async (mode) => {
      const fixture = fixtureWithGate(() => [gate(mode)]);
      await fixture.service.processReceipt(fixture.receipt.id);
      expect(fixture.receipt.processingState).toBe('RECEIVED');
      expect(fixture.receipt.attemptCount).toBe(0);
      expect(fixture.receipt.leaseToken).toBeNull();
      expect(fixture.receipt.error).toEqual({
        category: INBOUND_ROUTE_PAUSE_CATEGORY,
      });
      expect(fixture.writes).toEqual([]);
      expect(fixture.releaseUpdate).not.toHaveBeenCalled();
      const receiptRepository = fixture.repository(
        InconnectMessagingWebhookReceiptEntity,
      ) as unknown as Repository<InconnectMessagingWebhookReceiptEntity>;
      expect(receiptRepository.findOne).toHaveBeenLastCalledWith(
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
          where: expect.objectContaining({
            workspaceId: fixture.receipt.workspaceId,
            providerConnectionId: fixture.receipt.providerConnectionId,
          }),
        }),
      );
      expect(fixture.query.mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(receiptRepository.findOne).mock.invocationCallOrder[1],
      );
    },
  );
  it.each([{ columns: 0, mode: null }, gate('DISABLED')])(
    'processes authorized compatibility %j',
    async (configuration) => {
      const fixture = fixtureWithGate(() => [configuration]);
      await fixture.service.processReceipt(fixture.receipt.id);
      expect(fixture.receiptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ leaseToken: expect.any(String) }),
        expect.objectContaining({ processingState: 'PROCESSED' }),
      );
      expect(fixture.receipt.attemptCount).toBe(1);
      expect(fixture.query).toHaveBeenCalledTimes(2); // Gate remains locked per transaction.
      expect(fixture.requestPublication).toHaveBeenCalled();
    },
  );
  it.each([
    { columns: 1, mode: 'DISABLED' },
    { columns: 2, mode: 'PREPARING' },
    gate('corrupt'),
    { ...gate('DISABLED'), protocolVersion: -1 },
    { ...gate('DISABLED'), gateUpdatedAt: 'invalid' },
    { ...gate('SUSPENDED'), protocolVersion: -1 },
    { ...gate('ENABLED'), protocolVersion: 2 },
    { ...gate('PREPARING'), gateUpdatedAt: null },
  ])(
    'does not treat partial/corrupt configuration as a pause %j',
    async (configuration) => {
      const fixture = fixtureWithGate(() => [configuration]);
      await expect(
        fixture.service.processReceipt(fixture.receipt.id),
      ).rejects.toMatchObject({ category: 'RECEIPT_NOT_PROCESSABLE' });
      expect(fixture.receipt.error?.category).not.toBe(
        INBOUND_ROUTE_PAUSE_CATEGORY,
      );
      expect(fixture.receipt.attemptCount).toBe(0);
      expect(fixture.writes).toEqual([]);
    },
  );
  it('propagates SQL failure instead of interpreting it as a legitimate pause', async () => {
    const fixture = fixtureWithGate(() => {
      throw Object.assign(new Error('gate SQL failure'), { code: '40P01' });
    });
    await expect(
      fixture.service.processReceipt(fixture.receipt.id),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(fixture.receipt.error?.category).not.toBe(
      INBOUND_ROUTE_PAUSE_CATEGORY,
    );
    expect(fixture.writes).toEqual([]);
  });
  it.each(['PREPARING', 'SUSPENDED', 'ENABLED'])(
    'refunds only its exact claim when the gate changes after claim to %s',
    async (mode) => {
      const fixture = fixtureWithGate((number) => [
        gate(number === 1 ? 'DISABLED' : mode),
      ]);
      await fixture.service.processReceipt(fixture.receipt.id);
      expect(fixture.receipt.attemptCount).toBe(1); // Snapshot of committed claim.
      expect(fixture.releaseUpdate).toHaveBeenCalledWith(
        {
          id: fixture.receipt.id,
          workspaceId: fixture.receipt.workspaceId,
          providerConnectionId: fixture.receipt.providerConnectionId,
          eventKind: 'INBOUND_MESSAGE',
          processingState: 'PROCESSING',
          leaseToken: fixture.receipt.leaseToken,
          attemptCount: 1,
        },
        expect.objectContaining({
          processingState: 'RECEIVED',
          error: {
            category: INBOUND_ROUTE_PAUSE_CATEGORY,
            refundedAttemptCount: 1,
          },
          attemptCount: expect.any(Function),
        }),
      );
      expect(
        (
          fixture.releaseUpdate.mock.calls as unknown as [
            unknown,
            { attemptCount: () => string },
          ][]
        )[0][1].attemptCount(),
      ).toBe('"attemptCount" - 1');
      expect(fixture.writes).toEqual([]);
      expect(fixture.receiptUpdate).not.toHaveBeenCalled();
      expect(fixture.order).toContain('reject-2');
    },
  );
  it('retains the common gate lock until processing commits despite a requested later change', async () => {
    const fixture = fixtureWithGate(() => [gate('DISABLED')]);
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(INBOUND_ROUTE_SQL).toContain('FOR SHARE');
    expect(fixture.order.indexOf('commit-2')).toBeLessThan(
      fixture.order.indexOf('publish'),
    );
    expect(fixture.query).toHaveBeenCalledTimes(2);
  });
  it('repeated jobs during the pause neither claim nor refresh the durable cooldown', async () => {
    const fixture = fixtureWithGate(() => [gate('PREPARING')]);
    await fixture.service.processReceipt(fixture.receipt.id);
    const savedAt = fixture.receipt.updatedAt;
    const repository = fixture.repository(
      InconnectMessagingWebhookReceiptEntity,
    ) as unknown as Repository<InconnectMessagingWebhookReceiptEntity>;
    const saves = jest.mocked(repository.save).mock.calls.length;
    for (let count = 0; count < 12; count++)
      await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.receipt.attemptCount).toBe(0);
    expect(fixture.receipt.updatedAt).toBe(savedAt);
    expect(repository.save).toHaveBeenCalledTimes(saves);
    expect(fixture.writes).toEqual([]);
  });
  it('recovers after resumption and excludes cooldown rows before LIMIT in the existing recovery', async () => {
    let mode = 'SUSPENDED';
    const fixture = fixtureWithGate(() => [gate(mode)]);
    await fixture.service.processReceipt(fixture.receipt.id);
    const orm = await cooldownOrmFixture({
      error: { category: INBOUND_ROUTE_PAUSE_CATEGORY },
      updatedAt: new Date(),
    });
    expect(await orm.recovery.recoverPendingReceipts()).toBe(0);
    expect(orm.add).not.toHaveBeenCalled();
    fixture.receipt.updatedAt = new Date(
      Date.now() - INBOUND_ROUTE_PAUSE_MILLISECONDS,
    );
    mode = 'DISABLED';
    orm.advance(INBOUND_ROUTE_PAUSE_MILLISECONDS);
    expect(await orm.recovery.recoverPendingReceipts()).toBe(1);
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.receipt.attemptCount).toBe(1);
    expect(fixture.receiptUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingState: 'PROCESSED' }),
    );
    orm.done();
  });
  it('consecutive rollout pauses after each cooldown never exhaust ten claims', async () => {
    const fixture = fixtureWithGate(() => [gate('PREPARING')]);
    for (let count = 0; count < 15; count++) {
      fixture.receipt.updatedAt = new Date(
        Date.now() - INBOUND_ROUTE_PAUSE_MILLISECONDS,
      );
      await fixture.service.processReceipt(fixture.receipt.id);
    }
    expect(fixture.receipt.attemptCount).toBe(0);
    expect(fixture.receipt.processingState).toBe('RECEIVED');
    expect(fixture.releaseUpdate).not.toHaveBeenCalled();
  });
  it('does not clear a live lease held by another worker', async () => {
    const fixture = fixtureWithGate(() => [gate('SUSPENDED')]);
    fixture.receipt.processingState = 'PROCESSING';
    fixture.receipt.leaseToken = 'other-owner';
    fixture.receipt.leaseExpiresAt = new Date(Date.now() + 300_000);
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.receipt.leaseToken).toBe('other-owner');
    expect(fixture.receipt.processingState).toBe('PROCESSING');
    expect(fixture.releaseUpdate).not.toHaveBeenCalled();
  });
  it('ignores inbound gate for STATUS_CALLBACK', async () => {
    const fixture = fixtureWithGate(() => {
      throw new Error('must not read inbound gate');
    });
    fixture.receipt.eventKind = 'STATUS_CALLBACK';
    // A malformed callback retains its previous disposition, without gate access.
    fixture.receipt.normalizedMetadata = {};
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.releaseUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        processingState: 'FAILED',
        error: { category: 'MALFORMED_PAYLOAD' },
      }),
    );
  });
  it('does not refund or clear a lease acquired by another worker after the gate rejection', async () => {
    const fixture = fixtureWithGate((number) => [
      gate(number === 1 ? 'DISABLED' : 'SUSPENDED'),
    ]);
    const persisted: Record<string, unknown> = {
      ...fixture.receipt,
      processingState: 'PROCESSING',
      attemptCount: 2,
      leaseToken: 'new-owner',
    };
    fixture.releaseUpdate.mockImplementation(
      async (
        criteria: Record<string, unknown>,
        changes: Record<string, unknown>,
      ) => {
        const matches = Object.entries(criteria).every(
          ([key, value]) => persisted[key] === value,
        );
        if (matches)
          Object.assign(persisted, changes, {
            attemptCount: Number(persisted.attemptCount) - 1,
          });
        return { affected: matches ? 1 : 0 };
      },
    );
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.releaseUpdate).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      processingState: 'PROCESSING',
      leaseToken: 'new-owner',
      attemptCount: 2,
    });
  });

  it('returns the tenth claim only when it was paused before causal processing', async () => {
    const fixture = fixtureWithGate((number) => [
      gate(number === 1 ? 'DISABLED' : 'PREPARING'),
    ]);
    fixture.receipt.attemptCount = 9;
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.releaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 10,
        leaseToken: fixture.receipt.leaseToken,
      }),
      expect.objectContaining({
        processingState: 'RECEIVED',
        error: {
          category: INBOUND_ROUTE_PAUSE_CATEGORY,
          refundedAttemptCount: 10,
        },
      }),
    );
    expect(fixture.writes).toEqual([]);
  });

  it('does not issue an eleventh real inbound claim after exhaustion', async () => {
    const fixture = fixtureWithGate(() => [gate('DISABLED')]);
    fixture.receipt.attemptCount = 10;
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.receipt.processingState).toBe('FAILED');
    expect(fixture.receipt.attemptCount).toBe(10);
    expect(fixture.writes).toEqual([]);
  });
});
