import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { Brackets, type SelectQueryBuilder } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { InconnectMessagingConversationWorkStateFilter } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-work-state.dto';
import { InconnectMessagingConversationMemberStateEntity } from 'src/modules/inconnect-messaging/entities/conversation-member-state.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  decodeInconnectMessagingCursor,
  encodeInconnectMessagingCursor,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-cursor.util';

const IS_FAVORITE_SQL = 'COALESCE(memberState.favorite, false)';
const IS_PENDING_SQL = 'conversation."pendingAt" IS NOT NULL';
// Unread follows server arrival, deliberately independent from the
// effective/provider timestamp used to order the visible message history.
const IS_UNREAD_SQL = `(
  COALESCE(memberState."manualUnread", false)
  OR EXISTS (
    SELECT 1
    FROM "core"."inconnectMessagingMessage" unreadMessage
    WHERE unreadMessage."workspaceId" = conversation."workspaceId"
      AND unreadMessage."conversationId" = conversation.id
      AND unreadMessage.direction = 'INBOUND'
      AND (
        (
          memberState."lastReadMessageCreatedAt" IS NOT NULL
          AND (
            unreadMessage."createdAt" > memberState."lastReadMessageCreatedAt"
            OR (
              unreadMessage."createdAt" = memberState."lastReadMessageCreatedAt"
              AND unreadMessage.id > memberState."lastReadMessageId"
            )
          )
        )
        OR (
          memberState."lastReadMessageCreatedAt" IS NULL
          AND messagingConfiguration."workStateTrackingBaselineAt" IS NOT NULL
          AND unreadMessage."createdAt" > messagingConfiguration."workStateTrackingBaselineAt"
        )
      )
  )
)`;

export type InconnectMessagingConversationWithWorkState = {
  conversation: InconnectMessagingConversationEntity;
  isFavorite: boolean;
  isUnread: boolean;
  isPending: boolean;
};

export type InconnectMessagingConversationPage = {
  items: InconnectMessagingConversationWithWorkState[];
  total: number;
};

export type InconnectMessagingConversationCursorPage = {
  edges: Array<{
    cursor: string;
    node: InconnectMessagingConversationWithWorkState;
  }>;
  hasNextPage: boolean;
  totalCount: number;
};

@Injectable()
export class InconnectMessagingConversationQueryService {
  constructor(
    @InjectWorkspaceScopedRepository(InconnectMessagingConversationEntity)
    private readonly conversationRepository: WorkspaceScopedRepository<InconnectMessagingConversationEntity>,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  async listAuthorizedConversations({
    authContext,
    workState = InconnectMessagingConversationWorkStateFilter.ALL,
    offset = 0,
    limit = 50,
  }: {
    authContext: WorkspaceAuthContext;
    workState?: InconnectMessagingConversationWorkStateFilter;
    offset?: number;
    limit?: number;
  }): Promise<InconnectMessagingConversationPage> {
    return this.executeScopedPage({ authContext, workState, offset, limit });
  }

  async searchAuthorizedConversations({
    authContext,
    search,
    workState = InconnectMessagingConversationWorkStateFilter.ALL,
    offset = 0,
    limit = 50,
  }: {
    authContext: WorkspaceAuthContext;
    search: string;
    workState?: InconnectMessagingConversationWorkStateFilter;
    offset?: number;
    limit?: number;
  }): Promise<InconnectMessagingConversationPage> {
    return this.executeScopedPage({
      authContext,
      search,
      workState,
      offset,
      limit,
    });
  }

  async countAuthorizedConversations({
    authContext,
    search,
    workState = InconnectMessagingConversationWorkStateFilter.ALL,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    workState?: InconnectMessagingConversationWorkStateFilter;
  }): Promise<number> {
    const queryBuilder = await this.buildScopedQuery({
      authContext,
      search,
      workState,
    });

    return queryBuilder.getCount();
  }

  async getAuthorizedConversation({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationWithWorkState | null> {
    const queryBuilder = await this.buildScopedQuery({
      authContext,
      workState: InconnectMessagingConversationWorkStateFilter.ALL,
    });

    queryBuilder.andWhere('conversation.id = :directConversationId', {
      directConversationId: conversationId,
    });
    const rows = await this.getRows(queryBuilder.take(1));

    return rows[0] ?? null;
  }

  async getAuthorizedConversationPage({
    authContext,
    search,
    workState = InconnectMessagingConversationWorkStateFilter.ALL,
    first,
    after,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    workState?: InconnectMessagingConversationWorkStateFilter;
    first: number;
    after?: string;
  }): Promise<InconnectMessagingConversationCursorPage> {
    const queryBuilder = await this.buildScopedQuery({
      authContext,
      search,
      workState,
    });
    const totalCount = await queryBuilder.clone().getCount();

    if (after !== undefined) {
      const cursor = decodeInconnectMessagingCursor({
        cursor: after,
        expectedKind: 'conversation',
      });

      queryBuilder.andWhere(
        new Brackets((cursorQueryBuilder) => {
          cursorQueryBuilder
            .where('conversation.updatedAt < :conversationCursorSortAt', {
              conversationCursorSortAt: cursor.sortAt,
            })
            .orWhere(
              'conversation.updatedAt = :conversationCursorSortAt AND conversation.id < :conversationCursorId',
              {
                conversationCursorSortAt: cursor.sortAt,
                conversationCursorId: cursor.id,
              },
            );
        }),
      );
    }

    const rows = await this.getRows(
      queryBuilder
        .orderBy('conversation.updatedAt', 'DESC')
        .addOrderBy('conversation.id', 'DESC')
        .take(first + 1),
    );
    const hasNextPage = rows.length > first;
    const items = hasNextPage ? rows.slice(0, first) : rows;

    return {
      edges: items.map((node) => ({
        node,
        cursor: encodeInconnectMessagingCursor({
          id: node.conversation.id,
          kind: 'conversation',
          sortAt: node.conversation.updatedAt,
        }),
      })),
      hasNextPage,
      totalCount,
    };
  }

  private async executeScopedPage({
    authContext,
    search,
    workState,
    offset,
    limit,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    workState: InconnectMessagingConversationWorkStateFilter;
    offset: number;
    limit: number;
  }): Promise<InconnectMessagingConversationPage> {
    const queryBuilder = await this.buildScopedQuery({
      authContext,
      search,
      workState,
    });
    const total = await queryBuilder.clone().getCount();
    const items = await this.getRows(
      queryBuilder
        .orderBy('conversation.updatedAt', 'DESC')
        .addOrderBy('conversation.id', 'DESC')
        .skip(Math.max(0, offset))
        .take(Math.min(100, Math.max(1, limit))),
    );

    return { items, total };
  }

  private async buildScopedQuery({
    authContext,
    search,
    workState,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    workState: InconnectMessagingConversationWorkStateFilter;
  }): Promise<SelectQueryBuilder<InconnectMessagingConversationEntity>> {
    const queryBuilder =
      this.conversationRepository.createQueryBuilder('conversation');

    await this.authorizationService.applyConversationReadScope({
      authContext,
      queryBuilder,
      conversationAlias: 'conversation',
    });

    if (!isUserAuthContext(authContext)) {
      queryBuilder.andWhere('1 = 0');

      return queryBuilder;
    }

    queryBuilder
      .leftJoin(
        InconnectMessagingConversationMemberStateEntity,
        'memberState',
        'memberState.workspaceId = conversation.workspaceId AND memberState.conversationId = conversation.id AND memberState.workspaceMemberId = :workStateWorkspaceMemberId',
        { workStateWorkspaceMemberId: authContext.workspaceMemberId },
      )
      .leftJoin(
        InconnectMessagingConfigurationEntity,
        'messagingConfiguration',
        'messagingConfiguration.workspaceId = conversation.workspaceId',
      )
      .addSelect('conversation.id', 'workStateConversationId')
      .addSelect(IS_FAVORITE_SQL, 'workStateIsFavorite')
      .addSelect(IS_UNREAD_SQL, 'workStateIsUnread')
      .addSelect(IS_PENDING_SQL, 'workStateIsPending');

    if (isNonEmptyString(search)) {
      queryBuilder.andWhere(
        'conversation.externalAddressNormalized ILIKE :inconnectMessagingSearch',
        { inconnectMessagingSearch: `%${search}%` },
      );
    }

    if (workState === InconnectMessagingConversationWorkStateFilter.UNREAD) {
      queryBuilder.andWhere(IS_UNREAD_SQL);
    } else if (
      workState === InconnectMessagingConversationWorkStateFilter.FAVORITES
    ) {
      queryBuilder.andWhere(IS_FAVORITE_SQL);
    } else if (
      workState === InconnectMessagingConversationWorkStateFilter.PENDING
    ) {
      queryBuilder.andWhere(IS_PENDING_SQL);
    }

    return queryBuilder;
  }

  private async getRows(
    queryBuilder: SelectQueryBuilder<InconnectMessagingConversationEntity>,
  ): Promise<InconnectMessagingConversationWithWorkState[]> {
    const { entities, raw } = await queryBuilder.getRawAndEntities();
    const workStateByConversationId = new Map(
      raw.map((row: Record<string, unknown>) => [
        String(row.workStateConversationId),
        {
          isFavorite: row.workStateIsFavorite === true,
          isUnread: row.workStateIsUnread === true,
          isPending: row.workStateIsPending === true,
        },
      ]),
    );

    return entities.map((conversation) => ({
      conversation,
      ...(workStateByConversationId.get(conversation.id) ?? {
        isFavorite: false,
        isUnread: false,
        isPending: conversation.pendingAt !== null,
      }),
    }));
  }
}
