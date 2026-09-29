import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
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
  initialResolution = { state: 'UNIQUE', recordId: RECORD_ID },
  revalidatedResolution = {
    state: 'UNIQUE',
    recordId: RECORD_ID,
    objectMetadataId: OBJECT_ID,
  },
}: {
  conversationOverrides?: Partial<InconnectMessagingConversationEntity>;
  initialResolution?:
    | { state: 'DISABLED' | 'INVALID' | 'NO_MATCH' | 'AMBIGUOUS' }
    | { state: 'UNIQUE'; recordId: string };
  revalidatedResolution?:
    | { state: 'DISABLED' | 'INVALID' | 'NO_MATCH' | 'AMBIGUOUS' }
    | {
        state: 'UNIQUE';
        recordId: string;
        objectMetadataId: string;
      };
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
  const outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === InconnectMessagingConversationEntity) {
        return conversationRepository;
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

      throw new Error('Unexpected repository');
    }),
    transaction: jest
      .fn()
      .mockImplementation(async (callback) => callback(manager)),
  };
  const backgroundResolver = {
    resolvePhoneIdentity: jest.fn().mockResolvedValue(initialResolution),
    resolvePhoneIdentityForLink: jest
      .fn()
      .mockResolvedValue(revalidatedResolution),
  };

  return {
    service: new InconnectMessagingInboundAutoLinkService(
      dataSource as never,
      backgroundResolver as never,
    ),
    backgroundResolver,
    conversation,
    conversationRepository,
    outboxRepository,
    dataSource,
  };
};

describe('InconnectMessagingInboundAutoLinkService', () => {
  it('links a UNIQUE result only after locked transactional revalidation', async () => {
    const {
      service,
      backgroundResolver,
      conversation,
      conversationRepository,
      outboxRepository,
    } = buildService();

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toMatchObject({
      state: 'LINKED',
      publicationRequest: {
        workspaceId: WORKSPACE_ID,
        eventType: 'CONVERSATION_LINKED',
      },
    });

    expect(conversationRepository.findOne).toHaveBeenLastCalledWith({
      where: { id: CONVERSATION_ID, workspaceId: WORKSPACE_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(backgroundResolver.resolvePhoneIdentity).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      input: PHONE_INPUT,
    });
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
    expect(outboxRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONVERSATION_LINKED',
        immutablePayload: {
          conversationId: CONVERSATION_ID,
          actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        },
      }),
    );
  });

  it.each(['DISABLED', 'INVALID', 'NO_MATCH', 'AMBIGUOUS'] as const)(
    'leaves the Conversation UNASSIGNED for %s',
    async (state) => {
      const {
        service,
        conversation,
        dataSource,
        outboxRepository,
        backgroundResolver,
      } = buildService({ initialResolution: { state } });

      await expect(
        service.attemptForInboundMessage({
          workspaceId: WORKSPACE_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toEqual({ state, publicationRequest: null });
      expect(conversation.linkedRecordObjectMetadataId).toBeNull();
      expect(conversation.linkedRecordId).toBeNull();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(
        backgroundResolver.resolvePhoneIdentityForLink,
      ).not.toHaveBeenCalled();
      expect(outboxRepository.insert).not.toHaveBeenCalled();
    },
  );

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
    expect(backgroundResolver.resolvePhoneIdentity).not.toHaveBeenCalled();
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

  it('does not commit an initially UNIQUE target that is stale at revalidation', async () => {
    const { service, conversation, outboxRepository } = buildService({
      revalidatedResolution: { state: 'NO_MATCH' },
    });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({ state: 'NO_MATCH', publicationRequest: null });
    expect(conversation.linkedRecordObjectMetadataId).toBeNull();
    expect(conversation.linkedRecordId).toBeNull();
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });

  it('retries naturally on a later inbound without persisting a negative state', async () => {
    const { service, backgroundResolver, conversation, outboxRepository } =
      buildService();

    backgroundResolver.resolvePhoneIdentity
      .mockResolvedValueOnce({ state: 'NO_MATCH' })
      .mockResolvedValueOnce({ state: 'UNIQUE', recordId: RECORD_ID });

    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toEqual({ state: 'NO_MATCH', publicationRequest: null });
    await expect(
      service.attemptForInboundMessage({
        workspaceId: WORKSPACE_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toMatchObject({ state: 'LINKED' });
    expect(conversation.linkedRecordId).toBe(RECORD_ID);
    expect(outboxRepository.insert).toHaveBeenCalledTimes(1);
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
    expect(backgroundResolver.resolvePhoneIdentity).toHaveBeenCalledTimes(1);
  });
});
