import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookProcessingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';
import {
  type InconnectMessagingNormalizedInbound,
  type InconnectMessagingNormalizedStatus,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';

const buildChain = () => {
  const chain = {
    insert: jest.fn(),
    update: jest.fn(),
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameter: jest.fn(),
    orIgnore: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  for (const method of [
    chain.insert,
    chain.update,
    chain.values,
    chain.set,
    chain.where,
    chain.andWhere,
    chain.setParameter,
    chain.orIgnore,
  ]) {
    method.mockReturnValue(chain);
  }

  return chain;
};

const buildReceipt = (): InconnectMessagingWebhookReceiptEntity =>
  Object.assign(new InconnectMessagingWebhookReceiptEntity(), {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    providerConnectionId: '33333333-3333-4333-8333-333333333333',
    eventKind: 'INBOUND_MESSAGE',
    idempotencyKey: 'SM123',
    payloadHash: 'hash',
    firstReceivedAt: new Date('2026-09-10T12:00:00.000Z'),
    normalizedMetadata: {},
    processingState: 'PROCESSING',
    leaseToken: '44444444-4444-4444-8444-444444444444',
    leaseExpiresAt: new Date('2026-09-10T12:05:00.000Z'),
    attemptCount: 1,
    error: null,
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const inbound: InconnectMessagingNormalizedInbound = {
  kind: 'INBOUND_MESSAGE',
  idempotencyKey: 'SM123',
  providerMessageId: 'SM123',
  externalAddressNormalized: '+525512345678',
  waId: '525512345678',
  body: 'hola',
  messageType: 'TEXT',
  serverReceivedAt: '2026-09-10T12:00:00.000Z',
  providerOccurredAt: null,
  effectiveInboundAt: '2026-09-10T12:00:00.000Z',
  timestampSource: 'SERVER',
  providerMetadata: { provider: 'TWILIO' },
};

const buildStatus = (
  overrides: Partial<InconnectMessagingNormalizedStatus> = {},
): InconnectMessagingNormalizedStatus => ({
  kind: 'STATUS_CALLBACK',
  idempotencyKey: 'SM-outbound:delivered:none',
  providerMessageId: 'SM-outbound',
  originalStatus: 'delivered',
  normalizedStatus: 'DELIVERED',
  serverReceivedAt: '2026-09-10T12:00:00.000Z',
  providerOccurredAt: null,
  error: null,
  providerMetadata: { provider: 'TWILIO' },
  ...overrides,
});

type ProcessingInternals = {
  processInbound: (
    manager: EntityManager,
    receipt: InconnectMessagingWebhookReceiptEntity,
    webhook: InconnectMessagingNormalizedInbound,
  ) => Promise<void>;
  processStatus: (
    manager: EntityManager,
    receipt: InconnectMessagingWebhookReceiptEntity,
    webhook: InconnectMessagingNormalizedStatus,
  ) => Promise<void>;
};

describe('InconnectMessagingWebhookProcessingService', () => {
  const service = new InconnectMessagingWebhookProcessingService(
    {} as DataSource,
  );
  const internals = service as unknown as ProcessingInternals;

  it.each([
    ['new', 'candidate-conversation'],
    ['existing', 'existing-conversation'],
  ])(
    'creates one unassigned inbound Message for a %s Conversation',
    async (_kind, conversationId) => {
      const receipt = buildReceipt();
      const conversationInsert = buildChain();
      const conversationUpdate = buildChain();
      const messageInsert = buildChain();
      const outboxInsert = buildChain();
      let messageIdCandidate = '';

      messageInsert.values.mockImplementation((value: { id: string }) => {
        messageIdCandidate = value.id;
        return messageInsert;
      });

      const conversationRepository = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(conversationInsert)
          .mockReturnValueOnce(conversationUpdate),
        findOne: jest.fn().mockResolvedValue({ id: conversationId }),
      };
      const messageRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(messageInsert),
        findOne: jest.fn().mockImplementation(async () => ({
          id: messageIdCandidate,
        })),
      };
      const outboxRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(outboxInsert),
      };
      const manager = {
        getRepository: jest.fn((entity) => {
          if (entity === InconnectMessagingConversationEntity) {
            return conversationRepository;
          }

          if (entity === InconnectMessagingMessageEntity) {
            return messageRepository;
          }

          if (entity === InconnectMessagingOutboxEventEntity) {
            return outboxRepository;
          }

          throw new Error('Unexpected non-Messaging repository access');
        }),
      } as unknown as EntityManager;

      await internals.processInbound(manager, receipt, inbound);

      expect(conversationInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: receipt.workspaceId,
          providerConnectionId: receipt.providerConnectionId,
          externalAddressNormalized: '+525512345678',
          linkedRecordObjectMetadataId: null,
          linkedRecordId: null,
        }),
      );
      expect(messageInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: receipt.workspaceId,
          providerConnectionId: receipt.providerConnectionId,
          conversationId,
          direction: 'INBOUND',
          providerMessageId: 'SM123',
          effectiveInboundAt: new Date('2026-09-10T12:00:00.000Z'),
        }),
      );
      expect(conversationRepository.findOne).toHaveBeenCalledWith({
        where: {
          workspaceId: receipt.workspaceId,
          providerConnectionId: receipt.providerConnectionId,
          externalAddressNormalized: inbound.externalAddressNormalized,
        },
      });
      expect(messageRepository.findOne).toHaveBeenCalledWith({
        where: {
          workspaceId: receipt.workspaceId,
          providerConnectionId: receipt.providerConnectionId,
          providerMessageId: inbound.providerMessageId,
          direction: 'INBOUND',
        },
      });
      expect(conversationUpdate.set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastInboundAt: expect.any(Function),
        }),
      );
      expect(outboxInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'INBOUND_MESSAGE_RECEIVED',
          workspaceId: receipt.workspaceId,
        }),
      );
      expect(manager.getRepository).toHaveBeenCalledTimes(3);
    },
  );

  it('does not repeat the inbound domain effect when the Message already exists', async () => {
    const receipt = buildReceipt();
    const conversationInsert = buildChain();
    const messageInsert = buildChain();
    const conversationRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(conversationInsert),
      findOne: jest.fn().mockResolvedValue({ id: 'existing-conversation' }),
    };
    const messageRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(messageInsert),
      findOne: jest.fn().mockResolvedValue({ id: 'existing-message' }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === InconnectMessagingConversationEntity) {
          return conversationRepository;
        }

        if (entity === InconnectMessagingMessageEntity) {
          return messageRepository;
        }

        throw new Error('Duplicate must not create an outbox effect');
      }),
    } as unknown as EntityManager;

    await internals.processInbound(manager, receipt, inbound);

    expect(conversationRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).not.toHaveBeenCalledWith(
      InconnectMessagingOutboxEventEntity,
    );
  });

  it.each([
    ['SENT', 'DELIVERED', 'DELIVERED', true],
    ['SENT', 'READ', 'READ', true],
    ['READ', 'delivered', 'DELIVERED', false],
    ['DELIVERED', 'sent', 'SENT', false],
    ['READ', 'read', 'READ', false],
    ['UNKNOWN', 'read', 'READ', true],
  ] as const)(
    'processes callback %s -> %s without degrading projection',
    async (currentState, originalStatus, normalizedStatus, shouldApply) => {
      const receipt = buildReceipt();
      const statusInsert = buildChain();
      const outboxInsert = buildChain();
      const message = Object.assign(new InconnectMessagingMessageEntity(), {
        id: 'message-id',
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        direction: 'OUTBOUND' as const,
        outboundState: currentState,
        providerStatus: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        error: null,
      });
      const messageRepository = {
        findOne: jest.fn().mockResolvedValue(message),
        save: jest.fn().mockResolvedValue(message),
      };
      const statusRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(statusInsert),
      };
      const outboxRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(outboxInsert),
      };
      const manager = {
        getRepository: jest.fn((entity) => {
          if (entity === InconnectMessagingMessageEntity) {
            return messageRepository;
          }

          if (entity === InconnectMessagingProviderStatusEventEntity) {
            return statusRepository;
          }

          if (entity === InconnectMessagingOutboxEventEntity) {
            return outboxRepository;
          }

          throw new Error('Unexpected repository');
        }),
      } as unknown as EntityManager;

      await internals.processStatus(
        manager,
        receipt,
        buildStatus({ originalStatus, normalizedStatus }),
      );

      expect(statusInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStatus,
          normalizedStatus,
          appliedToProjection: shouldApply,
          webhookReceiptId: receipt.id,
        }),
      );
      expect(messageRepository.save).toHaveBeenCalledTimes(shouldApply ? 1 : 0);
      expect(outboxRepository.createQueryBuilder).toHaveBeenCalledTimes(
        shouldApply ? 1 : 0,
      );
      expect(message.outboundState).toBe(
        shouldApply ? normalizedStatus : currentState,
      );
    },
  );

  it('keeps an unknown local Message callback retryable without inventing a Message', async () => {
    const receipt = buildReceipt();
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity !== InconnectMessagingMessageEntity) {
          throw new Error('Must not write any domain entity');
        }

        return { findOne: jest.fn().mockResolvedValue(null) };
      }),
    } as unknown as EntityManager;

    await expect(
      internals.processStatus(manager, receipt, buildStatus()),
    ).rejects.toMatchObject({
      category: 'MESSAGE_NOT_FOUND',
      retryable: true,
    });
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
  });

  it('preserves failed provider error metadata on the Message projection', async () => {
    const receipt = buildReceipt();
    const statusInsert = buildChain();
    const outboxInsert = buildChain();
    const message = Object.assign(new InconnectMessagingMessageEntity(), {
      id: 'message-id',
      workspaceId: receipt.workspaceId,
      providerConnectionId: receipt.providerConnectionId,
      direction: 'OUTBOUND' as const,
      outboundState: 'SENDING' as const,
      providerStatus: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      error: null,
    });
    const messageRepository = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn().mockResolvedValue(message),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === InconnectMessagingMessageEntity) {
          return messageRepository;
        }

        if (entity === InconnectMessagingProviderStatusEventEntity) {
          return { createQueryBuilder: () => statusInsert };
        }

        if (entity === InconnectMessagingOutboxEventEntity) {
          return { createQueryBuilder: () => outboxInsert };
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    const error = {
      providerStatus: 'undelivered',
      providerErrorCode: '63016',
    };

    await internals.processStatus(
      manager,
      receipt,
      buildStatus({
        originalStatus: 'undelivered',
        normalizedStatus: 'FAILED',
        error,
      }),
    );

    expect(message.error).toEqual(error);
    expect(message.outboundState).toBe('FAILED');
    expect(message.failedAt).toEqual(new Date('2026-09-10T12:00:00.000Z'));
  });

  it.each([
    ['malformed payload', {}, 'MALFORMED_PAYLOAD'],
    [
      'unsupported event',
      {
        kind: 'UNSUPPORTED',
        idempotencyKey: 'unsupported:hash',
        requestedKind: 'INBOUND_MESSAGE',
        reason: 'UNSUPPORTED_TWILIO_INBOUND',
        serverReceivedAt: '2026-09-10T12:00:00.000Z',
      },
      'UNSUPPORTED_EVENT',
    ],
  ] as const)(
    'marks a %s receipt as a permanent operational failure',
    async (_name, normalizedMetadata, expectedCategory) => {
      const receipt = buildReceipt();

      receipt.processingState = 'RECEIVED';
      receipt.normalizedMetadata = normalizedMetadata;
      receipt.attemptCount = 0;

      const claimRepository = {
        findOne: jest.fn().mockResolvedValue(receipt),
        save: jest.fn().mockResolvedValue(receipt),
      };
      const processingReceiptRepository = {
        findOne: jest.fn().mockResolvedValue(receipt),
        update: jest.fn(),
      };
      const releaseUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const dataSource = {
        transaction: jest
          .fn()
          .mockImplementationOnce(
            async (callback: (manager: EntityManager) => Promise<unknown>) =>
              callback({
                getRepository: () => claimRepository,
              } as unknown as EntityManager),
          )
          .mockImplementationOnce(
            async (callback: (manager: EntityManager) => Promise<unknown>) =>
              callback({
                getRepository: (entity: unknown) => {
                  if (entity === InconnectMessagingWebhookReceiptEntity) {
                    return processingReceiptRepository;
                  }

                  if (entity === InconnectMessagingProviderConnectionEntity) {
                    return {
                      findOne: jest
                        .fn()
                        .mockResolvedValue({ id: 'connection' }),
                    };
                  }

                  throw new Error(
                    'Permanent failure must not affect domain entities',
                  );
                },
              } as unknown as EntityManager),
          ),
        getRepository: jest.fn().mockReturnValue({ update: releaseUpdate }),
      } as unknown as DataSource;

      await expect(
        new InconnectMessagingWebhookProcessingService(
          dataSource,
        ).processReceipt(receipt.id),
      ).resolves.toBeUndefined();
      expect(releaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: receipt.id }),
        expect.objectContaining({
          processingState: 'FAILED',
          error: { category: expectedCategory },
        }),
      );
    },
  );

  it.each([
    ['requeues while attempts remain', 1, 'RECEIVED', true],
    ['fails after the attempt limit', 10, 'FAILED', false],
  ] as const)(
    '%s when the status Message is not local',
    async (_name, attemptCount, expectedState, shouldReject) => {
      const receipt = buildReceipt();

      receipt.processingState = 'RECEIVED';
      receipt.normalizedMetadata = buildStatus();
      receipt.attemptCount = attemptCount - 1;

      const claimRepository = {
        findOne: jest.fn().mockResolvedValue(receipt),
        save: jest.fn().mockResolvedValue(receipt),
      };
      const processingReceiptRepository = {
        findOne: jest.fn().mockResolvedValue(receipt),
        update: jest.fn(),
      };
      const releaseUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const dataSource = {
        transaction: jest
          .fn()
          .mockImplementationOnce(
            async (callback: (manager: EntityManager) => Promise<unknown>) =>
              callback({
                getRepository: () => claimRepository,
              } as unknown as EntityManager),
          )
          .mockImplementationOnce(
            async (callback: (manager: EntityManager) => Promise<unknown>) =>
              callback({
                getRepository: (entity: unknown) => {
                  if (entity === InconnectMessagingWebhookReceiptEntity) {
                    return processingReceiptRepository;
                  }

                  if (entity === InconnectMessagingProviderConnectionEntity) {
                    return {
                      findOne: jest
                        .fn()
                        .mockResolvedValue({ id: 'connection' }),
                    };
                  }

                  if (entity === InconnectMessagingMessageEntity) {
                    return { findOne: jest.fn().mockResolvedValue(null) };
                  }

                  throw new Error(
                    'Unknown Message must not create domain data',
                  );
                },
              } as unknown as EntityManager),
          ),
        getRepository: jest.fn().mockReturnValue({ update: releaseUpdate }),
      } as unknown as DataSource;
      const promise = new InconnectMessagingWebhookProcessingService(
        dataSource,
      ).processReceipt(receipt.id);

      if (shouldReject) {
        await expect(promise).rejects.toMatchObject({
          category: 'MESSAGE_NOT_FOUND',
          retryable: true,
        });
      } else {
        await expect(promise).resolves.toBeUndefined();
      }

      expect(releaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: receipt.id }),
        expect.objectContaining({
          processingState: expectedState,
          error: { category: 'MESSAGE_NOT_FOUND' },
        }),
      );
    },
  );
});
