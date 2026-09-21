import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import { DataSource, LessThanOrEqual, type Repository } from 'typeorm';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { INCONNECT_MESSAGING_OUTBOX_PUBLISHING_JOB_NAME } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-outbox-publishing-job-name.constant';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingRealtimePublisherService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-realtime-publisher.service';
import { InconnectMessagingRealtimeRecipientService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-realtime-recipient.service';
import {
  type InconnectMessagingRealtimeEventType,
  type InconnectMessagingRealtimeHint,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-realtime.type';

const OUTBOX_LEASE_DURATION_MILLISECONDS = 5 * 60 * 1000;
const OUTBOX_RECOVERY_BATCH_SIZE = 100;
const OUTBOX_RETRY_DELAY_MILLISECONDS = 15 * 1000;

type ClaimedOutboxEvent = {
  event: InconnectMessagingOutboxEventEntity;
  leaseToken: string;
};

export type InconnectMessagingOutboxPublicationRequest = Pick<
  InconnectMessagingOutboxEventEntity,
  'id' | 'workspaceId' | 'eventType'
>;

@Injectable()
export class InconnectMessagingOutboxService {
  private readonly logger = new Logger(InconnectMessagingOutboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- Recovery claims durable outbox events across workspaces; publication checks each recipient's authorization.
    @InjectRepository(InconnectMessagingOutboxEventEntity)
    private readonly outboxEventRepository: Repository<InconnectMessagingOutboxEventEntity>,
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly recipientService: InconnectMessagingRealtimeRecipientService,
    private readonly realtimePublisherService: InconnectMessagingRealtimePublisherService,
  ) {}

  async requestPublication(
    event: InconnectMessagingOutboxPublicationRequest,
  ): Promise<boolean> {
    return this.enqueueWithoutAffectingAuthority(event);
  }

  async publishEvent(outboxEventId: string): Promise<void> {
    const claim = await this.claimEvent(outboxEventId);

    if (claim === null) {
      return;
    }

    try {
      const hint = await this.buildHint(claim.event);

      if (hint === null) {
        await this.failClaimPermanently(claim, 'UNSUPPORTED_OUTBOX_EVENT');

        return;
      }

      const candidateAuthContexts =
        await this.recipientService.getCandidateAuthContexts(
          claim.event.workspaceId,
        );
      let recipientCount = 0;

      for (const authContext of candidateAuthContexts) {
        const conversation =
          await this.authorizationService.findAuthorizedConversation({
            authContext,
            conversationId: hint.conversationId,
          });

        if (conversation === null) {
          continue;
        }

        await this.realtimePublisherService.publishToMember({
          workspaceId: claim.event.workspaceId,
          workspaceMemberId: authContext.workspaceMemberId,
          hint,
        });
        recipientCount += 1;
      }

      await this.completeClaim(claim);
      this.logResult(claim.event, 'PUBLISHED', recipientCount);
    } catch (error) {
      await this.releaseClaimForRetry(claim, 'REALTIME_PUBLISH_FAILED');
      this.logResult(
        claim.event,
        'RETRY_PENDING',
        undefined,
        'REALTIME_PUBLISH_FAILED',
      );

      throw error;
    }
  }

  async recoverPublishableEvents(now = new Date()): Promise<number> {
    const events = await this.outboxEventRepository.find({
      select: ['id', 'workspaceId', 'eventType', 'aggregateId'],
      where: [
        {
          processingState: 'PENDING',
          availableAt: LessThanOrEqual(now),
        },
        {
          processingState: 'PROCESSING',
          leaseExpiresAt: LessThanOrEqual(now),
        },
      ],
      order: { availableAt: 'ASC', createdAt: 'ASC' },
      take: OUTBOX_RECOVERY_BATCH_SIZE,
    });
    let enqueuedCount = 0;

    for (const event of events) {
      if (await this.enqueueWithoutAffectingAuthority(event)) {
        enqueuedCount += 1;
      }
    }

    return enqueuedCount;
  }

  private async claimEvent(
    outboxEventId: string,
  ): Promise<ClaimedOutboxEvent | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        InconnectMessagingOutboxEventEntity,
      );
      const event = await repository.findOne({
        where: { id: outboxEventId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();

      if (
        event === null ||
        event.processingState === 'PUBLISHED' ||
        event.processingState === 'FAILED' ||
        (event.processingState === 'PENDING' && event.availableAt > now) ||
        (event.processingState === 'PROCESSING' &&
          event.leaseExpiresAt !== null &&
          event.leaseExpiresAt > now)
      ) {
        return null;
      }

      const leaseToken = randomUUID();

      event.processingState = 'PROCESSING';
      event.leaseToken = leaseToken;
      event.leaseExpiresAt = new Date(
        now.getTime() + OUTBOX_LEASE_DURATION_MILLISECONDS,
      );
      event.attemptCount += 1;
      event.error = null;
      await repository.save(event);

      return { event, leaseToken };
    });
  }

  private async buildHint(
    event: InconnectMessagingOutboxEventEntity,
  ): Promise<InconnectMessagingRealtimeHint | null> {
    const realtimeEventType = this.toRealtimeEventType(event);

    if (realtimeEventType === null) {
      return null;
    }

    if (
      realtimeEventType === 'CONVERSATION_UPDATED' &&
      event.aggregateType === 'CONVERSATION'
    ) {
      const conversation = await this.dataSource
        .getRepository(InconnectMessagingConversationEntity)
        .findOne({
          select: ['id', 'workspaceId'],
          where: { id: event.aggregateId, workspaceId: event.workspaceId },
        });

      return conversation === null
        ? null
        : {
            eventId: event.id,
            eventType: realtimeEventType,
            conversationId: conversation.id,
            messageId: null,
            occurredAt: event.createdAt,
          };
    }

    if (
      realtimeEventType === 'CONVERSATION_UPDATED' ||
      event.aggregateType !== 'MESSAGE'
    ) {
      return null;
    }

    const message = await this.dataSource
      .getRepository(InconnectMessagingMessageEntity)
      .findOne({
        select: ['id', 'conversationId', 'workspaceId'],
        where: {
          id: event.aggregateId,
          workspaceId: event.workspaceId,
        },
      });

    if (message === null) {
      return null;
    }

    return {
      eventId: event.id,
      eventType: realtimeEventType,
      conversationId: message.conversationId,
      messageId: message.id,
      occurredAt: event.createdAt,
    };
  }

  private toRealtimeEventType(
    event: InconnectMessagingOutboxEventEntity,
  ): InconnectMessagingRealtimeEventType | null {
    if (
      event.eventType === 'INBOUND_MESSAGE_RECEIVED' ||
      event.eventType === 'OUTBOUND_MESSAGE_CREATED'
    ) {
      return 'MESSAGE_CREATED';
    }

    if (event.eventType === 'OUTBOUND_MESSAGE_STATUS_CHANGED') {
      return 'MESSAGE_STATUS_CHANGED';
    }

    if (event.eventType === 'MEDIA_ATTACHMENT_UPDATED') {
      return 'MESSAGE_UPDATED';
    }

    if (event.eventType === 'CONVERSATION_PENDING_CHANGED') {
      return 'CONVERSATION_UPDATED';
    }

    return null;
  }

  private async completeClaim(claim: ClaimedOutboxEvent): Promise<void> {
    const result = await this.outboxEventRepository.update(
      {
        id: claim.event.id,
        processingState: 'PROCESSING',
        leaseToken: claim.leaseToken,
      },
      {
        processingState: 'PUBLISHED',
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
        publishedAt: new Date(),
      },
    );

    if (result.affected !== 1) {
      throw new Error('INCONNECT Messaging outbox lease was lost');
    }
  }

  private async releaseClaimForRetry(
    claim: ClaimedOutboxEvent,
    errorCategory: string,
  ): Promise<void> {
    await this.outboxEventRepository.update(
      {
        id: claim.event.id,
        processingState: 'PROCESSING',
        leaseToken: claim.leaseToken,
      },
      {
        processingState: 'PENDING',
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: new Date(Date.now() + OUTBOX_RETRY_DELAY_MILLISECONDS),
        error: { category: errorCategory },
      },
    );
  }

  private async failClaimPermanently(
    claim: ClaimedOutboxEvent,
    errorCategory: string,
  ): Promise<void> {
    await this.outboxEventRepository.update(
      {
        id: claim.event.id,
        processingState: 'PROCESSING',
        leaseToken: claim.leaseToken,
      },
      {
        processingState: 'FAILED',
        leaseToken: null,
        leaseExpiresAt: null,
        error: { category: errorCategory },
      },
    );
    this.logResult(claim.event, 'FAILED', undefined, errorCategory);
  }

  private async enqueueWithoutAffectingAuthority(
    event: Pick<
      InconnectMessagingOutboxEventEntity,
      'id' | 'workspaceId' | 'eventType'
    >,
  ): Promise<boolean> {
    try {
      await this.messageQueueService.add(
        INCONNECT_MESSAGING_OUTBOX_PUBLISHING_JOB_NAME,
        { outboxEventId: event.id },
        {
          id: `inconnect-messaging-outbox:${event.id}`,
          retryLimit: 5,
        },
      );

      return true;
    } catch {
      this.logResult(
        event,
        'ENQUEUE_FAILED_RECOVERABLE',
        undefined,
        'QUEUE_UNAVAILABLE',
      );

      return false;
    }
  }

  private logResult(
    event: Pick<
      InconnectMessagingOutboxEventEntity,
      'id' | 'workspaceId' | 'eventType'
    >,
    publishResult: string,
    recipientCount?: number,
    errorCategory?: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        outboxEventId: event.id,
        eventType: event.eventType,
        workspaceId: event.workspaceId,
        publishResult,
        ...(recipientCount === undefined ? {} : { recipientCount }),
        ...(errorCategory === undefined ? {} : { errorCategory }),
      }),
    );
  }
}
