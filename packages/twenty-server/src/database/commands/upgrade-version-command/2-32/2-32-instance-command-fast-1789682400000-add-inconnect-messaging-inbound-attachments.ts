import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1789682400000)
export class AddInconnectMessagingInboundAttachmentsFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE" CHECK ("type" IN (\'TEXT\', \'IMAGE\', \'STICKER\', \'AUDIO\', \'VIDEO\', \'DOCUMENT\', \'CONTACT\', \'LOCATION\'))',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_FILE_ID_WORKSPACE_ID_UNIQUE" ON "core"."file" ("id", "workspaceId")',
    );
    await queryRunner.query(`
      CREATE TABLE "core"."inconnectMessagingAttachment" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "providerConnectionId" uuid NOT NULL,
        "ordinal" smallint NOT NULL,
        "type" character varying NOT NULL,
        "ingestionState" character varying NOT NULL,
        "providerMediaLocator" text,
        "declaredMimeType" character varying,
        "safeFilename" text NOT NULL,
        "fileId" uuid,
        "mimeType" character varying,
        "size" bigint,
        "leaseToken" uuid,
        "leaseExpiresAt" TIMESTAMP WITH TIME ZONE,
        "attemptCount" integer NOT NULL DEFAULT 0,
        "lastErrorCode" character varying,
        "availableAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_INCONNECT_MSG_ATTACHMENT" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_INCONNECT_MSG_ATTACHMENT_TYPE" CHECK ("type" IN ('IMAGE', 'STICKER', 'AUDIO', 'VIDEO', 'DOCUMENT', 'CONTACT')),
        CONSTRAINT "CHK_INCONNECT_MSG_ATTACHMENT_STATE" CHECK ("ingestionState" IN ('PENDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'EXPIRED')),
        CONSTRAINT "CHK_INCONNECT_MSG_ATTACHMENT_AVAILABLE" CHECK (("ingestionState" = 'AVAILABLE' AND "fileId" IS NOT NULL AND "mimeType" IS NOT NULL AND "size" IS NOT NULL AND "availableAt" IS NOT NULL) OR ("ingestionState" <> 'AVAILABLE' AND "fileId" IS NULL AND "mimeType" IS NULL AND "size" IS NULL AND "availableAt" IS NULL)),
        CONSTRAINT "CHK_INCONNECT_MSG_ATTACHMENT_LEASE" CHECK (("ingestionState" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("ingestionState" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)),
        CONSTRAINT "FK_INCONNECT_MSG_ATTACHMENT_WORKSPACE" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_ATTACHMENT_MESSAGE" FOREIGN KEY ("messageId", "providerConnectionId", "workspaceId") REFERENCES "core"."inconnectMessagingMessage"("id", "providerConnectionId", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_ATTACHMENT_FILE" FOREIGN KEY ("fileId", "workspaceId") REFERENCES "core"."file"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_ATTACHMENT_MESSAGE_ORDINAL_UNIQUE" ON "core"."inconnectMessagingAttachment" ("messageId", "ordinal")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_ATTACHMENT_FILE_UNIQUE" ON "core"."inconnectMessagingAttachment" ("fileId") WHERE "fileId" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_ATTACHMENT_RECOVERY" ON "core"."inconnectMessagingAttachment" ("ingestionState", "leaseExpiresAt")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "core"."inconnectMessagingAttachment"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_FILE_ID_WORKSPACE_ID_UNIQUE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE"',
    );
    await queryRunner.query(
      'UPDATE "core"."inconnectMessagingMessage" SET "type" = \'IMAGE\' WHERE "type" = \'STICKER\'',
    );
    await queryRunner.query(
      'UPDATE "core"."inconnectMessagingMessage" SET "type" = \'DOCUMENT\' WHERE "type" = \'CONTACT\'',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE" CHECK ("type" IN (\'TEXT\', \'IMAGE\', \'AUDIO\', \'VIDEO\', \'DOCUMENT\', \'LOCATION\'))',
    );
  }
}
