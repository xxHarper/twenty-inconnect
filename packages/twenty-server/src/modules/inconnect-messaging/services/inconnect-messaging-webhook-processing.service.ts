import { Injectable, Logger, Optional } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { z } from 'zod';
import { DataSource, IsNull, Raw, type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import {
  requireLegacyInboundRoute,
  InboundRoutePaused,
  inboundRoutePauseFilter,
  INBOUND_ROUTE_PAUSE_CATEGORY,
  INBOUND_ROUTE_PAUSE_MILLISECONDS,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/transactional/inbound-route-boundary';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { resolveInconnectMessagingOutboundStateTransition } from 'src/modules/inconnect-messaging/state-machine/outbound-message-state-machine';
import { isInconnectMessagingMimeAllowedForType } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-media-policy.constant';
import { InconnectMessagingMediaIngestionService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service';
import {
  INCONNECT_MESSAGING_ATTACHMENT_TYPES,
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
  attachments: z
    .array(
      z.object({
        ordinal: z.number().int().min(0).max(9),
        type: z.enum(INCONNECT_MESSAGING_ATTACHMENT_TYPES),
        providerMediaLocator: z.string().min(1).nullable(),
        declaredMimeType: z.string().min(1).nullable(),
        safeFilename: z.string().min(1).max(180),
      }),
    )
    .max(10),
  providerMetadata: jsonSchema,
});
const statusSchema = z.object({
  kind: z.literal('STATUS_CALLBACK'),
  idempotencyKey: z.string().min(1),
  providerMessageId: z.string().min(1),
  localMessageIdHint: z.uuid().nullable().optional(),
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

  public constructor(
    private readonly dataSource: DataSource,
    private readonly outboxService: InconnectMessagingOutboxService,
    @Optional()
    private readonly mediaIngestionService?: InconnectMessagingMediaIngestionService,
  ) {}

  public async processReceipt(receiptId: string): Promise<void> {
    const claim = await this.claimReceipt(receiptId);

    if (claim === null) {
      return;
    }

    let processingResult: {
      publicationRequest: InconnectMessagingOutboxPublicationRequest | null;
      inboundProviderMessageId: string | null;
    };

    try {
      processingResult = await this.dataSource.transaction(async (manager) => {
        if (claim.receipt.eventKind === 'INBOUND_MESSAGE') {
          await requireLegacyInboundRoute(manager, claim.receipt.workspaceId);
        }
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

        const outboxEvent =
          normalizedWebhook.data.kind === 'INBOUND_MESSAGE'
            ? await this.processInbound(
                manager,
                receipt,
                normalizedWebhook.data,
              )
            : await this.processStatus(
                manager,
                receipt,
                normalizedWebhook.data,
              );

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

        return {
          publicationRequest: outboxEvent,
          inboundProviderMessageId:
            normalizedWebhook.data.kind === 'INBOUND_MESSAGE'
              ? normalizedWebhook.data.providerMessageId
              : null,
        };
      });
    } catch (error) {
      if (error instanceof InboundRoutePaused) {
        // The gate was allowed at claim time and changed before the causal unit.
        // Refund only this exact claim, after the transaction has rolled back.
        // Expiration permits takeover; it does not revoke an unchanged token.
        // A late refund is safe only while this state/token/count still match.
        if (
          !Number.isSafeInteger(claim.receipt.attemptCount) ||
          claim.receipt.attemptCount < 1
        )
          throw new Error('Invalid paused claim count');
        const paused = await this.dataSource
          .getRepository(InconnectMessagingWebhookReceiptEntity)
          .update(
            {
              id: claim.receipt.id,
              workspaceId: claim.receipt.workspaceId,
              providerConnectionId: claim.receipt.providerConnectionId,
              eventKind: 'INBOUND_MESSAGE',
              processingState: 'PROCESSING',
              leaseToken: claim.leaseToken,
              attemptCount: claim.receipt.attemptCount,
            },
            {
              processingState: 'RECEIVED',
              leaseToken: null,
              leaseExpiresAt: null,
              attemptCount: () => '"attemptCount" - 1',
              updatedAt: () => 'clock_timestamp()',
              error: {
                category: INBOUND_ROUTE_PAUSE_CATEGORY,
                refundedAttemptCount: claim.receipt.attemptCount,
              },
            },
          );
        if (paused.affected !== 0 && paused.affected !== 1)
          throw new Error('Incomplete paused claim disposition');
        this.logResult(
          claim.receipt,
          paused.affected === 1 ? INBOUND_ROUTE_PAUSE_CATEGORY : 'LEASE_LOST',
        );
        return;
      }
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

      return;
    }

    if (processingResult.publicationRequest !== null) {
      await this.outboxService.requestPublication(
        processingResult.publicationRequest,
      );
    }

    if (
      processingResult.inboundProviderMessageId !== null &&
      this.mediaIngestionService !== undefined
    ) {
      await this.mediaIngestionService.requestPendingAttachmentsForProviderMessage(
        {
          workspaceId: claim.receipt.workspaceId,
          providerConnectionId: claim.receipt.providerConnectionId,
          providerMessageId: processingResult.inboundProviderMessageId,
        },
      );
    }

    this.logResult(claim.receipt, 'PROCESSED');
  }

  private async claimReceipt(
    receiptId: string,
  ): Promise<ClaimedReceipt | null> {
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        InconnectMessagingWebhookReceiptEntity,
      );
      // Unlocked locator only; decisions use a fresh scoped Receipt under lock.
      // Configuration must precede Receipt so the processing lock order is kept.
      const locator = await repository.findOne({
        where: { id: receiptId, error: inboundRoutePauseFilter() },
      });
      if (locator === null) return null;
      let paused = false;
      if (locator.eventKind === 'INBOUND_MESSAGE') {
        try {
          await requireLegacyInboundRoute(manager, locator.workspaceId);
        } catch (error) {
          if (!(error instanceof InboundRoutePaused)) throw error;
          paused = true;
        }
      }
      const receipt = await repository.findOne({
        where: {
          id: receiptId,
          workspaceId: locator.workspaceId,
          providerConnectionId: locator.providerConnectionId,
          eventKind: locator.eventKind,
          error: inboundRoutePauseFilter(),
        },
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

      if (receipt.eventKind === 'INBOUND_MESSAGE') {
        if (paused) {
          // Missing hydration is not evidence of a nullable column's value.
          if (receipt.error === undefined) return null;
          if (
            receipt.processingState === 'RECEIVED' &&
            (receipt.leaseToken !== null || receipt.leaseExpiresAt !== null)
          )
            return null;
          // The scoped row is locked. Explicit UPDATE renews even an identical
          // pause; save() skips it. The window is rechecked using the DB clock.
          const result = await repository.update(
            {
              id: receipt.id,
              workspaceId: receipt.workspaceId,
              providerConnectionId: receipt.providerConnectionId,
              eventKind: 'INBOUND_MESSAGE',
              processingState: receipt.processingState,
              leaseToken: receipt.leaseToken ?? IsNull(),
              leaseExpiresAt:
                receipt.processingState === 'PROCESSING'
                  ? Raw(() => '"leaseExpiresAt" <= clock_timestamp()')
                  : IsNull(),
              attemptCount: receipt.attemptCount,
              error: Raw(
                () =>
                  '"error" IS NOT DISTINCT FROM CAST(:previousPauseError AS jsonb)',
                {
                  // Keep SQL NULL as a null binding, not the JSON text "null".
                  previousPauseError:
                    receipt.error === null
                      ? null
                      : JSON.stringify(receipt.error),
                },
              ),
              updatedAt: Raw(
                () =>
                  `("processingState" <> 'RECEIVED' OR "error"->>'category' IS DISTINCT FROM :pauseCategory OR "updatedAt" <= clock_timestamp() - (:pauseMilliseconds * INTERVAL '1 millisecond'))`,
                {
                  pauseCategory: INBOUND_ROUTE_PAUSE_CATEGORY,
                  pauseMilliseconds: INBOUND_ROUTE_PAUSE_MILLISECONDS,
                },
              ),
            },
            {
              processingState: 'RECEIVED',
              leaseToken: null,
              leaseExpiresAt: null,
              error: { category: INBOUND_ROUTE_PAUSE_CATEGORY },
              updatedAt: () => 'clock_timestamp()',
            },
          );
          if (result.affected !== 0 && result.affected !== 1)
            throw new Error('Incomplete inbound pause disposition');
          if (result.affected === 1)
            this.logResult(receipt, INBOUND_ROUTE_PAUSE_CATEGORY);
          return null;
        }
        if (receipt.attemptCount >= MAX_PROCESSING_ATTEMPTS) {
          receipt.processingState = 'FAILED';
          receipt.leaseToken = null;
          receipt.leaseExpiresAt = null;
          receipt.error = { category: 'CAUSAL_RETRY_EXHAUSTED' };
          await repository.save(receipt);
          return null;
        }
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
  ): Promise<InconnectMessagingOutboxPublicationRequest | null> {
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
      return null;
    }

    if (webhook.attachments.length > 0) {
      const attachmentRepository = manager.getRepository(
        InconnectMessagingAttachmentEntity,
      );

      for (const attachment of webhook.attachments) {
        const hasRequiredMetadata =
          attachment.providerMediaLocator !== null &&
          attachment.declaredMimeType !== null;
        const isSupported =
          hasRequiredMetadata &&
          attachment.declaredMimeType !== null &&
          isInconnectMessagingMimeAllowedForType({
            mimeType: attachment.declaredMimeType,
            type: attachment.type,
          });

        await attachmentRepository
          .createQueryBuilder()
          .insert()
          .values({
            workspaceId: receipt.workspaceId,
            messageId: message.id,
            providerConnectionId: receipt.providerConnectionId,
            ordinal: attachment.ordinal,
            type: attachment.type,
            ingestionState: isSupported ? 'PENDING' : 'FAILED',
            providerMediaLocator: attachment.providerMediaLocator,
            declaredMimeType: attachment.declaredMimeType,
            safeFilename: attachment.safeFilename,
            fileId: null,
            mimeType: null,
            size: null,
            leaseToken: null,
            leaseExpiresAt: null,
            attemptCount: 0,
            lastErrorCode: hasRequiredMetadata
              ? isSupported
                ? null
                : 'UNSUPPORTED_MIME'
              : 'MALFORMED_PROVIDER_MEDIA_METADATA',
            availableAt: null,
          })
          .orIgnore()
          .execute();
      }
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

    return this.createOutboxEvent(manager, {
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
  ): Promise<InconnectMessagingOutboxPublicationRequest | null> {
    const messageRepository = manager.getRepository(
      InconnectMessagingMessageEntity,
    );
    let message = await messageRepository.findOne({
      where: {
        workspaceId: receipt.workspaceId,
        providerConnectionId: receipt.providerConnectionId,
        providerMessageId: webhook.providerMessageId,
        direction: 'OUTBOUND',
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      message === null &&
      webhook.localMessageIdHint !== null &&
      webhook.localMessageIdHint !== undefined
    ) {
      message = await messageRepository.findOne({
        where: {
          id: webhook.localMessageIdHint,
          workspaceId: receipt.workspaceId,
          providerConnectionId: receipt.providerConnectionId,
          direction: 'OUTBOUND',
        },
        lock: { mode: 'pessimistic_write' },
      });
    }

    if (
      message === null ||
      message.outboundState === null ||
      (message.providerMessageId !== null &&
        message.providerMessageId !== undefined &&
        message.providerMessageId !== webhook.providerMessageId)
    ) {
      throw new InconnectMessagingWebhookException('MESSAGE_NOT_FOUND', true);
    }

    // A signed per-message callback can establish the provider ID before the SDK response commits.
    let providerMessageIdWasEstablished = false;

    if (
      message.providerMessageId === null ||
      message.providerMessageId === undefined
    ) {
      message.providerMessageId = webhook.providerMessageId;
      providerMessageIdWasEstablished = true;
    }

    if (
      message.outboundState === 'SENDING' &&
      (webhook.normalizedStatus === 'DELIVERED' ||
        webhook.normalizedStatus === 'READ')
    ) {
      const accepted = resolveInconnectMessagingOutboundStateTransition({
        currentState: message.outboundState,
        targetState: 'SENT',
        trigger: 'PROVIDER_CALLBACK',
      });

      if (accepted.kind === 'APPLIED') {
        message.outboundState = accepted.state;
        message.sentAt ??= new Date(
          webhook.providerOccurredAt ?? webhook.serverReceivedAt,
        );
      }
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
      if (providerMessageIdWasEstablished) {
        await messageRepository.save(message);
      }

      return null;
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
    return this.createOutboxEvent(manager, {
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
  ): Promise<InconnectMessagingOutboxPublicationRequest> {
    const outboxEventId = randomUUID();

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
        id: outboxEventId,
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

    return {
      id: outboxEventId,
      workspaceId: event.workspaceId,
      eventType: event.eventType,
    };
  }

  private async releaseOrFailReceipt(
    claim: ClaimedReceipt,
    error: InconnectMessagingWebhookException,
  ): Promise<boolean> {
    const shouldRetry =
      error.category === 'MESSAGE_NOT_FOUND' ||
      (error.retryable && claim.receipt.attemptCount < MAX_PROCESSING_ATTEMPTS);

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
