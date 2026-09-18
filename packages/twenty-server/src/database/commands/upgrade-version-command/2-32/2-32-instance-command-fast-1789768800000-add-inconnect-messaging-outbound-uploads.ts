import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1789768800000)
export class AddInconnectMessagingOutboundUploadsFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "core"."inconnectMessagingOutboundUpload" (
        "id" uuid NOT NULL,
        "workspaceId" uuid NOT NULL,
        "workspaceMemberId" uuid NOT NULL,
        "clientUploadId" uuid NOT NULL,
        "state" character varying NOT NULL,
        "type" character varying NOT NULL,
        "safeFilename" text NOT NULL,
        "size" bigint NOT NULL,
        "fileId" uuid,
        "mimeType" character varying,
        "contentFingerprint" text,
        "requestFingerprint" text NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "consumedByMessageId" uuid,
        "consumedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_INCONNECT_MSG_OUTBOUND_UPLOAD" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_TYPE" CHECK ("type" IN ('IMAGE', 'STICKER', 'AUDIO', 'VIDEO', 'DOCUMENT', 'CONTACT')),
        CONSTRAINT "CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_STATE" CHECK ("state" IN ('CREATING', 'PENDING', 'AVAILABLE', 'CONSUMED')),
        CONSTRAINT "CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE" CHECK (("state" = 'CREATING' AND "fileId" IS NULL) OR ("state" <> 'CREATING' AND "fileId" IS NOT NULL)),
        CONSTRAINT "CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_AVAILABLE" CHECK (("state" IN ('AVAILABLE', 'CONSUMED') AND "mimeType" IS NOT NULL AND "contentFingerprint" IS NOT NULL AND "completedAt" IS NOT NULL) OR ("state" IN ('CREATING', 'PENDING') AND "mimeType" IS NULL AND "contentFingerprint" IS NULL AND "completedAt" IS NULL)),
        CONSTRAINT "CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_CONSUMED" CHECK (("state" = 'CONSUMED' AND "consumedByMessageId" IS NOT NULL AND "consumedAt" IS NOT NULL) OR ("state" <> 'CONSUMED' AND "consumedByMessageId" IS NULL AND "consumedAt" IS NULL)),
        CONSTRAINT "FK_INCONNECT_MSG_OUTBOUND_UPLOAD_WORKSPACE" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE" FOREIGN KEY ("fileId", "workspaceId") REFERENCES "core"."file"("id", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_OUTBOUND_UPLOAD_CONSUMED_MESSAGE" FOREIGN KEY ("consumedByMessageId", "workspaceId") REFERENCES "core"."inconnectMessagingMessage"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_CLIENT_UNIQUE" ON "core"."inconnectMessagingOutboundUpload" ("workspaceId", "workspaceMemberId", "clientUploadId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE_UNIQUE" ON "core"."inconnectMessagingOutboundUpload" ("fileId") WHERE "fileId" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_EXPIRY" ON "core"."inconnectMessagingOutboundUpload" ("state", "expiresAt")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "core"."inconnectMessagingOutboundUpload"',
    );
  }
}
