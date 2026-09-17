jest.mock(
  'src/engine/core-modules/file/utils/extract-file-info-or-throw.utils',
  () => ({
    extractFileInfoOrThrow: jest.fn().mockResolvedValue({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    }),
  }),
);

import { FileFolder } from 'twenty-shared/types';

import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingMediaIngestionService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service';

const ATTACHMENT_ID = '20202020-1111-4111-8111-111111111111';
const WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const MESSAGE_ID = '20202020-3333-4333-8333-333333333333';
const CONNECTION_ID = '20202020-4444-4444-8444-444444444444';

const buildAttachment = (ingestionState = 'PENDING') => ({
  id: ATTACHMENT_ID,
  workspaceId: WORKSPACE_ID,
  messageId: MESSAGE_ID,
  providerConnectionId: CONNECTION_ID,
  ordinal: 0,
  type: 'IMAGE',
  ingestionState,
  providerMediaLocator:
    'https://api.twilio.com/2010-04-01/Accounts/ACx/Messages/SMx/Media/MEx',
  declaredMimeType: 'image/jpeg',
  safeFilename: 'photo.jpg',
  fileId: null,
  mimeType: null,
  size: null,
  leaseToken: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  lastErrorCode: null,
  availableAt: null,
});

const buildService = ({
  ingestionState = 'PENDING',
  retrievalResult = {
    kind: 'SUCCESS',
    content: Buffer.from([0xff, 0xd8, 0xff]),
    mimeType: 'image/jpeg',
  },
  storageFailure = false,
}: {
  ingestionState?: string;
  retrievalResult?:
    | { kind: 'SUCCESS'; content: Buffer; mimeType: string }
    | {
        kind: 'RETRYABLE_FAILURE' | 'DEFINITIVE_FAILURE';
        code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_MEDIA_UNAVAILABLE';
      };
  storageFailure?: boolean;
} = {}) => {
  const attachment = buildAttachment(ingestionState);
  const attachmentTransactionRepository = {
    findOne: jest.fn().mockResolvedValue(attachment),
    save: jest.fn().mockResolvedValue(attachment),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === InconnectMessagingAttachmentEntity) {
        return attachmentTransactionRepository;
      }
      if (entity === InconnectMessagingOutboxEventEntity) {
        return outboxRepository;
      }
      throw new Error('Unexpected transaction repository');
    }),
  };
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: MESSAGE_ID,
      providerMessageId: 'SM-provider',
    }),
  };
  const connectionRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      lifecycleStatus: 'ENABLED',
      provider: 'TWILIO',
      channel: 'WHATSAPP',
      encryptedCredentials: 'encrypted',
    }),
  };
  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(async (callback) => await callback(manager)),
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === InconnectMessagingMessageEntity) return messageRepository;
      if (entity === InconnectMessagingProviderConnectionEntity) {
        return connectionRepository;
      }
      throw new Error('Unexpected repository');
    }),
  };
  const retrieveMedia = jest.fn().mockResolvedValue(retrievalResult);
  const fileStorageService = {
    writeFile: storageFailure
      ? jest.fn().mockRejectedValue(new Error('storage unavailable'))
      : jest.fn().mockResolvedValue({
          id: ATTACHMENT_ID,
          mimeType: 'image/jpeg',
          size: 3,
        }),
  };
  const outboxService = {
    requestPublication: jest.fn().mockResolvedValue(undefined),
  };
  const attachmentRepository = { find: jest.fn() };
  const messageQueueService = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new InconnectMessagingMediaIngestionService(
    dataSource as never,
    attachmentRepository as never,
    messageQueueService as never,
    { resolve: jest.fn().mockReturnValue({ retrieveMedia }) } as never,
    {
      decryptVersionedOrThrow: jest
        .fn()
        .mockReturnValue(JSON.stringify({ authToken: 'secret' })),
    } as never,
    fileStorageService as never,
    outboxService as never,
  );

  return {
    service,
    attachment,
    attachmentTransactionRepository,
    outboxRepository,
    retrieveMedia,
    fileStorageService,
    outboxService,
    attachmentRepository,
    messageQueueService,
  };
};

describe('InconnectMessagingMediaIngestionService', () => {
  it('stores a successful fetch once with a deterministic File identity', async () => {
    const {
      service,
      attachmentTransactionRepository,
      outboxRepository,
      retrieveMedia,
      fileStorageService,
      outboxService,
    } = buildService();

    await expect(
      service.processAttachment(ATTACHMENT_ID),
    ).resolves.toBeUndefined();

    expect(retrieveMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: 'SM-provider',
        maximumBytes: 16 * 1024 * 1024,
      }),
    );
    expect(fileStorageService.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileFolder: FileFolder.InconnectMessaging,
        workspaceId: WORKSPACE_ID,
        resourcePath: `${ATTACHMENT_ID}/attachment.jpg`,
        fileId: ATTACHMENT_ID,
      }),
    );
    expect(attachmentTransactionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ATTACHMENT_ID,
        ingestionState: 'PROCESSING',
      }),
      expect.objectContaining({
        ingestionState: 'AVAILABLE',
        fileId: ATTACHMENT_ID,
      }),
    );
    expect(outboxRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: MESSAGE_ID,
        eventType: 'MEDIA_ATTACHMENT_UPDATED',
      }),
    );
    expect(outboxService.requestPublication).toHaveBeenCalledTimes(1);
  });

  it('returns a retryable failure to PENDING without making the file visible', async () => {
    const { service, attachmentTransactionRepository, fileStorageService } =
      buildService({
        retrievalResult: {
          kind: 'RETRYABLE_FAILURE',
          code: 'PROVIDER_UNAVAILABLE',
        },
      });

    await expect(service.processAttachment(ATTACHMENT_ID)).rejects.toThrow(
      'media ingestion retry requested',
    );
    expect(attachmentTransactionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: ATTACHMENT_ID }),
      expect.objectContaining({
        ingestionState: 'PENDING',
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
      }),
    );
    expect(fileStorageService.writeFile).not.toHaveBeenCalled();
  });

  it('distinguishes a storage outage and keeps the durable retry state', async () => {
    const { service, attachmentTransactionRepository } = buildService({
      storageFailure: true,
    });

    await expect(service.processAttachment(ATTACHMENT_ID)).rejects.toThrow(
      'media ingestion retry requested',
    );
    expect(attachmentTransactionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: ATTACHMENT_ID }),
      expect.objectContaining({
        ingestionState: 'PENDING',
        lastErrorCode: 'STORAGE_UNAVAILABLE',
      }),
    );
  });

  it('marks provider-expired media terminal without retrying', async () => {
    const {
      service,
      attachmentTransactionRepository,
      fileStorageService,
      outboxRepository,
    } = buildService({
      retrievalResult: {
        kind: 'DEFINITIVE_FAILURE',
        code: 'PROVIDER_MEDIA_UNAVAILABLE',
      },
    });

    await expect(
      service.processAttachment(ATTACHMENT_ID),
    ).resolves.toBeUndefined();
    expect(attachmentTransactionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: ATTACHMENT_ID }),
      expect.objectContaining({
        ingestionState: 'EXPIRED',
        lastErrorCode: 'PROVIDER_MEDIA_UNAVAILABLE',
      }),
    );
    expect(fileStorageService.writeFile).not.toHaveBeenCalled();
    expect(outboxRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'MEDIA_ATTACHMENT_UPDATED' }),
    );
  });

  it('recovers pending or expired-leased work using a stable BullMQ identity', async () => {
    const { service, attachmentRepository, messageQueueService } =
      buildService();

    attachmentRepository.find.mockResolvedValue([
      { id: ATTACHMENT_ID, workspaceId: WORKSPACE_ID, messageId: MESSAGE_ID },
    ]);

    await expect(
      service.recoverPendingAttachments(new Date('2026-09-17T12:00:00.000Z')),
    ).resolves.toBe(1);
    expect(messageQueueService.add).toHaveBeenCalledWith(
      'InconnectMessagingMediaIngestionJob',
      { attachmentId: ATTACHMENT_ID },
      {
        id: `inconnect-messaging-media:${ATTACHMENT_ID}`,
        retryLimit: 5,
      },
    );
  });

  it('is idempotent once the attachment is already terminal', async () => {
    const { service, retrieveMedia, fileStorageService } = buildService({
      ingestionState: 'AVAILABLE',
    });

    await expect(
      service.processAttachment(ATTACHMENT_ID),
    ).resolves.toBeUndefined();
    expect(retrieveMedia).not.toHaveBeenCalled();
    expect(fileStorageService.writeFile).not.toHaveBeenCalled();
  });
});
