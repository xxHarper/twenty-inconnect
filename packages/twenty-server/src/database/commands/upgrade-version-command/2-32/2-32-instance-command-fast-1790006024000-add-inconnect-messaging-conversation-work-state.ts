import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1790006024000)
export class AddInconnectMessagingConversationWorkStateFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "workStateTrackingBaselineAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConversation" ADD "pendingAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_CONVERSATION_ID_WORKSPACE_UNIQUE" ON "core"."inconnectMessagingConversation" ("id", "workspaceId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_MESSAGE_UNREAD_LOOKUP" ON "core"."inconnectMessagingMessage" ("workspaceId", "conversationId", "direction", "createdAt", "id")',
    );
    await queryRunner.query(`
      CREATE TABLE "core"."inconnectMessagingConversationMemberState" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "workspaceMemberId" uuid NOT NULL,
        "favorite" boolean NOT NULL DEFAULT false,
        "lastReadMessageCreatedAt" TIMESTAMP WITH TIME ZONE,
        "lastReadMessageId" uuid,
        "manualUnread" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_INCONNECT_MSG_MEMBER_STATE" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_INCONNECT_MSG_MEMBER_STATE_READ_CURSOR" CHECK (("lastReadMessageCreatedAt" IS NULL AND "lastReadMessageId" IS NULL) OR ("lastReadMessageCreatedAt" IS NOT NULL AND "lastReadMessageId" IS NOT NULL)),
        CONSTRAINT "FK_INCONNECT_MSG_MEMBER_STATE_WORKSPACE" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_MEMBER_STATE_CONVERSATION" FOREIGN KEY ("conversationId", "workspaceId") REFERENCES "core"."inconnectMessagingConversation"("id", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_MEMBER_STATE_IDENTITY_UNIQUE" ON "core"."inconnectMessagingConversationMemberState" ("workspaceId", "conversationId", "workspaceMemberId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_MEMBER_STATE_MEMBER_FAVORITE" ON "core"."inconnectMessagingConversationMemberState" ("workspaceId", "workspaceMemberId", "favorite", "conversationId")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "core"."inconnectMessagingConversationMemberState"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_MSG_MESSAGE_UNREAD_LOOKUP"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_MSG_CONVERSATION_ID_WORKSPACE_UNIQUE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConversation" DROP COLUMN "pendingAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "workStateTrackingBaselineAt"',
    );
  }
}
