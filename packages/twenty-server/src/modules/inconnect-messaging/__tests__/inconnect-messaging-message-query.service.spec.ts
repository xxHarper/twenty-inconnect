import { decodeInconnectMessagingCursor } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-cursor.util';
import { InconnectMessagingMessageQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-message-query.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const workspaceId = '30303030-1111-4111-8111-111111111111';
const authContext = { workspace: { id: workspaceId } } as never;
const conversationId = '30303030-2222-4222-8222-222222222222';
const displayAt = new Date('2026-09-11T10:00:00.000Z');
const message = {
  id: '30303030-3333-4333-8333-333333333333',
  workspaceId,
  conversationId,
  createdAt: displayAt,
};

class MessageQueryBuilder {
  operations: string[] = [];

  leftJoinAndSelect() {
    return this;
  }

  where(sql: string) {
    this.operations.push(sql);

    return this;
  }

  andWhere(sql: unknown) {
    this.operations.push(String(sql));

    return this;
  }

  clone() {
    return { getCount: jest.fn().mockResolvedValue(1) };
  }

  addSelect() {
    return this;
  }

  orderBy(sql: string) {
    this.operations.push(sql);

    return this;
  }

  addOrderBy(sql: string) {
    this.operations.push(sql);

    return this;
  }

  take() {
    return this;
  }

  getRawAndEntities() {
    return Promise.resolve({
      entities: [message],
      raw: [{ messageCursorId: message.id, messageDisplayAt: displayAt }],
    });
  }
}

describe('InconnectMessagingMessageQueryService', () => {
  it('authorizes the Conversation before querying its Messages', async () => {
    const messageRepository = { createQueryBuilder: jest.fn() };
    const authorizationService = {
      findAuthorizedConversation: jest.fn().mockResolvedValue(null),
    };
    const service = new InconnectMessagingMessageQueryService(
      messageRepository as never,
      authorizationService as never,
    );

    await expect(
      service.getAuthorizedMessagePage({
        authContext,
        conversationId,
        first: 20,
      }),
    ).resolves.toBeNull();
    expect(messageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('scopes by authorized Conversation and workspace before pagination', async () => {
    const queryBuilder = new MessageQueryBuilder();
    const messageRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const authorizationService = {
      findAuthorizedConversation: jest
        .fn()
        .mockResolvedValue({ id: conversationId }),
    };
    const service = new InconnectMessagingMessageQueryService(
      messageRepository as never,
      authorizationService as never,
    );
    const result = await service.getAuthorizedMessagePage({
      authContext,
      conversationId,
      first: 20,
    });

    expect(queryBuilder.operations[0]).toContain('workspaceId');
    expect(queryBuilder.operations[1]).toContain('conversationId');
    expect(result?.totalCount).toBe(1);
  });

  it('uses display timestamp plus Message ID as the cursor tie breaker', async () => {
    const queryBuilder = new MessageQueryBuilder();
    const service = new InconnectMessagingMessageQueryService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as never,
      {
        findAuthorizedConversation: jest
          .fn()
          .mockResolvedValue({ id: conversationId }),
      } as never,
    );
    const result = await service.getAuthorizedMessagePage({
      authContext,
      conversationId,
      first: 20,
    });
    const cursor = decodeInconnectMessagingCursor({
      cursor: result!.edges[0].cursor,
      expectedKind: 'message',
    });

    expect(cursor).toEqual({
      id: message.id,
      kind: 'message',
      sortAt: displayAt,
    });
    expect(queryBuilder.operations).toContain(
      'COALESCE(message.effectiveInboundAt, message.createdAt)',
    );
    expect(queryBuilder.operations).toContain('message.id');
  });
});
