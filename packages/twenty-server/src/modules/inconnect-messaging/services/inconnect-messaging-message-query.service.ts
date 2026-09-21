import { Injectable } from '@nestjs/common';

import { Brackets } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  decodeInconnectMessagingCursor,
  encodeInconnectMessagingCursor,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-cursor.util';

export type InconnectMessagingMessageCursorPage = {
  edges: Array<{
    cursor: string;
    node: InconnectMessagingMessageEntity;
    sortAt: Date;
  }>;
  hasNextPage: boolean;
  readThroughMessageId: string | null;
  totalCount: number;
};

// Display chronology intentionally uses provider/effective time. Personal
// read state independently follows server arrival (Message.createdAt + id).
const MESSAGE_DISPLAY_AT_SQL =
  'COALESCE(message.effectiveInboundAt, message.createdAt)';
const MESSAGE_READ_THROUGH_TARGET_SQL = `(
  SELECT "readTarget"."id"
  FROM "core"."inconnectMessagingMessage" "readTarget"
  WHERE "readTarget"."workspaceId" = message."workspaceId"
    AND "readTarget"."conversationId" = message."conversationId"
    AND "readTarget"."direction" = 'INBOUND'
  ORDER BY "readTarget"."createdAt" DESC, "readTarget"."id" DESC
  LIMIT 1
)`;

@Injectable()
export class InconnectMessagingMessageQueryService {
  constructor(
    @InjectWorkspaceScopedRepository(InconnectMessagingMessageEntity)
    private readonly messageRepository: WorkspaceScopedRepository<InconnectMessagingMessageEntity>,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  async getAuthorizedMessagePage({
    authContext,
    conversationId,
    first,
    after,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    first: number;
    after?: string;
  }): Promise<InconnectMessagingMessageCursorPage | null> {
    const conversation =
      await this.authorizationService.findAuthorizedConversation({
        authContext,
        conversationId,
      });

    if (conversation === null) {
      return null;
    }

    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachment')
      .where('message.workspaceId = :messageWorkspaceId', {
        messageWorkspaceId: authContext.workspace.id,
      })
      .andWhere('message.conversationId = :messageConversationId', {
        messageConversationId: conversation.id,
      });
    const totalCount = await queryBuilder.clone().getCount();

    if (after !== undefined) {
      const cursor = decodeInconnectMessagingCursor({
        cursor: after,
        expectedKind: 'message',
      });

      queryBuilder.andWhere(
        new Brackets((cursorQueryBuilder) => {
          cursorQueryBuilder
            .where(`${MESSAGE_DISPLAY_AT_SQL} < :messageCursorSortAt`, {
              messageCursorSortAt: cursor.sortAt,
            })
            .orWhere(
              `${MESSAGE_DISPLAY_AT_SQL} = :messageCursorSortAt AND message.id < :messageCursorId`,
              {
                messageCursorSortAt: cursor.sortAt,
                messageCursorId: cursor.id,
              },
            );
        }),
      );
    }

    const rows = await queryBuilder
      .addSelect(MESSAGE_DISPLAY_AT_SQL, 'messageDisplayAt')
      .addSelect('message.id', 'messageCursorId')
      .addSelect(MESSAGE_READ_THROUGH_TARGET_SQL, 'messageReadThroughTargetId')
      .orderBy(MESSAGE_DISPLAY_AT_SQL, 'DESC')
      .addOrderBy('message.id', 'DESC')
      .addOrderBy('attachment.ordinal', 'ASC')
      .take(first + 1)
      .getRawAndEntities();
    const hasNextPage = rows.entities.length > first;
    const entities = hasNextPage
      ? rows.entities.slice(0, first)
      : rows.entities;
    const displayAtByMessageId = new Map(
      rows.raw.map((row) => [
        String(row.messageCursorId),
        row.messageDisplayAt,
      ]),
    );
    const readThroughTargetId = rows.raw[0]?.messageReadThroughTargetId;
    const readThroughMessageId =
      typeof readThroughTargetId === 'string' &&
      entities.some(({ id }) => id === readThroughTargetId)
        ? readThroughTargetId
        : null;

    return {
      edges: entities.map((node) => {
        const rawSortAt = displayAtByMessageId.get(node.id);
        const sortAt = new Date(
          rawSortAt instanceof Date ? rawSortAt : String(rawSortAt),
        );

        return {
          node,
          sortAt,
          cursor: encodeInconnectMessagingCursor({
            id: node.id,
            kind: 'message',
            sortAt,
          }),
        };
      }),
      hasNextPage,
      readThroughMessageId,
      totalCount,
    };
  }
}
