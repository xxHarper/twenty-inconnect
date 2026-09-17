import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { FileFolder } from 'twenty-shared/types';
import {
  DataSource,
  LessThanOrEqual,
  type EntityManager,
  type Repository,
} from 'typeorm';

import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { extractFileInfoOrThrow } from 'src/engine/core-modules/file/utils/extract-file-info-or-throw.utils';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import {
  INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
  INCONNECT_MESSAGING_MEDIA_EXTENSION_BY_MIME,
  isInconnectMessagingMimeAllowedForType,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-media-policy.constant';
import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { type InconnectMessagingMediaRetrievalResult } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { type InconnectMessagingJson } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const MEDIA_LEASE_DURATION_MILLISECONDS = 5 * 60 * 1000;
const MEDIA_RECOVERY_BATCH_SIZE = 100;
const MAX_MEDIA_INGESTION_ATTEMPTS = 5;

type ClaimedAttachment = {
  attachment: InconnectMessagingAttachmentEntity;
  leaseToken: string;
};

@Injectable()
export class InconnectMessagingMediaIngestionService {
  private readonly logger = new Logger(
    InconnectMessagingMediaIngestionService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- Recovery scans durable attachment work across workspaces and then uses each row's persisted workspace scope.
    @InjectRepository(InconnectMessagingAttachmentEntity)
    private readonly attachmentRepository: Repository<InconnectMessagingAttachmentEntity>,
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly fileStorageService: FileStorageService,
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  async requestPendingAttachmentsForProviderMessage({
    workspaceId,
    providerConnectionId,
    providerMessageId,
  }: {
    workspaceId: string;
    providerConnectionId: string;
    providerMessageId: string;
  }): Promise<number> {
    const message = await this.dataSource
      .getRepository(InconnectMessagingMessageEntity)
      .findOne({
        select: ['id'],
        where: {
          workspaceId,
          providerConnectionId,
          providerMessageId,
          direction: 'INBOUND',
        },
      });

    if (message === null) return 0;

    const attachments = await this.attachmentRepository.find({
      select: ['id', 'workspaceId', 'messageId'],
      where: { messageId: message.id, workspaceId, ingestionState: 'PENDING' },
      order: { ordinal: 'ASC' },
    });

    let count = 0;

    for (const attachment of attachments) {
      if (await this.enqueueWithoutAffectingAuthority(attachment)) count += 1;
    }

    return count;
  }

  async recoverPendingAttachments(now = new Date()): Promise<number> {
    const attachments = await this.attachmentRepository.find({
      select: ['id', 'workspaceId', 'messageId'],
      where: [
        { ingestionState: 'PENDING' },
        {
          ingestionState: 'PROCESSING',
          leaseExpiresAt: LessThanOrEqual(now),
        },
      ],
      order: { createdAt: 'ASC' },
      take: MEDIA_RECOVERY_BATCH_SIZE,
    });
    let count = 0;

    for (const attachment of attachments) {
      if (await this.enqueueWithoutAffectingAuthority(attachment)) count += 1;
    }

    return count;
  }

  async processAttachment(attachmentId: string): Promise<void> {
    const claim = await this.claimAttachment(attachmentId);

    if (claim === null) return;

    let retrievalResult: InconnectMessagingMediaRetrievalResult;

    try {
      retrievalResult = await this.retrieve(claim.attachment);
    } catch {
      retrievalResult = {
        kind: 'RETRYABLE_FAILURE',
        code: 'PROVIDER_UNAVAILABLE',
      };
    }

    if (retrievalResult.kind !== 'SUCCESS') {
      await this.handleFailure(claim, retrievalResult);
      return;
    }

    const declaredMimeType = claim.attachment.declaredMimeType;

    if (
      declaredMimeType === null ||
      !isInconnectMessagingMimeAllowedForType({
        mimeType: retrievalResult.mimeType,
        type: claim.attachment.type,
      })
    ) {
      await this.handleFailure(claim, {
        kind: 'DEFINITIVE_FAILURE',
        code: 'MIME_MISMATCH',
      });
      return;
    }

    const extension =
      INCONNECT_MESSAGING_MEDIA_EXTENSION_BY_MIME[retrievalResult.mimeType];

    if (extension === undefined) {
      await this.handleFailure(claim, {
        kind: 'DEFINITIVE_FAILURE',
        code: 'MIME_MISMATCH',
      });
      return;
    }

    const resourcePath = `${claim.attachment.id}/attachment.${extension}`;
    let detectedMimeType: string;

    try {
      const detected = await extractFileInfoOrThrow({
        file: retrievalResult.content,
        filename: resourcePath,
      });

      detectedMimeType = detected.mimeType;
    } catch {
      await this.handleFailure(claim, {
        kind: 'DEFINITIVE_FAILURE',
        code: 'MIME_MISMATCH',
      });
      return;
    }

    if (
      detectedMimeType !== retrievalResult.mimeType &&
      !(
        claim.attachment.type === 'CONTACT' && detectedMimeType === 'text/vcard'
      )
    ) {
      await this.handleFailure(claim, {
        kind: 'DEFINITIVE_FAILURE',
        code: 'MIME_MISMATCH',
      });
      return;
    }

    let publicationRequest: InconnectMessagingOutboxPublicationRequest | null;

    try {
      const file = await this.fileStorageService.writeFile({
        sourceFile: retrievalResult.content,
        fileFolder: FileFolder.InconnectMessaging,
        applicationUniversalIdentifier:
          TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
        workspaceId: claim.attachment.workspaceId,
        resourcePath,
        fileId: claim.attachment.id,
        settings: { isTemporaryFile: false, toDelete: false },
      });

      publicationRequest = await this.finalizeAvailable({
        claim,
        fileId: file.id,
        mimeType: file.mimeType,
        size: Number(file.size),
      });
    } catch {
      await this.handleFailure(claim, {
        kind: 'RETRYABLE_FAILURE',
        code: 'STORAGE_UNAVAILABLE',
      });
      return;
    }

    if (publicationRequest !== null) {
      await this.outboxService.requestPublication(publicationRequest);
    }
  }

  private async retrieve(
    attachment: InconnectMessagingAttachmentEntity,
  ): Promise<InconnectMessagingMediaRetrievalResult> {
    if (
      attachment.providerMediaLocator === null ||
      attachment.declaredMimeType === null
    ) {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    const [message, connection] = await Promise.all([
      this.dataSource.getRepository(InconnectMessagingMessageEntity).findOne({
        select: ['id', 'providerMessageId'],
        where: {
          id: attachment.messageId,
          workspaceId: attachment.workspaceId,
          providerConnectionId: attachment.providerConnectionId,
          direction: 'INBOUND',
        },
      }),
      this.dataSource
        .getRepository(InconnectMessagingProviderConnectionEntity)
        .findOne({
          where: {
            id: attachment.providerConnectionId,
            workspaceId: attachment.workspaceId,
            lifecycleStatus: 'ENABLED',
          },
        }),
    ]);

    if (
      message?.providerMessageId === null ||
      message === null ||
      connection?.encryptedCredentials === null ||
      connection === null
    ) {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    let credentials: InconnectMessagingJson;

    try {
      const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
        connection.encryptedCredentials,
        { workspaceId: attachment.workspaceId },
      );
      const parsed: unknown = JSON.parse(plaintext);

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new Error('Invalid provider credentials');
      }
      credentials = parsed as InconnectMessagingJson;
    } catch {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    const provider = this.providerRegistry.resolve({
      provider: connection.provider,
      channel: connection.channel,
    });

    if (provider.retrieveMedia === undefined) {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    return provider.retrieveMedia({
      credentials,
      providerMessageId: message.providerMessageId,
      providerMediaLocator: attachment.providerMediaLocator,
      declaredMimeType: attachment.declaredMimeType,
      maximumBytes: INCONNECT_MESSAGING_MAXIMUM_MEDIA_BYTES,
    });
  }

  private async claimAttachment(
    attachmentId: string,
  ): Promise<ClaimedAttachment | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        InconnectMessagingAttachmentEntity,
      );
      const attachment = await repository.findOne({
        where: { id: attachmentId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();

      if (
        attachment === null ||
        ['AVAILABLE', 'FAILED', 'EXPIRED'].includes(
          attachment.ingestionState,
        ) ||
        (attachment.ingestionState === 'PROCESSING' &&
          attachment.leaseExpiresAt !== null &&
          attachment.leaseExpiresAt > now)
      ) {
        return null;
      }

      const leaseToken = randomUUID();

      attachment.ingestionState = 'PROCESSING';
      attachment.leaseToken = leaseToken;
      attachment.leaseExpiresAt = new Date(
        now.getTime() + MEDIA_LEASE_DURATION_MILLISECONDS,
      );
      attachment.attemptCount += 1;
      attachment.lastErrorCode = null;
      await repository.save(attachment);

      return { attachment, leaseToken };
    });
  }

  private async finalizeAvailable({
    claim,
    fileId,
    mimeType,
    size,
  }: {
    claim: ClaimedAttachment;
    fileId: string;
    mimeType: string;
    size: number;
  }): Promise<InconnectMessagingOutboxPublicationRequest | null> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(InconnectMessagingAttachmentEntity)
        .update(
          {
            id: claim.attachment.id,
            ingestionState: 'PROCESSING',
            leaseToken: claim.leaseToken,
          },
          {
            ingestionState: 'AVAILABLE',
            fileId,
            mimeType,
            size,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            availableAt: new Date(),
          },
        );

      return result.affected === 1
        ? await this.createUpdatedOutboxEvent(manager, claim, 'AVAILABLE')
        : null;
    });
  }

  private async handleFailure(
    claim: ClaimedAttachment,
    failure: Exclude<
      InconnectMessagingMediaRetrievalResult,
      { kind: 'SUCCESS' }
    >,
  ): Promise<void> {
    const shouldRetry =
      failure.kind === 'RETRYABLE_FAILURE' &&
      claim.attachment.attemptCount < MAX_MEDIA_INGESTION_ATTEMPTS;
    const finalState =
      failure.code === 'PROVIDER_MEDIA_UNAVAILABLE' ? 'EXPIRED' : 'FAILED';
    let publicationRequest: InconnectMessagingOutboxPublicationRequest | null =
      null;

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(InconnectMessagingAttachmentEntity)
        .update(
          {
            id: claim.attachment.id,
            ingestionState: 'PROCESSING',
            leaseToken: claim.leaseToken,
          },
          {
            ingestionState: shouldRetry ? 'PENDING' : finalState,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: failure.code,
          },
        );

      if (result.affected === 1 && !shouldRetry) {
        publicationRequest = await this.createUpdatedOutboxEvent(
          manager,
          claim,
          finalState,
        );
      }
    });

    if (publicationRequest !== null) {
      await this.outboxService.requestPublication(publicationRequest);
    }

    if (shouldRetry) {
      throw new Error('INCONNECT Messaging media ingestion retry requested');
    }
  }

  private async createUpdatedOutboxEvent(
    manager: EntityManager,
    claim: ClaimedAttachment,
    state: string,
  ): Promise<InconnectMessagingOutboxPublicationRequest> {
    const id = randomUUID();

    await manager.getRepository(InconnectMessagingOutboxEventEntity).insert({
      id,
      workspaceId: claim.attachment.workspaceId,
      aggregateType: 'MESSAGE',
      aggregateId: claim.attachment.messageId,
      eventType: 'MEDIA_ATTACHMENT_UPDATED',
      immutablePayload: { messageId: claim.attachment.messageId },
      deduplicationKey: `inconnect-messaging:attachment:${claim.attachment.id}:${state}`,
      availableAt: new Date(),
      processingState: 'PENDING',
      leaseToken: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      error: null,
      publishedAt: null,
    });

    return {
      id,
      workspaceId: claim.attachment.workspaceId,
      eventType: 'MEDIA_ATTACHMENT_UPDATED',
    };
  }

  private async enqueueWithoutAffectingAuthority(
    attachment: Pick<
      InconnectMessagingAttachmentEntity,
      'id' | 'workspaceId' | 'messageId'
    >,
  ): Promise<boolean> {
    try {
      await this.messageQueueService.add(
        'InconnectMessagingMediaIngestionJob',
        { attachmentId: attachment.id },
        {
          id: `inconnect-messaging-media:${attachment.id}`,
          retryLimit: MAX_MEDIA_INGESTION_ATTEMPTS,
        },
      );
      return true;
    } catch {
      this.logger.warn(
        JSON.stringify({
          attachmentId: attachment.id,
          messageId: attachment.messageId,
          workspaceId: attachment.workspaceId,
          processingResult: 'ENQUEUE_FAILED_RECOVERABLE',
          errorCategory: 'QUEUE_UNAVAILABLE',
        }),
      );
      return false;
    }
  }
}
