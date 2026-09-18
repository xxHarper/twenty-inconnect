import { type EntityManager } from 'typeorm';

import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingOutboundUploadEntity } from 'src/modules/inconnect-messaging/entities/outbound-upload.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingSendService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const clientRequestId = '33333333-3333-4333-8333-333333333333';
const outboundUploadId = 'aaaaaaaa-1111-4111-8111-111111111111';
const otherOutboundUploadId = 'bbbbbbbb-1111-4111-8111-111111111111';
const authContext = {
  type: 'user',
  workspace: { id: workspaceId },
  workspaceMemberId: '44444444-4444-4444-8444-444444444444',
  workspaceMember: { id: '44444444-4444-4444-8444-444444444444' },
};
const conversation = {
  id: conversationId,
  workspaceId,
  providerConnectionId: '55555555-5555-4555-8555-555555555555',
  linkedRecordId: null,
  linkedRecordObjectMetadataId: null,
  lastInboundAt: new Date(Date.now() - 60_000),
};

const buildService = () => {
  const persistedMessages = new Map<string, Record<string, unknown>>();
  const outboundUploads = new Map(
    [outboundUploadId, otherOutboundUploadId].map((id, index) => [
      id,
      {
        id,
        workspaceId,
        workspaceMemberId: authContext.workspaceMemberId,
        clientUploadId: `cccccccc-1111-4111-8111-11111111111${index}`,
        state: 'AVAILABLE',
        type: 'IMAGE',
        safeFilename: `photo-${index}.png`,
        size: 9,
        fileId: `dddddddd-1111-4111-8111-11111111111${index}`,
        mimeType: 'image/png',
        contentFingerprint: `content-fingerprint-${index}`,
        requestFingerprint: `request-fingerprint-${index}`,
        expiresAt: new Date(Date.now() + 60_000),
        completedAt: new Date(),
        consumedByMessageId: null,
        consumedAt: null,
      } as InconnectMessagingOutboundUploadEntity,
    ]),
  );
  let committed = false;
  const queryBuilder = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockImplementation((value: Record<string, unknown>) => {
      const key = value.clientRequestId;

      if (typeof key === 'string' && !persistedMessages.has(key)) {
        persistedMessages.set(key, value);
      }

      return queryBuilder;
    }),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const messageRepository = {
    findOne: jest
      .fn()
      .mockImplementation(
        async (options: { where: { clientRequestId: string } }) =>
          persistedMessages.get(options.where.clientRequestId) ?? null,
      ),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
  };
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
  const connectionRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: conversation.providerConnectionId,
      provider: 'FAKE',
      channel: 'WHATSAPP',
      encryptedCredentials: 'encrypted',
    }),
  };
  const attemptRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const attachmentRepository = {
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const outboundUploadRepository = {
    findOne: jest.fn().mockImplementation(
      async (options: {
        where: {
          id: string;
          workspaceId: string;
          workspaceMemberId: string;
        };
      }) => {
        const upload = outboundUploads.get(options.where.id);

        return upload?.workspaceId === options.where.workspaceId &&
          upload.workspaceMemberId === options.where.workspaceMemberId
          ? upload
          : null;
      },
    ),
    save: jest.fn().mockImplementation(async (upload) => upload),
  };
  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === InconnectMessagingMessageEntity) return messageRepository;
      if (entity === InconnectMessagingConversationEntity)
        return conversationRepository;
      if (entity === InconnectMessagingProviderConnectionEntity)
        return connectionRepository;
      if (entity === InconnectMessagingDispatchAttemptEntity)
        return attemptRepository;
      if (entity === InconnectMessagingOutboxEventEntity)
        return outboxRepository;
      if (entity === InconnectMessagingAttachmentEntity)
        return attachmentRepository;
      if (entity === InconnectMessagingOutboundUploadEntity)
        return outboundUploadRepository;
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
  const dataSource = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === InconnectMessagingMessageEntity) return messageRepository;
      if (entity === InconnectMessagingOutboundUploadEntity)
        return outboundUploadRepository;
      throw new Error('Unexpected repository');
    }),
    transaction: jest
      .fn()
      .mockImplementation(
        async (callback: (manager: EntityManager) => Promise<unknown>) => {
          const result = await callback(manager);

          committed = true;

          return result;
        },
      ),
  };
  const authorizationService = {
    findAuthorizedConversationForSend: jest
      .fn()
      .mockResolvedValue(conversation),
  };
  const providerRegistry = {
    resolve: jest.fn().mockReturnValue({
      capabilities: [
        'DISPATCH_FREEFORM',
        'DISPATCH_MEDIA',
        'DISPATCH_TEMPLATE',
      ],
      outboundMediaCapabilities: {
        maximumAttachments: 1,
        supportedMimeTypesByType: {
          IMAGE: ['image/png'],
          STICKER: ['image/webp'],
          AUDIO: ['audio/ogg'],
          VIDEO: ['video/mp4'],
          DOCUMENT: ['application/pdf'],
          CONTACT: ['text/vcard'],
        },
        captionSupportedTypes: ['IMAGE'],
      },
    }),
  };
  const dispatchService = {
    requestDispatch: jest.fn().mockImplementation(async () => {
      expect(committed).toBe(true);

      return true;
    }),
  };
  const outboxService = {
    requestPublication: jest.fn().mockResolvedValue(true),
  };
  const templateCatalogService = {
    getAuthorizedCatalog: jest.fn().mockResolvedValue({
      conversation,
      supportsFreeform: true,
      supportsTemplates: true,
      catalogAvailable: true,
      templates: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          providerReference: 'opaque-provider-reference',
          displayName: 'Appointment reminder',
          language: 'es',
          availability: 'AVAILABLE',
          content: { kind: 'TEXT', body: 'Hola {{1}}, cita {{2}}.' },
          variables: [
            {
              key: '1',
              required: true,
              maxLength: 1600,
              allowsNewlines: false,
            },
            {
              key: '2',
              required: true,
              maxLength: 1600,
              allowsNewlines: false,
            },
          ],
          definitionFingerprint: 'definition-fingerprint',
        },
      ],
    }),
  };
  const service = new InconnectMessagingSendService(
    dataSource as never,
    authorizationService as never,
    providerRegistry as never,
    dispatchService as never,
    outboxService as never,
    templateCatalogService as never,
  );

  return {
    service,
    dataSource,
    authorizationService,
    conversationRepository,
    messageRepository,
    attemptRepository,
    outboxRepository,
    attachmentRepository,
    outboundUploadRepository,
    outboundUploads,
    dispatchService,
    outboxService,
    templateCatalogService,
    queryBuilder,
  };
};

const send = (
  service: InconnectMessagingSendService,
  overrides: Partial<{ clientRequestId: string; body: string }> = {},
) =>
  service.sendFreeformText({
    authContext: authContext as never,
    conversationId,
    clientRequestId: overrides.clientRequestId ?? clientRequestId,
    body: overrides.body ?? 'Hola',
  });

const sendMedia = (
  service: InconnectMessagingSendService,
  overrides: Partial<{
    clientRequestId: string;
    body: string;
    outboundUploadIds: string[];
  }> = {},
) =>
  service.sendMessage({
    authContext: authContext as never,
    conversationId,
    clientRequestId: overrides.clientRequestId ?? clientRequestId,
    mode: 'FREEFORM',
    body: overrides.body,
    outboundUploadIds: overrides.outboundUploadIds ?? [outboundUploadId],
  });

describe('InconnectMessagingSendService', () => {
  it('hides unauthorized Conversation existence before persistence', async () => {
    const fixture = buildService();

    fixture.authorizationService.findAuthorizedConversationForSend.mockResolvedValue(
      null,
    );
    await expect(send(fixture.service)).rejects.toThrow(
      'Conversation not found',
    );
    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects free-form outside the server-authoritative window before creating an intent', async () => {
    const fixture = buildService();

    fixture.conversationRepository.findOne.mockResolvedValue({
      ...conversation,
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await expect(send(fixture.service)).rejects.toMatchObject({
      extensions: { subCode: 'SESSION_WINDOW_CLOSED' },
    });
    expect(fixture.messageRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(fixture.dispatchService.requestDispatch).not.toHaveBeenCalled();
  });

  it('commits Message, attempt, and outbox before enqueue and reuses a retry', async () => {
    const fixture = buildService();
    const first = await send(fixture.service);
    const second = await send(fixture.service);

    expect(second).toEqual(first);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(1);
    expect(fixture.outboxRepository.insert).toHaveBeenCalledTimes(1);
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
    expect(fixture.outboxService.requestPublication).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a request ID with changed content', async () => {
    const fixture = buildService();

    await send(fixture.service);
    await expect(send(fixture.service, { body: 'otro texto' })).rejects.toThrow(
      'IDEMPOTENCY_KEY_CONFLICT',
    );
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });

  it('uses one logical Message for concurrent calls with the same request ID', async () => {
    const fixture = buildService();
    const [first, second] = await Promise.all([
      send(fixture.service),
      send(fixture.service),
    ]);

    expect(first).toEqual(second);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(1);
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });

  it('accepts distinct request IDs as separate intentions', async () => {
    const fixture = buildService();
    const first = await send(fixture.service);
    const second = await send(fixture.service, {
      clientRequestId: '66666666-6666-4666-8666-666666666666',
    });

    expect(first.messageId).not.toBe(second.messageId);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(2);
  });

  it('isolates the same client request ID between actors', async () => {
    const fixture = buildService();

    const first = await send(fixture.service);
    const second = await fixture.service.sendFreeformText({
      authContext: {
        ...authContext,
        workspaceMemberId: '77777777-7777-4777-8777-777777777777',
        workspaceMember: { id: '77777777-7777-4777-8777-777777777777' },
      } as never,
      conversationId,
      clientRequestId,
      body: 'Hola',
    });

    expect(second.messageId).not.toBe(first.messageId);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(2);
  });

  it('isolates the same client request ID between Conversations', async () => {
    const fixture = buildService();
    const otherConversation = {
      ...conversation,
      id: '88888888-8888-4888-8888-888888888888',
    };
    const first = await send(fixture.service);

    fixture.authorizationService.findAuthorizedConversationForSend.mockResolvedValue(
      otherConversation,
    );
    fixture.conversationRepository.findOne.mockResolvedValue(otherConversation);
    const second = await fixture.service.sendFreeformText({
      authContext: authContext as never,
      conversationId: otherConversation.id,
      clientRequestId,
      body: 'Hola',
    });

    expect(second.messageId).not.toBe(first.messageId);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(2);
  });

  it('isolates the same client request ID between workspaces', async () => {
    const fixture = buildService();
    const otherWorkspaceId = '99999999-9999-4999-8999-999999999999';
    const otherConversation = {
      ...conversation,
      workspaceId: otherWorkspaceId,
    };
    const first = await send(fixture.service);

    fixture.authorizationService.findAuthorizedConversationForSend.mockResolvedValue(
      otherConversation,
    );
    fixture.conversationRepository.findOne.mockResolvedValue(otherConversation);
    const second = await fixture.service.sendFreeformText({
      authContext: {
        ...authContext,
        workspace: { id: otherWorkspaceId },
      } as never,
      conversationId,
      clientRequestId,
      body: 'Hola',
    });

    expect(second.messageId).not.toBe(first.messageId);
    expect(fixture.attemptRepository.insert).toHaveBeenCalledTimes(2);
  });

  it('sends a valid template outside the free-form window and persists its audit snapshot', async () => {
    const fixture = buildService();

    fixture.conversationRepository.findOne.mockResolvedValue({
      ...conversation,
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const result = await fixture.service.sendMessage({
      authContext: authContext as never,
      conversationId,
      clientRequestId,
      mode: 'TEMPLATE',
      templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      templateVariables: [
        { key: '2', value: 'mañana' },
        { key: '1', value: 'Ana' },
      ],
    });

    expect(result.outboundState).toBe('QUEUED');
    expect(fixture.messageRepository.createQueryBuilder).toHaveBeenCalled();
    expect(fixture.queryBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sendMode: 'TEMPLATE',
        body: 'Hola Ana, cita mañana.',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateProviderReference: 'opaque-provider-reference',
        templateDisplayName: 'Appointment reminder',
        templateLanguage: 'es',
        templateVariables: { '1': 'Ana', '2': 'mañana' },
        templateDefinitionFingerprint: 'definition-fingerprint',
      }),
    );
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });

  it('sends a valid template inside the free-form window', async () => {
    const fixture = buildService();

    await expect(
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [
          { key: '1', value: 'Ana' },
          { key: '2', value: 'mañana' },
        ],
      }),
    ).resolves.toMatchObject({ outboundState: 'QUEUED' });
  });

  it('rejects a template that is not in the current authorized catalog', async () => {
    const fixture = buildService();

    fixture.templateCatalogService.getAuthorizedCatalog.mockResolvedValue({
      conversation,
      supportsFreeform: true,
      supportsTemplates: true,
      catalogAvailable: true,
      templates: [],
    });
    await expect(
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [],
      }),
    ).rejects.toMatchObject({
      extensions: { subCode: 'TEMPLATE_UNAVAILABLE' },
    });
    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing, extra, and changed template variables', async () => {
    const fixture = buildService();

    await expect(
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [{ key: '1', value: 'Ana' }],
      }),
    ).rejects.toMatchObject({
      extensions: { subCode: 'INVALID_TEMPLATE_VARIABLES' },
    });

    await expect(
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [
          { key: '1', value: 'Ana' },
          { key: '2', value: 'mañana' },
          { key: '3', value: 'extra' },
        ],
      }),
    ).rejects.toMatchObject({
      extensions: { subCode: 'INVALID_TEMPLATE_VARIABLES' },
    });
  });

  it('conflicts when the same template request ID is reused with different variables', async () => {
    const fixture = buildService();
    const sendTemplate = (value: string) =>
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [
          { key: '1', value },
          { key: '2', value: 'mañana' },
        ],
      });

    await sendTemplate('Ana');
    await expect(sendTemplate('Beto')).rejects.toThrow(
      'IDEMPOTENCY_KEY_CONFLICT',
    );
  });

  it('returns the same durable Message for an identical template retry', async () => {
    const fixture = buildService();
    const sendTemplate = () =>
      fixture.service.sendMessage({
        authContext: authContext as never,
        conversationId,
        clientRequestId,
        mode: 'TEMPLATE',
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        templateVariables: [
          { key: '1', value: 'Ana' },
          { key: '2', value: 'mañana' },
        ],
      });

    const first = await sendTemplate();
    const retry = await sendTemplate();

    expect(retry).toEqual(first);
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });

  it('atomically consumes an owned upload and creates an available Attachment', async () => {
    const fixture = buildService();

    const result = await sendMedia(fixture.service, { body: 'caption' });
    const upload = fixture.outboundUploads.get(outboundUploadId);

    expect(result.outboundState).toBe('QUEUED');
    expect(fixture.attachmentRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: result.messageId,
        ordinal: 0,
        type: 'IMAGE',
        ingestionState: 'AVAILABLE',
        fileId: upload?.fileId,
        mimeType: 'image/png',
        size: 9,
      }),
    ]);
    expect(upload).toMatchObject({
      state: 'CONSUMED',
      consumedByMessageId: result.messageId,
    });
  });

  it('returns the same durable media Message for an identical retry', async () => {
    const fixture = buildService();

    const first = await sendMedia(fixture.service);
    const retry = await sendMedia(fixture.service);

    expect(retry).toEqual(first);
    expect(fixture.attachmentRepository.insert).toHaveBeenCalledTimes(1);
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });

  it('conflicts when a media request ID is reused with a different upload', async () => {
    const fixture = buildService();

    await sendMedia(fixture.service);
    await expect(
      sendMedia(fixture.service, {
        outboundUploadIds: [otherOutboundUploadId],
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_CONFLICT');
    expect(fixture.attachmentRepository.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects an upload owned by a different actor without creating a Message', async () => {
    const fixture = buildService();
    const upload = fixture.outboundUploads.get(outboundUploadId);

    if (upload !== undefined) {
      upload.workspaceMemberId = 'eeeeeeee-1111-4111-8111-111111111111';
    }

    await expect(sendMedia(fixture.service)).rejects.toMatchObject({
      extensions: { subCode: 'OUTBOUND_UPLOAD_UNAVAILABLE' },
    });
    expect(fixture.messageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects an upload from another workspace without creating a Message', async () => {
    const fixture = buildService();
    const upload = fixture.outboundUploads.get(outboundUploadId);

    if (upload !== undefined) {
      upload.workspaceId = 'ffffffff-1111-4111-8111-111111111111';
    }

    await expect(sendMedia(fixture.service)).rejects.toMatchObject({
      extensions: { subCode: 'OUTBOUND_UPLOAD_UNAVAILABLE' },
    });
    expect(fixture.messageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('prevents the same single-use upload from being consumed by another send intention', async () => {
    const fixture = buildService();

    await sendMedia(fixture.service);
    await expect(
      sendMedia(fixture.service, {
        clientRequestId: '99999999-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({
      extensions: { subCode: 'OUTBOUND_UPLOAD_UNAVAILABLE' },
    });
    expect(fixture.attachmentRepository.insert).toHaveBeenCalledTimes(1);
    expect(fixture.dispatchService.requestDispatch).toHaveBeenCalledTimes(1);
  });
});
