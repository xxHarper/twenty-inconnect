import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1790010000000)
export class AddInconnectMessagingContextFieldsFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "core"."inconnectMessagingContextField" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "objectMetadataId" uuid NOT NULL,
        "fieldMetadataId" uuid NOT NULL,
        "ordinal" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_INCONNECT_MSG_CONTEXT_FIELD" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_INCONNECT_MSG_CONTEXT_FIELD_ORDINAL" CHECK ("ordinal" >= 0),
        CONSTRAINT "FK_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_CONTEXT_FIELD_CONFIG_ANCHOR" FOREIGN KEY ("workspaceId", "objectMetadataId") REFERENCES "core"."inconnectMessagingConfiguration"("workspaceId", "anchorObjectMetadataId") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_INCONNECT_MSG_CONTEXT_FIELD_METADATA" FOREIGN KEY ("fieldMetadataId", "objectMetadataId", "workspaceId") REFERENCES "core"."fieldMetadata"("id", "objectMetadataId", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_FIELD_UNIQUE" ON "core"."inconnectMessagingContextField" ("workspaceId", "fieldMetadataId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_ORDINAL_UNIQUE" ON "core"."inconnectMessagingContextField" ("workspaceId", "ordinal")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE" ON "core"."inconnectMessagingContextField" ("workspaceId")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "core"."inconnectMessagingContextField"',
    );
  }
}
