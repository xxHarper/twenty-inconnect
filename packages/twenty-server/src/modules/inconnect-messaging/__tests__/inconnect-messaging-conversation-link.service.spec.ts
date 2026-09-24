import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingConversationLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-link.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '13131313-1111-4111-8111-111111111111';
const OBJECT_ID = '13131313-2222-4222-8222-222222222222';
const CONVERSATION_ID = '13131313-3333-4333-8333-333333333333';
const RECORD_ID = '13131313-4444-4444-8444-444444444444';
const OTHER_RECORD_ID = '13131313-5555-4555-8555-555555555555';
const authContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_dynamic' },
  workspaceMemberId: 'workspace-member-id',
  workspaceMember: { id: 'workspace-member-id' },
} as never;

const buildService = ({
  conversationOverrides = {},
  manualLinkAllowed = true,
  conversationAuthorized = true,
  objectReadable = true,
  targetRecord = { recordId: RECORD_ID },
  recordAccessKind = 'owner-scoped',
  outboxInsertError = false,
}: {
  conversationOverrides?: Partial<InconnectMessagingConversationEntity>;
  manualLinkAllowed?: boolean;
  conversationAuthorized?: boolean;
  objectReadable?: boolean;
  targetRecord?: { recordId: string } | null;
  recordAccessKind?: string;
  outboxInsertError?: boolean;
} = {}) => {
  const conversation = {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    providerConnectionId: 'provider-connection-id',
    externalAddressNormalized: 'external-address',
    linkedRecordObjectMetadataId: null,
    linkedRecordId: null,
    lastInboundAt: new Date('2026-09-20T10:00:00.000Z'),
    pendingAt: new Date('2026-09-21T10:00:00.000Z'),
    ...conversationOverrides,
  } as InconnectMessagingConversationEntity;
  const transactionEvents: string[] = [];
  const conversationRepository = {
    findOne: jest.fn().mockImplementation(async () => {
      transactionEvents.push('conversation-locked');

      return conversation;
    }),
    save: jest.fn().mockImplementation(async (value) => {
      transactionEvents.push('conversation-saved');

      return value;
    }),
  };
  const configurationRepository = {
    findOne: jest.fn().mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      anchorObjectMetadataId: OBJECT_ID,
    }),
  };
  const objectMetadataRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: OBJECT_ID,
      workspaceId: WORKSPACE_ID,
    }),
  };
  const outboxRepository = {
    insert: jest.fn().mockImplementation(async () => {
      if (outboxInsertError) {
        throw new Error('outbox insert failed');
      }

      transactionEvents.push('outbox-inserted');
    }),
  };
  const targetQueryBuilder = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setLock: jest.fn(),
    setParameters: jest.fn(),
    getRawOne: jest.fn().mockImplementation(async () => {
      transactionEvents.push('target-read');

      return targetRecord;
    }),
  };

  for (const method of [
    'select',
    'from',
    'where',
    'andWhere',
    'setLock',
    'setParameters',
  ] as const) {
    targetQueryBuilder[method].mockReturnValue(targetQueryBuilder);
  }

  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === InconnectMessagingConversationEntity) {
        return conversationRepository;
      }
      if (entity === InconnectMessagingConfigurationEntity) {
        return configurationRepository;
      }
      if (entity === ObjectMetadataEntity) {
        return objectMetadataRepository;
      }
      if (entity === InconnectMessagingOutboxEventEntity) {
        return outboxRepository;
      }

      throw new Error('Unexpected repository');
    }),
    createQueryBuilder: jest.fn().mockReturnValue(targetQueryBuilder),
  };
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (callback) => {
      const result = await callback(manager);

      transactionEvents.push('committed');

      return result;
    }),
  };
  const authorizationService = {
    canUseManualLinking: jest.fn().mockResolvedValue(manualLinkAllowed),
    canManuallyLinkConversation: jest
      .fn()
      .mockResolvedValue(conversationAuthorized),
    canReadObjectRecords: jest.fn().mockResolvedValue(objectReadable),
  };
  const recordAccessAuthorizationService = {
    applyReadScopeToQueryBuilder: jest
      .fn()
      .mockResolvedValue({ kind: recordAccessKind }),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: {
        universalIdentifierById: { [OBJECT_ID]: 'dynamic-object' },
        byUniversalIdentifier: {
          'dynamic-object': {
            id: OBJECT_ID,
            workspaceId: WORKSPACE_ID,
            nameSingular: 'dynamicRecord',
          },
        },
      },
    }),
  };
  const contextResult = {
    state: 'LINKED',
    object: { objectMetadataId: OBJECT_ID, label: 'Dynamic record' },
    record: { recordId: RECORD_ID, recordLabel: 'Acme' },
    fields: [],
  };
  const contextService = {
    getConversationContext: jest.fn().mockResolvedValue(contextResult),
  };
  const outboxService = {
    requestPublication: jest.fn().mockImplementation(async () => {
      transactionEvents.push('publication-requested');

      return true;
    }),
  };

  return {
    service: new InconnectMessagingConversationLinkService(
      dataSource as never,
      authorizationService as never,
      recordAccessAuthorizationService as never,
      workspaceCacheService as never,
      contextService as never,
      outboxService as never,
    ),
    conversation,
    conversationRepository,
    outboxRepository,
    outboxService,
    contextService,
    targetQueryBuilder,
    authorizationService,
    recordAccessAuthorizationService,
    transactionEvents,
    dataSource,
  };
};

describe('InconnectMessagingConversationLinkService', () => {
  it('rejects a non-triage human before acquiring a Conversation lock', async () => {
    const { service, dataSource } = buildService({ manualLinkAllowed: false });

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toThrow('Conversation not found');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('locks, reauthorizes, links both tuple values, and persists one Outbox event atomically', async () => {
    const {
      service,
      conversation,
      conversationRepository,
      outboxRepository,
      outboxService,
      targetQueryBuilder,
      recordAccessAuthorizationService,
      transactionEvents,
    } = buildService();

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).resolves.toMatchObject({ state: 'LINKED' });

    expect(conversationRepository.findOne).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, workspaceId: WORKSPACE_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(targetQueryBuilder.from).toHaveBeenCalledWith(
      'workspace_dynamic._dynamicRecord',
      'inconnect_messaging_link_target',
    );
    expect(targetQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_read');
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        queryBuilder: targetQueryBuilder,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
      }),
    );
    expect(conversation.linkedRecordObjectMetadataId).toBe(OBJECT_ID);
    expect(conversation.linkedRecordId).toBe(RECORD_ID);
    expect(conversation.pendingAt).toEqual(
      new Date('2026-09-21T10:00:00.000Z'),
    );
    expect(conversation.lastInboundAt).toEqual(
      new Date('2026-09-20T10:00:00.000Z'),
    );
    expect(outboxRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'CONVERSATION',
        aggregateId: CONVERSATION_ID,
        eventType: 'CONVERSATION_LINKED',
        immutablePayload: { conversationId: CONVERSATION_ID },
      }),
    );
    expect(outboxService.requestPublication).toHaveBeenCalledTimes(1);
    expect(transactionEvents).toEqual([
      'conversation-locked',
      'target-read',
      'conversation-saved',
      'outbox-inserted',
      'committed',
      'publication-requested',
    ]);
  });

  it.each([
    ['conversation authorization fails', false, true, { recordId: RECORD_ID }],
    ['standard object read fails', true, false, { recordId: RECORD_ID }],
    ['target is deleted, inaccessible, or cross-workspace', true, true, null],
  ] as const)(
    'leaves the Conversation unassigned when %s',
    async (_name, conversationAuthorized, objectReadable, targetRecord) => {
      const { service, conversation, outboxRepository, contextService } =
        buildService({
          conversationAuthorized,
          objectReadable,
          targetRecord,
        });

      await expect(
        service.linkConversation({
          authContext,
          conversationId: CONVERSATION_ID,
          recordId: RECORD_ID,
        }),
      ).rejects.toThrow();
      expect(conversation.linkedRecordObjectMetadataId).toBeNull();
      expect(conversation.linkedRecordId).toBeNull();
      expect(outboxRepository.insert).not.toHaveBeenCalled();
      expect(contextService.getConversationContext).not.toHaveBeenCalled();
    },
  );

  it('fails closed before executing the target query when Record Access denies', async () => {
    const { service, targetQueryBuilder, outboxRepository } = buildService({
      recordAccessKind: 'denied',
    });

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toThrow('Record not found');
    expect(targetQueryBuilder.getRawOne).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('treats an authorized same-target retry as a no-op without another event', async () => {
    const {
      service,
      conversationRepository,
      outboxRepository,
      outboxService,
      contextService,
    } = buildService({
      conversationOverrides: {
        linkedRecordObjectMetadataId: OBJECT_ID,
        linkedRecordId: RECORD_ID,
      },
    });

    await service.linkConversation({
      authContext,
      conversationId: CONVERSATION_ID,
      recordId: RECORD_ID,
    });

    expect(conversationRepository.save).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
    expect(outboxService.requestPublication).not.toHaveBeenCalled();
    expect(contextService.getConversationContext).toHaveBeenCalledTimes(1);
  });

  it('does not request publication when the transaction rolls back', async () => {
    const { service, outboxService, contextService } = buildService({
      outboxInsertError: true,
    });

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toThrow('outbox insert failed');
    expect(outboxService.requestPublication).not.toHaveBeenCalled();
    expect(contextService.getConversationContext).not.toHaveBeenCalled();
  });

  it('does not overwrite an authorized Conversation already linked to another target', async () => {
    const { service, conversation, outboxRepository, targetQueryBuilder } =
      buildService({
        conversationOverrides: {
          linkedRecordObjectMetadataId: OBJECT_ID,
          linkedRecordId: OTHER_RECORD_ID,
        },
      });

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toThrow('CONVERSATION_ALREADY_LINKED');
    expect(conversation.linkedRecordId).toBe(OTHER_RECORD_ID);
    expect(targetQueryBuilder.getRawOne).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('uses the locked post-wait linkage state, preventing a second target from overwriting the winner', async () => {
    const { service, conversation, conversationRepository } = buildService();

    conversationRepository.findOne.mockImplementationOnce(async () => {
      conversation.linkedRecordObjectMetadataId = OBJECT_ID;
      conversation.linkedRecordId = OTHER_RECORD_ID;

      return conversation;
    });

    await expect(
      service.linkConversation({
        authContext,
        conversationId: CONVERSATION_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toThrow('CONVERSATION_ALREADY_LINKED');
    expect(conversation.linkedRecordId).toBe(OTHER_RECORD_ID);
    expect(conversationRepository.save).not.toHaveBeenCalled();
  });
});
