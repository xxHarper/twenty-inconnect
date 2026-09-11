import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { createHash } from 'crypto';

import { LessThanOrEqual, type Repository, type DataSource } from 'typeorm';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import { InconnectMessagingWebhookProcessingJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-processing.job';
import { type InconnectMessagingNormalizedWebhook } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingJson } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const RECOVERY_BATCH_SIZE = 100;

export type PersistInconnectMessagingWebhookReceiptInput = {
  workspaceId: string;
  providerConnectionId: string;
  normalizedWebhook: InconnectMessagingNormalizedWebhook;
  rawBody: string;
  firstReceivedAt: Date;
};

@Injectable()
export class InconnectMessagingWebhookReceiptService {
  private readonly logger = new Logger(
    InconnectMessagingWebhookReceiptService.name,
  );

  public constructor(
    private readonly dataSource: DataSource,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- Recovery intentionally scans durable receipts across all workspaces and preserves each receipt's persisted scope.
    @InjectRepository(InconnectMessagingWebhookReceiptEntity)
    private readonly webhookReceiptRepository: Repository<InconnectMessagingWebhookReceiptEntity>,
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  public computePayloadHash(rawBody: string): string {
    return createHash('sha256').update(rawBody, 'utf8').digest('hex');
  }

  public async persistAndRequestProcessing(
    input: PersistInconnectMessagingWebhookReceiptInput,
  ): Promise<InconnectMessagingWebhookReceiptEntity> {
    const payloadHash = this.computePayloadHash(input.rawBody);
    const receipt = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        InconnectMessagingWebhookReceiptEntity,
      );

      await repository
        .createQueryBuilder()
        .insert()
        .values({
          workspaceId: input.workspaceId,
          providerConnectionId: input.providerConnectionId,
          eventKind: input.normalizedWebhook.kind,
          idempotencyKey: input.normalizedWebhook.idempotencyKey,
          payloadHash,
          firstReceivedAt: input.firstReceivedAt,
          normalizedMetadata: () => ':normalizedMetadata',
          processingState: 'RECEIVED',
          leaseToken: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          error: null,
          processedAt: null,
        })
        .setParameter(
          'normalizedMetadata',
          input.normalizedWebhook as unknown as InconnectMessagingJson,
        )
        .orIgnore()
        .execute();

      const persistedReceipt = await repository.findOne({
        where: {
          providerConnectionId: input.providerConnectionId,
          eventKind: input.normalizedWebhook.kind,
          idempotencyKey: input.normalizedWebhook.idempotencyKey,
        },
      });

      if (persistedReceipt === null) {
        throw new InconnectMessagingWebhookException(
          'RECEIPT_NOT_PROCESSABLE',
          true,
        );
      }

      if (persistedReceipt.payloadHash !== payloadHash) {
        throw new InconnectMessagingWebhookException('PAYLOAD_CONFLICT', false);
      }

      return persistedReceipt;
    });

    await this.enqueueWithoutAffectingAuthority(receipt);

    return receipt;
  }

  public async recoverPendingReceipts(now = new Date()): Promise<number> {
    const receipts = await this.webhookReceiptRepository.find({
      select: ['id', 'workspaceId', 'providerConnectionId', 'eventKind'],
      where: [
        { processingState: 'RECEIVED' },
        {
          processingState: 'PROCESSING',
          leaseExpiresAt: LessThanOrEqual(now),
        },
      ],
      order: { firstReceivedAt: 'ASC' },
      take: RECOVERY_BATCH_SIZE,
    });

    let enqueuedCount = 0;

    for (const receipt of receipts) {
      if (await this.enqueueWithoutAffectingAuthority(receipt)) {
        enqueuedCount += 1;
      }
    }

    return enqueuedCount;
  }

  public async retryFailedReceipt(receiptId: string): Promise<boolean> {
    const result = await this.webhookReceiptRepository.update(
      { id: receiptId, processingState: 'FAILED' },
      {
        processingState: 'RECEIVED',
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
      },
    );

    if (result.affected !== 1) {
      return false;
    }

    const receipt = await this.webhookReceiptRepository.findOne({
      where: { id: receiptId },
    });

    return receipt === null
      ? false
      : await this.enqueueWithoutAffectingAuthority(receipt);
  }

  private async enqueueWithoutAffectingAuthority(
    receipt: Pick<
      InconnectMessagingWebhookReceiptEntity,
      'id' | 'workspaceId' | 'providerConnectionId' | 'eventKind'
    >,
  ): Promise<boolean> {
    try {
      await this.messageQueueService.add(
        InconnectMessagingWebhookProcessingJob.name,
        { receiptId: receipt.id },
        {
          id: `inconnect-messaging-webhook:${receipt.id}`,
          retryLimit: 5,
        },
      );

      return true;
    } catch {
      this.logger.warn(
        JSON.stringify({
          receiptId: receipt.id,
          provider: 'TWILIO',
          connectionId: receipt.providerConnectionId,
          workspaceId: receipt.workspaceId,
          eventKind: receipt.eventKind,
          processingResult: 'ENQUEUE_FAILED_RECOVERABLE',
          errorCategory: 'QUEUE_UNAVAILABLE',
        }),
      );

      return false;
    }
  }
}
