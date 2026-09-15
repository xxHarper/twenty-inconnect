import { type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingSendService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const clientRequestId = '33333333-3333-4333-8333-333333333333';
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
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
  const dataSource = {
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
    resolve: jest.fn().mockReturnValue({ capabilities: ['DISPATCH_FREEFORM'] }),
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
  const service = new InconnectMessagingSendService(
    dataSource as never,
    authorizationService as never,
    providerRegistry as never,
    dispatchService as never,
    outboxService as never,
  );

  return {
    service,
    dataSource,
    authorizationService,
    conversationRepository,
    messageRepository,
    attemptRepository,
    outboxRepository,
    dispatchService,
    outboxService,
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
});
