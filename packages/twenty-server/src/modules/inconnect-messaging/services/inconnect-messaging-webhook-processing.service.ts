import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { z } from 'zod';
import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import { resolveInconnectMessagingOutboundStateTransition } from 'src/modules/inconnect-messaging/state-machine/outbound-message-state-machine';
import {
  INCONNECT_MESSAGING_MESSAGE_TYPES,
  INCONNECT_MESSAGING_OUTBOUND_STATES,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const WEBHOOK_LEASE_DURATION_MILLISECONDS = 5 * 60 * 1000;
const MAX_PROCESSING_ATTEMPTS = 10;

const jsonSchema = z.record(z.string(), z.unknown());
const inboundSchema = z.object({
  kind: z.literal('INBOUND_MESSAGE'),
  idempotencyKey: z.string().min(1),
  providerMessageId: z.string().min(1),
  externalAddressNormalized: z.string().min(1),
  waId: z.string().nullable(),
  body: z.string(),
  messageType: z.enum(INCONNECT_MESSAGING_MESSAGE_TYPES),
  serverReceivedAt: z.iso.datetime(),
  providerOccurredAt: z.iso.datetime().nullable(),
  effectiveInboundAt: z.iso.datetime(),
  timestampSource: z.enum(['PROVIDER', 'SERVER']),
  providerMetadata: jsonSchema,
});
const statusSchema = z.object({
  kind: z.literal('STATUS_CALLBACK'),
  idempotencyKey: z.string().min(1),
  providerMessageId: z.string().min(1),
  originalStatus: z.string().min(1),
  normalizedStatus: z.enum(INCONNECT_MESSAGING_OUTBOUND_STATES),
  serverReceivedAt: z.iso.datetime(),
  providerOccurredAt: z.iso.datetime().nullable(),
  error: jsonSchema.nullable(),
  providerMetadata: jsonSchema,
});
const unsupportedSchema = z.object({
  kind: z.literal('UNSUPPORTED'),
  idempotencyKey: z.string().min(1),
  requestedKind: z.enum(['INBOUND_MESSAGE', 'STATUS_CALLBACK']),
  reason: z.string().min(1),
  serverReceivedAt: z.iso.datetime(),
});
const normalizedWebhookSchema = z.discriminatedUnion('kind', [
  inboundSchema,
  statusSchema,
  unsupportedSchema,
]);

type ClaimedReceipt = {
  receipt: InconnectMessagingWebhookReceiptEntity;
  leaseToken: string;
};

@Injectable()
export class InconnectMessagingWebhookProcessingService {
  private readonly logger = new Logger(
    InconnectMessagingWebhookProcessingService.name,
  );

  public constructor(private readonly dataSource: DataSource) {}

  public async processReceipt(receiptId: string): Promise<void> {
    const claim = await this.claimReceipt(receiptId);

    if (claim === null) {
      return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const receipt = await manager
          .getRepository(InconnectMessagingWebhookReceiptEntity)
          .findOne({
            where: {
              id: claim.receipt.id,
              workspaceId: claim.receipt.workspaceId,
              processingState: 'PROCESSING',
              leaseToken: claim.leaseToken,
            },
            lock: { mode: 'pessimistic_write' },
          });

        if (receipt === null) {
          throw new InconnectMessagingWebhookException(
            'RECEIPT_NOT_PROCESSABLE',
            true,
          );
        }

        const connection = await manager
          .getRepository(InconnectMessagingProviderConnectionEntity)
          .findOne({
            where: {
              id: receipt.providerConnectionId,
              workspaceId: receipt.workspaceId,
              provider: 'TWILIO',
              channel: 'WHATSAPP',
              lifecycleStatus: 'ENABLED',
            },
          });

        if (connection === null) {
          throw new InconnectMessagingWebhookException(
            'CONNECTION_DISABLED',
            false,
          );
        }

        const normalizedWebhook = normalizedWebhookSchema.safeParse(
          receipt.normalizedMetadata,
        );

        if (!normalizedWebhook.success) {
          throw new InconnectMessagingWebhookException(
            'MALFORMED_PAYLOAD',
            false,
          );
        }

        if (normalizedWebhook.data.kind === 'UNSUPPORTED') {
          throw new InconnectMessagingWebhookException(
            'UNSUPPORTED_EVENT',
            false,
          );
        }

        if (normalizedWebhook.data.kind === 'INBOUND_MESSAGE') {
          await this.processInbound(manager, receipt, normalizedWebhook.data);
        } else {
          await this.processStatus(manager, receipt, normalizedWebhook.data);
        }

        await manager
          .getRepository(InconnectMessagingWebhookReceiptEntity)
          .update(
            { id: receipt.id, leaseToken: claim.leaseToken },
            {
              processingState: 'PROCESSED',
              leaseToken: null,
              leaseExpiresAt: null,
              error: null,
              processedAt: new Date(),
            },
          );
      });

      this.logResult(claim.receipt, 'PROCESSED');
    } catch (error) {
      const processingError =
        error instanceof InconnectMessagingWebhookException
          ? error
          : new InconnectMessagingWebhookException(
              'RECEIPT_NOT_PROCESSABLE',
              true,
            );
      const shouldRetry = await this.releaseOrFailReceipt(
        claim,
        processingError,
      );

      this.logResult(
        claim.receipt,
        shouldRetry ? 'RETRY_PENDING' : 'FAILED',
        processingError.category,
      );

      if (shouldRetry) {
        throw processingError;
      }
    }
  }

  private async claimReceipt(
    receiptId: string,
  ): Promise<ClaimedReceipt | null> {
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        InconnectMessagingWebhookReceiptEntity,
      );
      const receipt = await repository.findOne({
        where: { id: receiptId },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        receipt === null ||
        receipt.processingState === 'PROCESSED' ||
        receipt.processingState === 'FAILED' ||
        (receipt.processingState === 'PROCESSING' &&
          receipt.leaseExpiresAt !== null &&
          receipt.leaseExpiresAt > new Date())
      ) {
        return null;
      }

      const leaseToken = randomUUID();

      receipt.processingState = 'PROCESSING';
      receipt.leaseToken = leaseToken;
      receipt.leaseExpiresAt = new Date(
        Date.now() + WEBHOOK_LEASE_DURATION_MILLISECONDS,
      );
      receipt.attemptCount += 1;
      receipt.error = null;
      await repository.save(receipt);

      return { receipt, leaseToken };
    });
  }

  private async processInbound(
    manager: EntityManager,
    receipt: InconnectMessagingWebhookReceiptEntity,
    webhook: z.infer<typeof inboundSchema>,
  ): Promise<void> {
    const conversationIdCandidate = randomUUID();
    const conversationRepository = manager.getRepository(
      InconnectMessagingConversationEntity,
    );

    await conversationRepository
      .createQueryBuilder()
      .insert()
      .values({
        id: conversationIdCandidate,
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        externalAddressNormalized: webhook.externalAddressNormalized,
        waId: webhook.waId,
        linkedRecordObjectMetadataId: null,
        linkedRecordId: null,
        lastInboundAt: null,
      })
      .orIgnore()
      .execute();

    const conversation = await conversationRepository.findOne({
      where: {
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        externalAddressNormalized: webhook.externalAddressNormalized,
      },
    });

    if (conversation === null) {
      throw new InconnectMessagingWebhookException(
        'RECEIPT_NOT_PROCESSABLE',
        true,
      );
    }

    const messageIdCandidate = randomUUID();
    const messageRepository = manager.getRepository(
      InconnectMessagingMessageEntity,
    );

    await messageRepository
      .createQueryBuilder()
      .insert()
      .values({
        id: messageIdCandidate,
        workspaceId: receipt.workspaceId,
        conversationId: conversation.id,
        providerConnectionId: receipt.providerConnectionId,
        direction: 'INBOUND',
        type: webhook.messageType,
        sendMode: null,
        body: webhook.body,
        outboundState: null,
        providerMessageId: webhook.providerMessageId,
        providerStatus: null,
        clientRequestId: null,
        requestFingerprint: null,
        retryOfMessageId: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        error: null,
        providerMetadata: () => ':providerMetadata',
        serverReceivedAt: new Date(webhook.serverReceivedAt),
        providerOccurredAt:
          webhook.providerOccurredAt === null
            ? null
            : new Date(webhook.providerOccurredAt),
        effectiveInboundAt: new Date(webhook.effectiveInboundAt),
        timestampSource: webhook.timestampSource,
      })
      .setParameter('providerMetadata', webhook.providerMetadata)
      .orIgnore()
      .execute();

    const message = await messageRepository.findOne({
      where: {
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        providerMessageId: webhook.providerMessageId,
        direction: 'INBOUND',
      },
    });

    if (message === null) {
      throw new InconnectMessagingWebhookException(
        'RECEIPT_NOT_PROCESSABLE',
        true,
      );
    }

    if (message.id !== messageIdCandidate) {
      return;
    }

    const effectiveInboundAt = new Date(webhook.effectiveInboundAt);

    await conversationRepository
      .createQueryBuilder()
      .update()
      .set({
        lastInboundAt: () =>
          'GREATEST(COALESCE("lastInboundAt", :effectiveInboundAt), :effectiveInboundAt)',
        ...(webhook.waId === null ? {} : { waId: webhook.waId }),
      })
      .where('"id" = :conversationId', { conversationId: conversation.id })
      .andWhere('"workspaceId" = :workspaceId', {
        workspaceId: receipt.workspaceId,
      })
      .andWhere('"providerConnectionId" = :providerConnectionId', {
        providerConnectionId: receipt.providerConnectionId,
      })
      .setParameter('effectiveInboundAt', effectiveInboundAt)
      .execute();

    await this.createOutboxEvent(manager, {
      workspaceId: receipt.workspaceId,
      aggregateType: 'MESSAGE',
      aggregateId: message.id,
      eventType: 'INBOUND_MESSAGE_RECEIVED',
      deduplicationKey: `inconnect-messaging:receipt:${receipt.id}:message`,
      immutablePayload: {
        messageId: message.id,
        conversationId: conversation.id,
        providerConnectionId: receipt.providerConnectionId,
        messageType: webhook.messageType,
        effectiveInboundAt: webhook.effectiveInboundAt,
      },
    });
  }

  private async processStatus(
    manager: EntityManager,
    receipt: InconnectMessagingWebhookReceiptEntity,
    webhook: z.infer<typeof statusSchema>,
  ): Promise<void> {
    const messageRepository = manager.getRepository(
      InconnectMessagingMessageEntity,
    );
    const message = await messageRepository.findOne({
      where: {
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        providerMessageId: webhook.providerMessageId,
        direction: 'OUTBOUND',
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (message === null || message.outboundState === null) {
      throw new InconnectMessagingWebhookException('MESSAGE_NOT_FOUND', true);
    }

    const transition = resolveInconnectMessagingOutboundStateTransition({
      currentState: message.outboundState,
      targetState: webhook.normalizedStatus,
      trigger: 'PROVIDER_CALLBACK',
    });
    const statusEventId = randomUUID();

    await manager
      .getRepository(InconnectMessagingProviderStatusEventEntity)
      .createQueryBuilder()
      .insert()
      .values({
        id: statusEventId,
        workspaceId: receipt.workspaceId,
        messageId: message.id,
        webhookReceiptId: receipt.id,
        providerEventKey: webhook.idempotencyKey,
        originalStatus: webhook.originalStatus,
        normalizedStatus: webhook.normalizedStatus,
        providerOccurredAt:
          webhook.providerOccurredAt === null
            ? null
            : new Date(webhook.providerOccurredAt),
        serverReceivedAt: new Date(webhook.serverReceivedAt),
        error: () => ':providerError',
        appliedToProjection: transition.kind === 'APPLIED',
      })
      .setParameter('providerError', webhook.error)
      .orIgnore()
      .execute();

    if (transition.kind !== 'APPLIED') {
      return;
    }

    const previousState = message.outboundState;
    const effectiveStatusAt = new Date(
      webhook.providerOccurredAt ?? webhook.serverReceivedAt,
    );

    message.outboundState = transition.state;
    message.providerStatus = webhook.originalStatus;

    if (transition.state === 'SENT') {
      message.sentAt ??= effectiveStatusAt;
    } else if (transition.state === 'DELIVERED') {
      message.deliveredAt ??= effectiveStatusAt;
    } else if (transition.state === 'READ') {
      message.readAt ??= effectiveStatusAt;
    } else if (transition.state === 'FAILED') {
      message.failedAt ??= effectiveStatusAt;
      message.error = webhook.error;
    }

    await messageRepository.save(message);
    await this.createOutboxEvent(manager, {
      workspaceId: receipt.workspaceId,
      aggregateType: 'MESSAGE',
      aggregateId: message.id,
      eventType: 'OUTBOUND_MESSAGE_STATUS_CHANGED',
      deduplicationKey: `inconnect-messaging:receipt:${receipt.id}:status`,
      immutablePayload: {
        messageId: message.id,
        providerConnectionId: receipt.providerConnectionId,
        previousState,
        outboundState: transition.state,
        providerStatus: webhook.originalStatus,
      },
    });
  }

  private async createOutboxEvent(
    manager: EntityManager,
    event: Pick<
      InconnectMessagingOutboxEventEntity,
      | 'workspaceId'
      | 'aggregateType'
      | 'aggregateId'
      | 'eventType'
      | 'deduplicationKey'
      | 'immutablePayload'
    >,
  ): Promise<void> {
    await manager
      .getRepository(InconnectMessagingOutboxEventEntity)
      .createQueryBuilder()
      .insert()
      .values({
        workspaceId: event.workspaceId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        deduplicationKey: event.deduplicationKey,
        immutablePayload: () => ':immutablePayload',
        id: randomUUID(),
        availableAt: new Date(),
        processingState: 'PENDING',
        leaseToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        error: null,
        publishedAt: null,
      })
      .setParameter('immutablePayload', event.immutablePayload)
      .orIgnore()
      .execute();
  }

  private async releaseOrFailReceipt(
    claim: ClaimedReceipt,
    error: InconnectMessagingWebhookException,
  ): Promise<boolean> {
    const shouldRetry =
      error.retryable && claim.receipt.attemptCount < MAX_PROCESSING_ATTEMPTS;

    await this.dataSource
      .getRepository(InconnectMessagingWebhookReceiptEntity)
      .update(
        {
          id: claim.receipt.id,
          workspaceId: claim.receipt.workspaceId,
          processingState: 'PROCESSING',
          leaseToken: claim.leaseToken,
        },
        {
          processingState: shouldRetry ? 'RECEIVED' : 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          error: { category: error.category },
        },
      );

    return shouldRetry;
  }

  private logResult(
    receipt: InconnectMessagingWebhookReceiptEntity,
    processingResult: string,
    errorCategory?: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        receiptId: receipt.id,
        provider: 'TWILIO',
        connectionId: receipt.providerConnectionId,
        workspaceId: receipt.workspaceId,
        eventKind: receipt.eventKind,
        processingResult,
        ...(errorCategory === undefined ? {} : { errorCategory }),
      }),
    );
  }
}
