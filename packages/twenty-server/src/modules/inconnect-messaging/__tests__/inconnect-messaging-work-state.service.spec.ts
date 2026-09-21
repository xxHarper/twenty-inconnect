import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingWorkStateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-work-state.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const workspaceId = '30303030-1111-4111-8111-111111111111';
const workspaceMemberId = '30303030-2222-4222-8222-222222222222';
const authContext = {
  type: 'user',
  workspace: { id: workspaceId },
  workspaceMemberId,
  workspaceMember: { id: workspaceMemberId },
} as never;
const conversationId = '30303030-3333-4333-8333-333333333333';
const currentWorkState = {
  conversation: { id: conversationId },
  isFavorite: false,
  isUnread: false,
  isPending: false,
};

const buildService = ({
  authorized = true,
  readMessageFound = true,
  pendingAt = null,
}: {
  authorized?: boolean;
  readMessageFound?: boolean;
  pendingAt?: Date | null;
} = {}) => {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT EXISTS')) {
      return [{ messageFound: readMessageFound }];
    }

    return undefined;
  });
  const conversation = { id: conversationId, pendingAt };
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
    save: jest.fn().mockImplementation(async (value) => value),
  };
  const outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    query,
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === InconnectMessagingConversationEntity)
        return conversationRepository;
      if (entity === InconnectMessagingOutboxEventEntity)
        return outboxRepository;

      throw new Error('Unexpected repository');
    }),
  };
  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(async (callback) => callback(manager)),
  };
  const authorizationService = {
    findAuthorizedConversation: jest
      .fn()
      .mockResolvedValue(authorized ? { id: conversationId } : null),
  };
  const conversationQueryService = {
    getAuthorizedConversation: jest.fn().mockImplementation(async () => ({
      ...currentWorkState,
      isPending: conversation.pendingAt !== null,
    })),
  };
  const outboxService = {
    requestPublication: jest.fn().mockResolvedValue(true),
  };
  const service = new InconnectMessagingWorkStateService(
    dataSource as never,
    authorizationService as never,
    conversationQueryService as never,
    outboxService as never,
  );

  return {
    service,
    query,
    conversationRepository,
    outboxRepository,
    outboxService,
    dataSource,
  };
};

describe('InconnectMessagingWorkStateService', () => {
  it('sets and unsets only the authenticated member favorite idempotently', async () => {
    const { service, query } = buildService();

    await service.setFavorite({ authContext, conversationId, favorite: true });
    await service.setFavorite({ authContext, conversationId, favorite: false });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT'),
      expect.arrayContaining([
        workspaceId,
        conversationId,
        workspaceMemberId,
        true,
      ]),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT'),
      expect.arrayContaining([
        workspaceId,
        conversationId,
        workspaceMemberId,
        false,
      ]),
    );
  });

  it('does not mutate personal state when the Conversation is unauthorized', async () => {
    const { service, dataSource } = buildService({ authorized: false });

    await expect(
      service.markUnread({ authContext, conversationId }),
    ).rejects.toThrow('Conversation not found');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('marks unread without destroying the durable read cursor', async () => {
    const { service, query } = buildService();

    await service.markUnread({ authContext, conversationId });

    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain('"manualUnread" = true');
    expect(sql).not.toContain('"lastReadMessageCreatedAt" =');
  });

  it('validates an explicit read cursor as an inbound Message in the same Conversation', async () => {
    const messageId = '30303030-4444-4444-8444-444444444444';
    const { service, query } = buildService();

    await service.markRead({
      authContext,
      conversationId,
      throughMessageId: messageId,
    });

    const [sql, parameters] = query.mock.calls[0] ?? [];

    expect(String(sql)).toContain('message."direction" = \'INBOUND\'');
    expect(String(sql)).toContain('message."id" = $5::uuid');
    expect(parameters).toEqual(
      expect.arrayContaining([
        workspaceId,
        conversationId,
        workspaceMemberId,
        messageId,
      ]),
    );
    expect(parameters).not.toEqual(expect.arrayContaining([expect.any(Date)]));
  });

  it('uses an atomic tuple comparison so stale mark-read cannot regress the cursor', async () => {
    const { service, query } = buildService();

    await service.markRead({ authContext, conversationId });

    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain(
      '(EXCLUDED."lastReadMessageCreatedAt", EXCLUDED."lastReadMessageId") >',
    );
    expect(sql).toContain(
      'ORDER BY message."createdAt" DESC, message."id" DESC',
    );
    expect(sql).toContain(
      'SELECT $1, $2, $3, $4, false, "selectedMessage"."createdAt", "selectedMessage"."id"',
    );
    expect(sql).toContain('"manualUnread" = false');
  });

  it('clears manual unread without fabricating a cursor when no inbound exists', async () => {
    const { service, query } = buildService({ readMessageFound: false });

    await service.markRead({ authContext, conversationId });

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).not.toContain(
      '"lastReadMessageCreatedAt"',
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      'DO UPDATE SET "manualUnread" = false',
    );
  });

  it('rejects an explicit Message outside the authorized inbound history', async () => {
    const { service, query } = buildService({ readMessageFound: false });

    await expect(
      service.markRead({
        authContext,
        conversationId,
        throughMessageId: '30303030-5555-4555-8555-555555555555',
      }),
    ).rejects.toThrow('Message not found');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('persists shared Pending and its OutboxEvent in one transaction', async () => {
    const { service, conversationRepository, outboxRepository, outboxService } =
      buildService();

    await service.setPending({ authContext, conversationId, pending: true });

    expect(conversationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ pendingAt: expect.any(Date) }),
    );
    expect(outboxRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'CONVERSATION',
        aggregateId: conversationId,
        eventType: 'CONVERSATION_PENDING_CHANGED',
        immutablePayload: { conversationId },
      }),
    );
    expect(outboxService.requestPublication).toHaveBeenCalledTimes(1);
  });

  it('does not create another event for an idempotent Pending mutation', async () => {
    const { service, outboxRepository, outboxService } = buildService({
      pendingAt: new Date('2026-09-18T10:00:00.000Z'),
    });

    await service.setPending({ authContext, conversationId, pending: true });

    expect(outboxRepository.insert).not.toHaveBeenCalled();
    expect(outboxService.requestPublication).not.toHaveBeenCalled();
  });
});
