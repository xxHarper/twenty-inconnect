import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { DataSource, type EntityManager } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { NotFoundError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { type InconnectMessagingConversationWorkStateDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-work-state.dto';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

@Injectable()
export class InconnectMessagingWorkStateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly conversationQueryService: InconnectMessagingConversationQueryService,
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  async setFavorite({
    authContext,
    conversationId,
    favorite,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    favorite: boolean;
  }): Promise<InconnectMessagingConversationWorkStateDTO> {
    const workspaceMemberId = await this.authorizeCurrentMember({
      authContext,
      conversationId,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO "core"."inconnectMessagingConversationMemberState"
            ("id", "workspaceId", "conversationId", "workspaceMemberId", "favorite", "manualUnread", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("workspaceId", "conversationId", "workspaceMemberId")
          DO UPDATE SET "favorite" = EXCLUDED."favorite", "updatedAt" = CURRENT_TIMESTAMP
        `,
        [
          randomUUID(),
          authContext.workspace.id,
          conversationId,
          workspaceMemberId,
          favorite,
        ],
      );
    });

    return this.getCurrentWorkState({ authContext, conversationId });
  }

  async markUnread({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationWorkStateDTO> {
    const workspaceMemberId = await this.authorizeCurrentMember({
      authContext,
      conversationId,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO "core"."inconnectMessagingConversationMemberState"
            ("id", "workspaceId", "conversationId", "workspaceMemberId", "favorite", "manualUnread", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("workspaceId", "conversationId", "workspaceMemberId")
          DO UPDATE SET "manualUnread" = true, "updatedAt" = CURRENT_TIMESTAMP
        `,
        [
          randomUUID(),
          authContext.workspace.id,
          conversationId,
          workspaceMemberId,
        ],
      );
    });

    return this.getCurrentWorkState({ authContext, conversationId });
  }

  async markRead({
    authContext,
    conversationId,
    throughMessageId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    throughMessageId?: string;
  }): Promise<InconnectMessagingConversationWorkStateDTO> {
    const workspaceMemberId = await this.authorizeCurrentMember({
      authContext,
      conversationId,
    });

    await this.dataSource.transaction(async (manager) => {
      const messageFound = await this.upsertReadCursorFromMessage({
        manager,
        workspaceId: authContext.workspace.id,
        conversationId,
        workspaceMemberId,
        throughMessageId,
      });

      if (throughMessageId !== undefined && !messageFound) {
        throw new NotFoundError('Message not found');
      }

      if (throughMessageId === undefined && !messageFound) {
        await this.clearManualUnreadWithoutCursor({
          manager,
          workspaceId: authContext.workspace.id,
          conversationId,
          workspaceMemberId,
        });
      }
    });

    return this.getCurrentWorkState({ authContext, conversationId });
  }

  async setPending({
    authContext,
    conversationId,
    pending,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    pending: boolean;
  }): Promise<InconnectMessagingConversationWorkStateDTO> {
    await this.authorizeCurrentMember({ authContext, conversationId });
    const publicationRequest = await this.dataSource.transaction(
      async (
        manager,
      ): Promise<InconnectMessagingOutboxPublicationRequest | null> => {
        const conversationRepository = manager.getRepository(
          InconnectMessagingConversationEntity,
        );
        const conversation = await conversationRepository.findOne({
          where: { id: conversationId, workspaceId: authContext.workspace.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (conversation === null) {
          throw new NotFoundError('Conversation not found');
        }

        if ((conversation.pendingAt !== null) === pending) {
          return null;
        }

        conversation.pendingAt = pending ? new Date() : null;
        await conversationRepository.save(conversation);

        const eventId = randomUUID();

        await manager
          .getRepository(InconnectMessagingOutboxEventEntity)
          .insert({
            id: eventId,
            workspaceId: authContext.workspace.id,
            aggregateType: 'CONVERSATION',
            aggregateId: conversation.id,
            eventType: 'CONVERSATION_PENDING_CHANGED',
            immutablePayload: { conversationId: conversation.id },
            deduplicationKey: `inconnect-messaging:conversation-pending:${eventId}`,
            availableAt: new Date(),
            processingState: 'PENDING',
            leaseToken: null,
            leaseExpiresAt: null,
            attemptCount: 0,
            error: null,
            publishedAt: null,
          });

        return {
          id: eventId,
          workspaceId: authContext.workspace.id,
          eventType: 'CONVERSATION_PENDING_CHANGED',
        };
      },
    );

    if (publicationRequest !== null) {
      await this.outboxService.requestPublication(publicationRequest);
    }

    return this.getCurrentWorkState({ authContext, conversationId });
  }

  private async authorizeCurrentMember({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<string> {
    if (
      !isUserAuthContext(authContext) ||
      authContext.workspaceMember.id !== authContext.workspaceMemberId ||
      (await this.authorizationService.findAuthorizedConversation({
        authContext,
        conversationId,
      })) === null
    ) {
      throw new NotFoundError('Conversation not found');
    }

    return authContext.workspaceMemberId;
  }

  private async upsertReadCursorFromMessage({
    manager,
    workspaceId,
    conversationId,
    workspaceMemberId,
    throughMessageId,
  }: {
    manager: EntityManager;
    workspaceId: string;
    conversationId: string;
    workspaceMemberId: string;
    throughMessageId?: string;
  }): Promise<boolean> {
    // Read state follows server arrival order, not the provider/effective time
    // used for display. Keeping SELECT and INSERT in one SQL statement also
    // preserves PostgreSQL microseconds that JavaScript Date cannot represent.
    const [result] = await manager.query<Array<{ messageFound: boolean }>>(
      `
        WITH "selectedMessage" AS MATERIALIZED (
          SELECT message."createdAt", message."id"
          FROM "core"."inconnectMessagingMessage" message
          WHERE message."workspaceId" = $2
            AND message."conversationId" = $3
            AND message."direction" = 'INBOUND'
            AND ($5::uuid IS NULL OR message."id" = $5::uuid)
          ORDER BY message."createdAt" DESC, message."id" DESC
          LIMIT 1
        ),
        "upsertedState" AS (
          INSERT INTO "core"."inconnectMessagingConversationMemberState"
            ("id", "workspaceId", "conversationId", "workspaceMemberId", "favorite", "lastReadMessageCreatedAt", "lastReadMessageId", "manualUnread", "createdAt", "updatedAt")
          SELECT $1, $2, $3, $4, false, "selectedMessage"."createdAt", "selectedMessage"."id", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM "selectedMessage"
          ON CONFLICT ("workspaceId", "conversationId", "workspaceMemberId")
          DO UPDATE SET
            "lastReadMessageCreatedAt" = CASE
              WHEN "inconnectMessagingConversationMemberState"."lastReadMessageCreatedAt" IS NULL
                OR (EXCLUDED."lastReadMessageCreatedAt", EXCLUDED."lastReadMessageId") >
                   ("inconnectMessagingConversationMemberState"."lastReadMessageCreatedAt", "inconnectMessagingConversationMemberState"."lastReadMessageId")
              THEN EXCLUDED."lastReadMessageCreatedAt"
              ELSE "inconnectMessagingConversationMemberState"."lastReadMessageCreatedAt"
            END,
            "lastReadMessageId" = CASE
              WHEN "inconnectMessagingConversationMemberState"."lastReadMessageCreatedAt" IS NULL
                OR (EXCLUDED."lastReadMessageCreatedAt", EXCLUDED."lastReadMessageId") >
                   ("inconnectMessagingConversationMemberState"."lastReadMessageCreatedAt", "inconnectMessagingConversationMemberState"."lastReadMessageId")
              THEN EXCLUDED."lastReadMessageId"
              ELSE "inconnectMessagingConversationMemberState"."lastReadMessageId"
            END,
            "manualUnread" = false,
            "updatedAt" = CURRENT_TIMESTAMP
          RETURNING 1
        )
        SELECT EXISTS (SELECT 1 FROM "selectedMessage") AS "messageFound"
      `,
      [
        randomUUID(),
        workspaceId,
        conversationId,
        workspaceMemberId,
        throughMessageId ?? null,
      ],
    );

    return result?.messageFound === true;
  }

  private async clearManualUnreadWithoutCursor({
    manager,
    workspaceId,
    conversationId,
    workspaceMemberId,
  }: {
    manager: EntityManager;
    workspaceId: string;
    conversationId: string;
    workspaceMemberId: string;
  }): Promise<void> {
    await manager.query(
      `
        INSERT INTO "core"."inconnectMessagingConversationMemberState"
          ("id", "workspaceId", "conversationId", "workspaceMemberId", "favorite", "manualUnread", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("workspaceId", "conversationId", "workspaceMemberId")
        DO UPDATE SET "manualUnread" = false, "updatedAt" = CURRENT_TIMESTAMP
      `,
      [randomUUID(), workspaceId, conversationId, workspaceMemberId],
    );
  }

  private async getCurrentWorkState({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationWorkStateDTO> {
    const result =
      await this.conversationQueryService.getAuthorizedConversation({
        authContext,
        conversationId,
      });

    if (result === null) {
      throw new NotFoundError('Conversation not found');
    }

    return {
      conversationId,
      isFavorite: result.isFavorite,
      isUnread: result.isUnread,
      isPending: result.isPending,
    };
  }
}
