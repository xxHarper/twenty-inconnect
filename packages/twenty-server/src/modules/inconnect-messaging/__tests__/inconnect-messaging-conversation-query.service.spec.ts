import { DataSource, EntitySchema } from 'typeorm';

import { InconnectMessagingConversationWorkStateFilter } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-work-state.dto';
import { InconnectMessagingConversationMemberStateEntity } from 'src/modules/inconnect-messaging/entities/conversation-member-state.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import { InconnectMessagingReadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-read.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

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
  pendingAt: null,
  updatedAt: new Date('2026-09-18T10:00:00.000Z'),
} as InconnectMessagingConversationEntity;
const deniedConversation = {
  id: 'denied-conversation',
  externalAddressNormalized: 'secret-denied-address',
  pendingAt: null,
  updatedAt: new Date('2026-09-18T09:00:00.000Z'),
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

  leftJoin(
    _entity: unknown,
    _alias: string,
    condition: string,
    parameters?: Record<string, unknown>,
  ) {
    this.operations.push(
      `${condition}:${String(parameters?.workStateWorkspaceMemberId ?? '')}`,
    );

    return this;
  }

  addSelect(selection: string) {
    this.operations.push(selection);

    return this;
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

  async getRawAndEntities() {
    const entities = this.rows.slice(this.offset, this.offset + this.limit);

    return {
      entities,
      raw: entities.map(({ id }) => ({
        workStateIsFavorite: id === allowedConversation.id,
        workStateIsUnread: id === allowedConversation.id,
        workStateIsPending: false,
      })),
    };
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

const buildTypeOrmService = async () => {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [
      new EntitySchema<InconnectMessagingConversationEntity>({
        name: 'InconnectMessagingConversationEntity',
        target: InconnectMessagingConversationEntity,
        schema: 'core',
        tableName: 'inconnectMessagingConversation',
        columns: {
          id: { primary: true, type: 'uuid' },
          workspaceId: { type: 'uuid' },
          updatedAt: { type: 'timestamptz' },
        },
      }),
      new EntitySchema<InconnectMessagingConversationMemberStateEntity>({
        name: 'InconnectMessagingConversationMemberStateEntity',
        target: InconnectMessagingConversationMemberStateEntity,
        schema: 'core',
        tableName: 'inconnectMessagingConversationMemberState',
        columns: {
          id: { primary: true, type: 'uuid' },
          workspaceId: { type: 'uuid' },
          conversationId: { type: 'uuid' },
          workspaceMemberId: { type: 'uuid' },
          favorite: { type: 'boolean' },
          lastReadMessageCreatedAt: { nullable: true, type: 'timestamptz' },
          lastReadMessageId: { nullable: true, type: 'uuid' },
          manualUnread: { type: 'boolean' },
        },
      }),
      new EntitySchema<InconnectMessagingConfigurationEntity>({
        name: 'InconnectMessagingConfigurationEntity',
        target: InconnectMessagingConfigurationEntity,
        schema: 'core',
        tableName: 'inconnectMessagingConfiguration',
        columns: {
          workspaceId: { primary: true, type: 'uuid' },
          workStateTrackingBaselineAt: { type: 'timestamptz' },
        },
      }),
    ],
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  const executedSql: string[] = [];
  const queryRunner = dataSource.createQueryRunner();

  queryRunner.query = jest.fn(async (sql: string) => {
    executedSql.push(sql);

    return {
      records: sql.includes('COUNT(') ? [{ cnt: '0' }] : [],
      affected: 0,
      raw: [],
    };
  }) as never;

  const conversationRepository = {
    createQueryBuilder: jest.fn((alias: string) =>
      dataSource
        .getRepository(InconnectMessagingConversationEntity)
        .createQueryBuilder(alias)
        .setQueryRunner(queryRunner),
    ),
  };
  const authorizationService = {
    applyConversationReadScope: jest.fn(
      async ({
        queryBuilder,
      }: {
        queryBuilder: {
          andWhere: (
            sql: string,
            parameters?: Record<string, unknown>,
          ) => unknown;
        };
      }) => {
        queryBuilder.andWhere('conversation.workspaceId = :workspaceId', {
          workspaceId: 'workspace-id',
        });
      },
    ),
  };
  const conversationQueryService =
    new InconnectMessagingConversationQueryService(
      conversationRepository as never,
      authorizationService as never,
    );
  const readService = new InconnectMessagingReadService(
    authorizationService as never,
    conversationQueryService,
    {} as never,
  );

  return { executedSql, readService };
};

describe('InconnectMessagingConversationQueryService', () => {
  it('preserves the canonical primary alias in the DISTINCT pagination query', async () => {
    const { executedSql, readService } = await buildTypeOrmService();

    await expect(
      readService.getConversations({ authContext, first: 30 }),
    ).resolves.toEqual({
      edges: [],
      totalCount: 0,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    });

    const distinctPaginationSql = executedSql.find(
      (sql) => sql.includes('SELECT DISTINCT') && sql.includes('distinctAlias'),
    );

    expect(distinctPaginationSql).toBeDefined();
    expect(distinctPaginationSql).toContain(
      '"distinctAlias"."conversation_id"',
    );
    expect(distinctPaginationSql).toContain(
      '"conversation"."id" AS "conversation_id"',
    );
    expect(distinctPaginationSql).toContain(
      'LEFT JOIN "core"."inconnectMessagingConversationMemberState" "memberState"',
    );
    expect(distinctPaginationSql).toContain(
      'LEFT JOIN "core"."inconnectMessagingConfiguration" "messagingConfiguration"',
    );
    expect(distinctPaginationSql).toContain(
      'COALESCE("memberState"."manualUnread", false)',
    );
    expect(distinctPaginationSql).toContain(
      '"memberState"."lastReadMessageCreatedAt"',
    );
    expect(distinctPaginationSql).toContain(
      '"memberState"."lastReadMessageId"',
    );
    expect(distinctPaginationSql).toContain(
      '"messagingConfiguration"."workStateTrackingBaselineAt"',
    );
    expect(distinctPaginationSql).not.toMatch(/(^|[^"])memberState\."/);
    expect(distinctPaginationSql).not.toMatch(
      /(^|[^"])messagingConfiguration\."/,
    );
  });

  it('scopes list and count before ordering and pagination', async () => {
    const { service, operations } = buildService();
    const result = await service.listAuthorizedConversations({
      authContext,
      offset: 0,
      limit: 1,
    });

    expect(result.items.map(({ conversation }) => conversation)).toEqual([
      allowedConversation,
    ]);
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

    expect(result.items.map(({ conversation }) => conversation.id)).toEqual([
      allowedConversation.id,
    ]);
    expect(
      result.items.map(({ conversation }) => conversation),
    ).not.toContainEqual(deniedConversation);
  });

  it('maps raw work-state projections onto the hydrated Conversation', async () => {
    const { service } = buildService();
    const result = await service.listAuthorizedConversations({ authContext });

    expect(result.items[0]).toEqual({
      conversation: allowedConversation,
      isFavorite: true,
      isUnread: true,
      isPending: false,
    });
  });

  it.each([
    InconnectMessagingConversationWorkStateFilter.UNREAD,
    InconnectMessagingConversationWorkStateFilter.FAVORITES,
    InconnectMessagingConversationWorkStateFilter.PENDING,
  ])('applies %s in SQL before count and pagination', async (workState) => {
    const { service, operations } = buildService();

    await service.listAuthorizedConversations({
      authContext,
      workState,
      offset: 0,
      limit: 1,
    });

    const statePredicateIndex = operations.findIndex(
      (operation) =>
        operation.includes('manualUnread') ||
        operation.includes('memberState.favorite') ||
        operation.includes('pendingAt'),
    );

    expect(statePredicateIndex).toBeGreaterThan(-1);
    expect(statePredicateIndex).toBeLessThan(
      operations.indexOf('PAGINATION_LIMIT'),
    );
  });

  it('derives unread from inbound insertion order and the rollout baseline for the current member', async () => {
    const { service, operations } = buildService();

    await service.listAuthorizedConversations({ authContext });

    const sql = operations.join('\n');

    expect(sql).toContain("unreadMessage.direction = 'INBOUND'");
    expect(sql).toContain('unreadMessage."createdAt"');
    expect(sql).toContain(
      'unreadMessage.id > "memberState"."lastReadMessageId"',
    );
    expect(sql).toContain('workStateTrackingBaselineAt');
    expect(sql).toContain('workspace-member-id');
    expect(sql).not.toContain('effectiveInboundAt');
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
