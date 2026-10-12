import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import {
  InconnectMessagingAutoCreateAuthorityException,
  InconnectMessagingAutoCreateAuthorityExceptionCode,
} from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import { InconnectMessagingInboundAutoLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-inbound-auto-link.service';
import { INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const WORKSPACE_ID = '14141414-1111-4111-8111-111111111111';
const CONVERSATION_ID = '14141414-2222-4222-8222-222222222222';
const MESSAGE_ID = '14141414-3333-4333-8333-333333333333';
const OBJECT_ID = '14141414-4444-4444-8444-444444444444';
const RECORD_ID = '14141414-5555-4555-8555-555555555555';
const HUMAN_RECORD_ID = '14141414-6666-4666-8666-666666666666';
const PHONE_INPUT = '+525514552571';

const buildService = ({
  conversationOverrides = {},
  revalidatedResolution = {
    state: 'UNIQUE',
    recordId: RECORD_ID,
    objectMetadataId: OBJECT_ID,
  },
  autoCreateEnabled = false,
}: {
  conversationOverrides?: Partial<InconnectMessagingConversationEntity>;
  revalidatedResolution?:
    | { state: 'DISABLED' | 'INVALID' | 'NO_MATCH' | 'AMBIGUOUS' }
    | {
        state: 'UNIQUE';
        recordId: string;
        objectMetadataId: string;
      };
  autoCreateEnabled?: boolean;
} = {}) => {
  const conversation = Object.assign(
    new InconnectMessagingConversationEntity(),
    {
      id: CONVERSATION_ID,
      workspaceId: WORKSPACE_ID,
      providerConnectionId: 'provider-connection-id',
      externalAddressNormalized: PHONE_INPUT,
      waId: '525514552571',
      linkedRecordObjectMetadataId: null,
      linkedRecordId: null,
      lastInboundAt: new Date('2026-09-29T10:00:00.000Z'),
      pendingAt: new Date('2026-09-29T11:00:00.000Z'),
      ...conversationOverrides,
    },
  );
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue({ conversationId: CONVERSATION_ID }),
  };
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
    save: jest.fn().mockImplementation(async (value) => value),
  };
  const configuration = {
    workspaceId: WORKSPACE_ID,
    anchorObjectMetadataId: OBJECT_ID,
    autoCreateEnabled,
  };
  const configurationRepository = {
    findOne: jest.fn().mockResolvedValue(configuration),
  };
  const outboxInsertExecute = jest.fn().mockResolvedValue({ identifiers: [] });
  const conversationUpdateExecute = jest
    .fn()
    .mockResolvedValue({ affected: 1 });
  const outboxRepository = { insert: outboxInsertExecute };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === InconnectMessagingConversationEntity) {
        return conversationRepository;
      }
      if (entity === InconnectMessagingConfigurationEntity) {
        return configurationRepository;
      }
      if (entity === InconnectMessagingOutboxEventEntity) {
        return outboxRepository;
      }

      throw new Error('Unexpected transactional repository');
    }),
  };
  const dataSource = {
    getRepository: jest.fn((entity) => {
      if (entity === InconnectMessagingMessageEntity) {
        return messageRepository;
      }
      if (entity === InconnectMessagingConversationEntity) {
        return conversationRepository;
      }
      if (entity === InconnectMessagingConfigurationEntity) {
        return configurationRepository;
      }

      throw new Error('Unexpected repository');
    }),
  };
  const backgroundResolver = {
    resolvePhoneIdentityForLink: jest
      .fn()
      .mockResolvedValue(revalidatedResolution),
  };
  let transactionActive = false;
  const queryRunner = {
    manager,
    connection: undefined as unknown,
    isReleased: false,
    get isTransactionActive() {
      return transactionActive;
    },
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockImplementation(async () => {
      transactionActive = true;
    }),
    commitTransaction: jest.fn().mockImplementation(async () => {
      transactionActive = false;
    }),
    rollbackTransaction: jest.fn().mockImplementation(async () => {
      transactionActive = false;
    }),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
  };
  const workspaceDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  };
  queryRunner.connection = workspaceDataSource;
  const coreQueryBuilderService = {
    createCoreQueryBuilder: jest.fn(({ target }: { target: unknown }) => {
      let operation: 'select' | 'update' | 'insert' = 'select';
      const builder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        update: jest.fn().mockImplementation(() => {
          operation = 'update';

          return builder;
        }),
        set: jest.fn().mockReturnThis(),
        insert: jest.fn().mockImplementation(() => {
          operation = 'insert';

          return builder;
        }),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        updateEntity: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => {
          if (target === InconnectMessagingConversationEntity) {
            return conversationRepository.findOne();
          }
          if (target === InconnectMessagingConfigurationEntity) {
            return configurationRepository.findOne();
          }

          throw new Error('Unexpected Core SELECT target');
        }),
        execute: jest.fn(async () => {
          if (
            target === InconnectMessagingConversationEntity &&
            operation === 'update'
          ) {
            return conversationUpdateExecute();
          }
          if (
            target === InconnectMessagingOutboxEventEntity &&
            operation === 'insert'
          ) {
            return outboxInsertExecute();
          }

          throw new Error('Unexpected Core write target');
        }),
      };

      return builder;
    }),
  };
  const globalWorkspaceOrmManager = {
    getGlobalWorkspaceDataSource: jest
      .fn()
      .mockResolvedValue(workspaceDataSource),
  };
  const authority = Object.freeze({});
  const autoCreateAuthorityService = {
    issueAuthority: jest.fn().mockResolvedValue(authority),
    resolveCreatePlan: jest.fn().mockResolvedValue({
      objectMetadataId: OBJECT_ID,
    }),
  };
  const automationRecordCreateService = {
    execute: jest.fn().mockResolvedValue({
      objectMetadataId: OBJECT_ID,
      recordId: RECORD_ID,
    }),
  };

  return {
    service: new InconnectMessagingInboundAutoLinkService(
      dataSource as never,
      globalWorkspaceOrmManager as never,
      coreQueryBuilderService as never,
      backgroundResolver as never,
      autoCreateAuthorityService as never,
      automationRecordCreateService as never,
    ),
    autoCreateAuthorityService,
    automationRecordCreateService,
    backgroundResolver,
    configuration,
    conversation,
    conversationRepository,
    outboxRepository,
    outboxInsertExecute,
    conversationUpdateExecute,
    coreQueryBuilderService,
    dataSource,
    queryRunner,
    workspaceDataSource,
  };
};

describe('InconnectMessagingInboundAutoLinkService', () => {
  it('links a UNIQUE result only after locked transactional revalidation', async () => {
    const {
      service,
      backgroundResolver,
      conversation,
      coreQueryBuilderService,
      queryRunner,
    } = buildService();

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toMatchObject({
      state: 'LINKED_EXISTING',
      publicationRequest: {
        workspaceId: WORKSPACE_ID,
        eventType: 'CONVERSATION_LINKED',
      },
    });

    expect(coreQueryBuilderService.createCoreQueryBuilder).toHaveBeenCalledWith(
      expect.objectContaining({
        queryRunner,
        target: InconnectMessagingConversationEntity,
      }),
    );
    expect(
      coreQueryBuilderService.createCoreQueryBuilder.mock.results[0].value
        .setLock,
    ).toHaveBeenCalledWith('pessimistic_write');
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [JSON.stringify([WORKSPACE_ID, OBJECT_ID, PHONE_INPUT])],
    );
    expect(queryRunner.query.mock.invocationCallOrder[0]).toBeLessThan(
      coreQueryBuilderService.createCoreQueryBuilder.mock
        .invocationCallOrder[0],
    );
    expect(backgroundResolver.resolvePhoneIdentityForLink).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        input: PHONE_INPUT,
      }),
    );
    expect(conversation.linkedRecordObjectMetadataId).toBe(OBJECT_ID);
    expect(conversation.linkedRecordId).toBe(RECORD_ID);
    expect(conversation.pendingAt).toEqual(
      new Date('2026-09-29T11:00:00.000Z'),
    );
    expect(conversation.lastInboundAt).toEqual(
      new Date('2026-09-29T10:00:00.000Z'),
    );
    const outboxBuilderIndex =
      coreQueryBuilderService.createCoreQueryBuilder.mock.calls.findIndex(
        ([{ target }]) => target === InconnectMessagingOutboxEventEntity,
      );

    expect(
      coreQueryBuilderService.createCoreQueryBuilder.mock.results[
        outboxBuilderIndex
      ].value.values,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONVERSATION_LINKED',
        immutablePayload: {
          conversationId: CONVERSATION_ID,
          actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        },
      }),
    );
    expect(
      coreQueryBuilderService.createCoreQueryBuilder.mock.results[
        outboxBuilderIndex
      ].value.updateEntity,
    ).toHaveBeenCalledWith(false);
    const conversationWriteBuilderIndex =
      coreQueryBuilderService.createCoreQueryBuilder.mock.results.findIndex(
        ({ value }) => value.update.mock.calls.length > 0,
      );

    expect(
      coreQueryBuilderService.createCoreQueryBuilder.mock.results[
        conversationWriteBuilderIndex
      ].value.updateEntity,
    ).toHaveBeenCalledWith(false);
  });

  it.each(['DISABLED', 'INVALID', 'AMBIGUOUS'] as const)(
    'leaves the Conversation UNASSIGNED for %s',
    async (state) => {
      const { service, conversation, outboxRepository, backgroundResolver } =
        buildService({ revalidatedResolution: { state } });

      await expect(
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({ state, publicationRequest: null });
      expect(conversation.linkedRecordObjectMetadataId).toBeNull();
      expect(conversation.linkedRecordId).toBeNull();
      expect(backgroundResolver.resolvePhoneIdentityForLink).toHaveBeenCalled();
      expect(outboxRepository.insert).not.toHaveBeenCalled();
    },
  );

  it('keeps NO_MATCH unassigned when administrative auto-create is disabled', async () => {
    const { service, automationRecordCreateService, outboxRepository } =
      buildService({ revalidatedResolution: { state: 'NO_MATCH' } });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'NO_MATCH_AUTO_CREATE_DISABLED',
      publicationRequest: null,
    });
    expect(automationRecordCreateService.execute).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('short-circuits an already LINKED Conversation before phone resolution', async () => {
    const { service, backgroundResolver, outboxRepository } = buildService({
      conversationOverrides: {
        linkedRecordObjectMetadataId: OBJECT_ID,
        linkedRecordId: HUMAN_RECORD_ID,
      },
    });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'ALREADY_LINKED',
      publicationRequest: null,
    });
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('preserves a human link that wins before the system Conversation lock', async () => {
    const {
      service,
      conversation,
      conversationRepository,
      backgroundResolver,
      outboxRepository,
    } = buildService();

    conversationRepository.findOne
      .mockResolvedValueOnce(conversation)
      .mockImplementationOnce(async () => {
        conversation.linkedRecordObjectMetadataId = OBJECT_ID;
        conversation.linkedRecordId = HUMAN_RECORD_ID;

        return conversation;
      });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'ALREADY_LINKED',
      publicationRequest: null,
    });
    expect(conversation.linkedRecordId).toBe(HUMAN_RECORD_ID);
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('fails closed when the Conversation identity changes before its row lock', async () => {
    const {
      service,
      conversation,
      conversationRepository,
      backgroundResolver,
      automationRecordCreateService,
      outboxRepository,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    conversationRepository.findOne
      .mockResolvedValueOnce(conversation)
      .mockImplementationOnce(async () => {
        conversation.externalAddressNormalized = '+525514552572';

        return conversation;
      });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'NO_MATCH_NOT_READY',
      publicationRequest: null,
    });
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).not.toHaveBeenCalled();
    expect(automationRecordCreateService.execute).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('creates with the current authority and links from the exact write receipt', async () => {
    const {
      service,
      autoCreateAuthorityService,
      automationRecordCreateService,
      conversation,
      outboxRepository,
      queryRunner,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toMatchObject({ state: 'CREATED_AND_LINKED' });
    expect(autoCreateAuthorityService.issueAuthority).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      queryRunner,
    });
    expect(automationRecordCreateService.execute).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      canonicalPhoneIdentity: PHONE_INPUT,
      authority: expect.any(Object),
      queryRunner,
    });
    expect(conversation.linkedRecordObjectMetadataId).toBe(OBJECT_ID);
    expect(conversation.linkedRecordId).toBe(RECORD_ID);
    expect(outboxRepository.insert).toHaveBeenCalledTimes(1);
  });

  it('fails closed when current auto-create authority is not ready', async () => {
    const {
      service,
      autoCreateAuthorityService,
      automationRecordCreateService,
      outboxRepository,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    autoCreateAuthorityService.issueAuthority.mockRejectedValueOnce(
      new InconnectMessagingAutoCreateAuthorityException(
        'not ready',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      ),
    );

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'NO_MATCH_NOT_READY',
      publicationRequest: null,
    });
    expect(automationRecordCreateService.execute).not.toHaveBeenCalled();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('rolls back a physical unique race and links after one fresh re-resolution', async () => {
    const {
      service,
      automationRecordCreateService,
      backgroundResolver,
      conversation,
      outboxRepository,
      queryRunner,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    backgroundResolver.resolvePhoneIdentityForLink
      .mockResolvedValueOnce({ state: 'NO_MATCH' })
      .mockResolvedValueOnce({
        state: 'UNIQUE',
        recordId: HUMAN_RECORD_ID,
        objectMetadataId: OBJECT_ID,
      });
    automationRecordCreateService.execute.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), {
        code: 'DUPLICATE_ENTRY_DETECTED',
      }),
    );

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toMatchObject({ state: 'LINKED_EXISTING' });
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(2);
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).toHaveBeenCalledTimes(2);
    expect(automationRecordCreateService.execute).toHaveBeenCalledTimes(1);
    expect(conversation.linkedRecordId).toBe(HUMAN_RECORD_ID);
    expect(outboxRepository.insert).toHaveBeenCalledTimes(1);
  });

  it('terminates a soft-deleted physical uniqueness conflict without a second create', async () => {
    const {
      service,
      automationRecordCreateService,
      backgroundResolver,
      outboxRepository,
      queryRunner,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    automationRecordCreateService.execute.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), {
        code: 'DUPLICATE_ENTRY_DETECTED',
      }),
    );

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({
      state: 'SOFT_DELETED_UNIQUE_CONFLICT',
      publicationRequest: null,
    });
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).toHaveBeenCalledTimes(2);
    expect(automationRecordCreateService.execute).toHaveBeenCalledTimes(1);
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('rolls back create and link work when Outbox persistence fails', async () => {
    const {
      service,
      automationRecordCreateService,
      outboxRepository,
      queryRunner,
    } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
      autoCreateEnabled: true,
    });

    outboxRepository.insert.mockRejectedValueOnce(
      new Error('forced Outbox failure'),
    );

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).rejects.toThrow('forced Outbox failure');
    expect(automationRecordCreateService.execute).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('fails closed on a partial linked tuple before starting a transaction', async () => {
    const { service, workspaceDataSource } = buildService({
      conversationOverrides: {
        linkedRecordObjectMetadataId: OBJECT_ID,
        linkedRecordId: null,
      },
    });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).rejects.toThrow('Messaging Conversation linked tuple is incomplete');
    expect(workspaceDataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('makes a duplicate attempt a no-op with exactly one linked event', async () => {
    const { service, outboxRepository, backgroundResolver } = buildService();

    await service.attemptForInboundMessage({
      workspaceId: WORKSPACE_ID,
      messageId: MESSAGE_ID,
    });
    await service.attemptForInboundMessage({
      workspaceId: WORKSPACE_ID,
      messageId: MESSAGE_ID,
    });

    expect(outboxRepository.insert).toHaveBeenCalledTimes(1);
    expect(
      backgroundResolver.resolvePhoneIdentityForLink,
    ).toHaveBeenCalledTimes(1);
  });
});
