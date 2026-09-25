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

const delayedInboundMessage = {
  ...message,
  id: '30303030-4444-4444-8444-444444444444',
  createdAt: new Date('2026-09-11T11:00:00.000Z'),
  effectiveInboundAt: new Date('2026-09-10T09:00:00.000Z'),
};

class MessageQueryBuilder {
  operations: string[] = [];
  selections: Array<{ alias: string | undefined; sql: string }> = [];
  orderings: string[] = [];

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

  addSelect(sql: string, alias?: string) {
    this.operations.push(sql);
    this.selections.push({ alias, sql });

    return this;
  }

  orderBy(sql: string) {
    this.operations.push(sql);
    this.orderings.push(sql);

    return this;
  }

  addOrderBy(sql: string) {
    this.operations.push(sql);
    this.orderings.push(sql);

    return this;
  }

  take() {
    return this;
  }

  getRawAndEntities() {
    return Promise.resolve({
      entities: [message],
      raw: [
        {
          message_id: message.id,
          message_display_at: displayAt,
          messageReadThroughTargetId: message.id,
        },
      ],
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
    expect(result?.readThroughMessageId).toBe(message.id);
  });

  it('keeps provider/effective display chronology independent from arrival-based unread', async () => {
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
    expect(queryBuilder.selections).toContainEqual({
      alias: 'message_display_at',
      sql: 'COALESCE("message"."effectiveInboundAt", "message"."createdAt")',
    });
    expect(queryBuilder.orderings).toEqual([
      'message_display_at',
      'message.id',
      'attachment.ordinal',
    ]);
  });

  it('does not expose the arrival target until that inbound Message is in the authorized page', async () => {
    const queryBuilder = new MessageQueryBuilder();

    queryBuilder.getRawAndEntities = () =>
      Promise.resolve({
        entities: [message],
        raw: [
          {
            message_id: message.id,
            message_display_at: displayAt,
            messageReadThroughTargetId: delayedInboundMessage.id,
          },
        ],
      });

    const service = new InconnectMessagingMessageQueryService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as never,
      {
        findAuthorizedConversation: jest
          .fn()
          .mockResolvedValue({ id: conversationId }),
      } as never,
    );

    await expect(
      service.getAuthorizedMessagePage({
        authContext,
        conversationId,
        first: 20,
      }),
    ).resolves.toMatchObject({ readThroughMessageId: null });

    expect(queryBuilder.operations.join(' ')).not.toContain(
      'effectiveInboundAt DESC',
    );
    expect(queryBuilder.operations.join(' ')).toContain(
      '"readTarget"."createdAt" DESC',
    );
    expect(queryBuilder.operations.join(' ')).toContain(
      '"readTarget"."id" DESC',
    );
    expect(queryBuilder.operations.join(' ')).toContain(
      '"readTarget"."direction" = \'INBOUND\'',
    );
  });

  it('does not expose an arrival target that is only the pagination lookahead row', async () => {
    const queryBuilder = new MessageQueryBuilder();

    queryBuilder.getRawAndEntities = () =>
      Promise.resolve({
        entities: [message, delayedInboundMessage],
        raw: [
          {
            message_id: message.id,
            message_display_at: displayAt,
            messageReadThroughTargetId: delayedInboundMessage.id,
          },
          {
            message_id: delayedInboundMessage.id,
            message_display_at: delayedInboundMessage.effectiveInboundAt,
            messageReadThroughTargetId: delayedInboundMessage.id,
          },
        ],
      });

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
      first: 1,
    });

    expect(result?.edges.map(({ node }) => node.id)).toEqual([message.id]);
    expect(result?.readThroughMessageId).toBeNull();
  });

  it('uses the server arrival target when a delayed inbound is present in the page', async () => {
    const queryBuilder = new MessageQueryBuilder();

    queryBuilder.getRawAndEntities = () =>
      Promise.resolve({
        entities: [message, delayedInboundMessage],
        raw: [
          {
            message_id: message.id,
            message_display_at: displayAt,
            messageReadThroughTargetId: delayedInboundMessage.id,
          },
          {
            message_id: delayedInboundMessage.id,
            message_display_at: delayedInboundMessage.effectiveInboundAt,
            messageReadThroughTargetId: delayedInboundMessage.id,
          },
        ],
      });

    const service = new InconnectMessagingMessageQueryService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as never,
      {
        findAuthorizedConversation: jest
          .fn()
          .mockResolvedValue({ id: conversationId }),
      } as never,
    );

    await expect(
      service.getAuthorizedMessagePage({
        authContext,
        conversationId,
        first: 20,
      }),
    ).resolves.toMatchObject({
      readThroughMessageId: delayedInboundMessage.id,
    });
  });
});
