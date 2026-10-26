import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { type InconnectMessagingMediaIngestionService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service';
import { type InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { InconnectMessagingWebhookProcessingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';
import { type InconnectMessagingNormalizedInbound } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import {
  identifier,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';

export const legacyInboundFixture = ({
  existingConversation = false,
  duplicate = false,
  processed = false,
  fault,
  webhookChanges = {},
}: {
  existingConversation?: boolean;
  duplicate?: boolean;
  processed?: boolean;
  fault?: 'message' | 'attachment' | 'outbox' | 'commit' | 'connection';
  webhookChanges?: Partial<InconnectMessagingNormalizedInbound>;
} = {}) => {
  const order: string[] = [];
  const webhook: InconnectMessagingNormalizedInbound = {
    kind: 'INBOUND_MESSAGE',
    idempotencyKey: 'SM-original',
    providerMessageId: 'SM-original',
    externalAddressNormalized: '+525512345678',
    waId: null,
    body: 'hola',
    messageType: 'TEXT',
    serverReceivedAt: '2026-10-22T12:00:00.000Z',
    providerOccurredAt: null,
    effectiveInboundAt: '2026-10-22T12:00:00.000Z',
    timestampSource: 'SERVER',
    attachments: [],
    providerMetadata: {},
    ...webhookChanges,
  };
  const receipt = Object.assign(new InconnectMessagingWebhookReceiptEntity(), {
    id: identifier(27),
    workspaceId: scope.workspaceId,
    providerConnectionId: scope.providerConnectionId,
    eventKind: 'INBOUND_MESSAGE',
    normalizedMetadata: webhook,
    processingState: processed ? 'PROCESSED' : 'RECEIVED',
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    error: null,
    updatedAt: new Date(0),
  });
  let messageId = '';
  let conversationId = existingConversation ? scope.conversationId : '';
  const writes: { table: string; values: Record<string, unknown> }[] = [];
  const chain = (table: string) => {
    let values: Record<string, unknown> = {};
    const builder = {
      insert: jest.fn(),
      update: jest.fn(),
      values: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      setParameter: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn(async () => {
        order.push(table);
        if (fault === table) throw new Error('injected write failure');
        writes.push({ table, values });
      }),
    };
    for (const method of [
      builder.insert,
      builder.update,
      builder.set,
      builder.where,
      builder.andWhere,
      builder.setParameter,
      builder.orIgnore,
    ])
      method.mockReturnValue(builder);
    builder.values.mockImplementation((input: Record<string, unknown>) => {
      values = input;
      if (table === 'message') messageId = String(input.id);
      if (table === 'conversation' && !existingConversation)
        conversationId = String(input.id);
      return builder;
    });
    return builder;
  };
  const receiptUpdate = jest.fn(
    async (_criteria: unknown, changes: Record<string, unknown>) => {
      if (
        (changes.error as { category?: string } | undefined)?.category ===
        'INBOUND_ROUTE_PAUSED'
      ) {
        Object.assign(receipt, changes, { updatedAt: new Date() });
        return { affected: 1 };
      }
      order.push('receipt-finalize');
      return { affected: 1 };
    },
  );
  const releaseUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  const receiptRepository = {
    findOne: jest.fn(async () => receipt),
    save: jest.fn(async () => receipt),
    update: receiptUpdate,
  };
  const repository = jest.fn((entity: unknown) => {
    if (entity === InconnectMessagingWebhookReceiptEntity)
      return receiptRepository;
    if (entity === InconnectMessagingProviderConnectionEntity)
      return {
        findOne: jest.fn(async (options: { where: unknown }) => {
          expect(options.where).toEqual({
            id: scope.providerConnectionId,
            workspaceId: scope.workspaceId,
            provider: 'TWILIO',
            channel: 'WHATSAPP',
            lifecycleStatus: 'ENABLED',
          });
          return fault === 'connection'
            ? null
            : {
                id: scope.providerConnectionId,
                workspaceId: scope.workspaceId,
              };
        }),
      };
    if (entity === InconnectMessagingConversationEntity)
      return {
        createQueryBuilder: () => chain('conversation'),
        findOne: jest.fn(async () => ({ id: conversationId })),
      };
    if (entity === InconnectMessagingMessageEntity)
      return {
        createQueryBuilder: () => chain('message'),
        findOne: jest.fn(async () => ({
          id: duplicate ? identifier(99) : messageId,
        })),
      };
    if (entity === InconnectMessagingAttachmentEntity)
      return { createQueryBuilder: () => chain('attachment') };
    if (entity === InconnectMessagingOutboxEventEntity)
      return { createQueryBuilder: () => chain('outbox') };
    throw new Error('Unexpected repository, including any attention table');
  });
  let transactionNumber = 0;
  const transaction = jest.fn(
    async (callback: (manager: EntityManager) => Promise<unknown>) => {
      const number = ++transactionNumber;
      order.push(`begin-${number}`);
      try {
        const result = await callback({
          getRepository: repository,
          query: jest.fn().mockResolvedValue([
            {
              columns: 3,
              mode: 'DISABLED',
              protocolVersion: null,
              gateUpdatedAt: null,
            },
          ]),
        } as unknown as EntityManager);
        if (number === 2 && fault === 'commit')
          throw new Error('ambiguous commit');
        order.push(`commit-${number}`);
        return result;
      } catch (error) {
        order.push(`reject-${number}`);
        throw error;
      }
    },
  );
  const requestPublication = jest.fn(async () => {
    order.push('publish');
    return true;
  });
  const requestMedia = jest.fn(async () => {
    order.push('media');
    return 0;
  });
  const service = new InconnectMessagingWebhookProcessingService(
    {
      transaction,
      getRepository: () => ({ update: releaseUpdate }),
    } as unknown as DataSource,
    { requestPublication } as unknown as InconnectMessagingOutboxService,
    {
      requestPendingAttachmentsForProviderMessage: requestMedia,
    } as unknown as InconnectMessagingMediaIngestionService,
  );
  return {
    service,
    receipt,
    order,
    writes,
    repository,
    transaction,
    requestPublication,
    requestMedia,
    receiptUpdate,
    releaseUpdate,
  };
};
