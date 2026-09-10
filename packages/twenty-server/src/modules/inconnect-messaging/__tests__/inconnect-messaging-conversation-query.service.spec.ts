import { type InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id', databaseSchema: 'workspace_test' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: 'workspace-member-id',
  workspaceMember: { id: 'workspace-member-id' },
  user: { id: 'user-id' },
} as never;

const allowedConversation = {
  id: 'allowed-conversation',
  externalAddressNormalized: 'allowed-address',
} as InconnectMessagingConversationEntity;
const deniedConversation = {
  id: 'denied-conversation',
  externalAddressNormalized: 'secret-denied-address',
} as InconnectMessagingConversationEntity;

class ScopedConversationQueryBuilder {
  rows: InconnectMessagingConversationEntity[];
  offset = 0;
  limit = Number.POSITIVE_INFINITY;

  constructor(
    rows: InconnectMessagingConversationEntity[],
    private readonly operations: string[],
  ) {
    this.rows = rows;
  }

  andWhere(sql: string, parameters?: Record<string, unknown>) {
    this.operations.push(sql);

    if (sql === 'AUTHORIZED_CONVERSATION_SCOPE') {
      this.rows = this.rows.filter(
        (conversation) => conversation.id === allowedConversation.id,
      );
    }

    if (typeof parameters?.inconnectMessagingSearch === 'string') {
      const search = parameters.inconnectMessagingSearch.replace(/%/g, '');

      this.rows = this.rows.filter((conversation) =>
        conversation.externalAddressNormalized.includes(search),
      );
    }

    return this;
  }

  clone() {
    return new ScopedConversationQueryBuilder([...this.rows], this.operations);
  }

  orderBy() {
    this.operations.push('ORDER');

    return this;
  }

  addOrderBy() {
    this.operations.push('ORDER_TIE_BREAKER');

    return this;
  }

  skip(offset: number) {
    this.operations.push('PAGINATION_OFFSET');
    this.offset = offset;

    return this;
  }

  take(limit: number) {
    this.operations.push('PAGINATION_LIMIT');
    this.limit = limit;

    return this;
  }

  async getMany() {
    return this.rows.slice(this.offset, this.offset + this.limit);
  }

  async getCount() {
    return this.rows.length;
  }
}

const buildService = () => {
  const operations: string[] = [];
  const conversationRepository = {
    createQueryBuilder: jest.fn(
      () =>
        new ScopedConversationQueryBuilder(
          [allowedConversation, deniedConversation],
          operations,
        ),
    ),
  };
  const authorizationService = {
    applyConversationReadScope: jest.fn(
      async ({
        queryBuilder,
      }: {
        queryBuilder: ScopedConversationQueryBuilder;
      }) => {
        queryBuilder.andWhere('AUTHORIZED_CONVERSATION_SCOPE');
      },
    ),
  };
  const service = new InconnectMessagingConversationQueryService(
    conversationRepository as never,
    authorizationService as never,
  );

  return { service, operations };
};

describe('InconnectMessagingConversationQueryService', () => {
  it('scopes list and count before ordering and pagination', async () => {
    const { service, operations } = buildService();
    const result = await service.listAuthorizedConversations({
      authContext,
      offset: 0,
      limit: 1,
    });

    expect(result.items).toEqual([allowedConversation]);
    expect(result.total).toBe(1);
    expect(operations.indexOf('AUTHORIZED_CONVERSATION_SCOPE')).toBeLessThan(
      operations.indexOf('ORDER'),
    );
    expect(operations.indexOf('AUTHORIZED_CONVERSATION_SCOPE')).toBeLessThan(
      operations.indexOf('PAGINATION_LIMIT'),
    );
  });

  it('returns an authorization-scoped count without leaking the denied row', async () => {
    const { service } = buildService();

    await expect(
      service.countAuthorizedConversations({ authContext }),
    ).resolves.toBe(1);
  });

  it('does not let a denied row consume a pagination slot', async () => {
    const { service } = buildService();
    const result = await service.listAuthorizedConversations({
      authContext,
      offset: 0,
      limit: 1,
    });

    expect(result.items.map(({ id }) => id)).toEqual([allowedConversation.id]);
    expect(result.items).not.toContainEqual(deniedConversation);
  });

  it('applies search after authorization so data unique to a denied row returns empty', async () => {
    const { service, operations } = buildService();
    const result = await service.searchAuthorizedConversations({
      authContext,
      search: 'secret-denied-address',
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(operations.indexOf('AUTHORIZED_CONVERSATION_SCOPE')).toBeLessThan(
      operations.findIndex((operation) => operation.includes('ILIKE')),
    );
  });
});
