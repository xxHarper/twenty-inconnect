import { type DataSource, type Repository } from 'typeorm';

import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

const NORMALIZED_INBOUND = {
  kind: 'INBOUND_MESSAGE' as const,
  idempotencyKey: 'SM123',
  providerMessageId: 'SM123',
  externalAddressNormalized: '+525512345678',
  waId: '525512345678',
  body: 'hola',
  messageType: 'TEXT' as const,
  serverReceivedAt: '2026-09-10T12:00:00.000Z',
  providerOccurredAt: null,
  effectiveInboundAt: '2026-09-10T12:00:00.000Z',
  timestampSource: 'SERVER' as const,
  providerMetadata: {},
};

const RAW_BODY = 'MessageSid=SM123&Body=hola';

const buildReceipt = (
  overrides: Partial<InconnectMessagingWebhookReceiptEntity> = {},
): InconnectMessagingWebhookReceiptEntity =>
  Object.assign(new InconnectMessagingWebhookReceiptEntity(), {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    providerConnectionId: '33333333-3333-4333-8333-333333333333',
    eventKind: 'INBOUND_MESSAGE',
    idempotencyKey: 'SM123',
    payloadHash: 'placeholder',
    firstReceivedAt: new Date('2026-09-10T12:00:00.000Z'),
    normalizedMetadata: NORMALIZED_INBOUND,
    processingState: 'RECEIVED',
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    error: null,
    processedAt: null,
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    updatedAt: new Date('2026-09-10T12:00:00.000Z'),
    ...overrides,
  });

describe('InconnectMessagingWebhookReceiptService', () => {
  const execute = jest.fn().mockResolvedValue(undefined);
  const orIgnore = jest.fn().mockReturnThis();
  const setParameter = jest.fn().mockReturnThis();
  const values = jest.fn().mockReturnThis();
  const insert = jest.fn().mockReturnThis();
  const createQueryBuilder = jest.fn(() => ({
    insert,
    values,
    setParameter,
    orIgnore,
    execute,
  }));
  const transactionalFindOne = jest.fn();
  const transactionalRepository = {
    createQueryBuilder,
    findOne: transactionalFindOne,
  };
  const transaction = jest.fn(
    async (callback: (manager: { getRepository: () => unknown }) => unknown) =>
      await callback({ getRepository: () => transactionalRepository }),
  );
  const find = jest.fn();
  const findOne = jest.fn();
  const update = jest.fn();
  const repository = { find, findOne, update };
  const add = jest.fn();
  const service = new InconnectMessagingWebhookReceiptService(
    { transaction } as unknown as DataSource,
    repository as unknown as Repository<InconnectMessagingWebhookReceiptEntity>,
    { add } as unknown as MessageQueueService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockResolvedValue(undefined);
    add.mockResolvedValue(undefined);
  });

  it('uses the durable unique receipt for both a new delivery and a duplicate', async () => {
    const payloadHash = service.computePayloadHash(RAW_BODY);
    const receipt = buildReceipt({ payloadHash });

    transactionalFindOne.mockResolvedValue(receipt);

    const input = {
      workspaceId: receipt.workspaceId,
      providerConnectionId: receipt.providerConnectionId,
      normalizedWebhook: NORMALIZED_INBOUND,
      rawBody: RAW_BODY,
      firstReceivedAt: receipt.firstReceivedAt,
    };

    await expect(service.persistAndRequestProcessing(input)).resolves.toBe(
      receipt,
    );
    await expect(service.persistAndRequestProcessing(input)).resolves.toBe(
      receipt,
    );

    expect(orIgnore).toHaveBeenCalledTimes(2);
    expect(transactionalFindOne).toHaveBeenLastCalledWith({
      where: {
        providerConnectionId: receipt.providerConnectionId,
        eventKind: 'INBOUND_MESSAGE',
        idempotencyKey: 'SM123',
      },
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0]?.[2]).toEqual(add.mock.calls[1]?.[2]);
  });

  it('rejects a duplicate logical event with a changed payload', async () => {
    transactionalFindOne.mockResolvedValue(
      buildReceipt({ payloadHash: 'different-hash' }),
    );

    await expect(
      service.persistAndRequestProcessing({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        normalizedWebhook: NORMALIZED_INBOUND,
        rawBody: RAW_BODY,
        firstReceivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ category: 'PAYLOAD_CONFLICT' });
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps the committed receipt authoritative when enqueue fails and recovers it', async () => {
    const receipt = buildReceipt({
      payloadHash: service.computePayloadHash(RAW_BODY),
    });

    transactionalFindOne.mockResolvedValue(receipt);
    add.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(
      service.persistAndRequestProcessing({
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        normalizedWebhook: NORMALIZED_INBOUND,
        rawBody: RAW_BODY,
        firstReceivedAt: receipt.firstReceivedAt,
      }),
    ).resolves.toBe(receipt);

    find.mockResolvedValue([receipt]);
    add.mockResolvedValueOnce(undefined);

    await expect(service.recoverPendingReceipts()).resolves.toBe(1);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('queries both pending and expired processing leases for recovery', async () => {
    find.mockResolvedValue([]);
    const now = new Date('2026-09-10T13:00:00.000Z');

    await service.recoverPendingReceipts(now);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          { processingState: 'RECEIVED' },
          expect.objectContaining({ processingState: 'PROCESSING' }),
        ]),
        take: 100,
      }),
    );
  });

  it('provides a controlled retry path for an operationally failed receipt', async () => {
    const receipt = buildReceipt({ processingState: 'RECEIVED' });

    update.mockResolvedValue({ affected: 1 });
    findOne.mockResolvedValue(receipt);

    await expect(service.retryFailedReceipt(receipt.id)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      { id: receipt.id, processingState: 'FAILED' },
      expect.objectContaining({ processingState: 'RECEIVED', error: null }),
    );
    expect(add).toHaveBeenCalledTimes(1);
  });
});
