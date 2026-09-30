import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1790793305698)
export class AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "autoCreateEnabled" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "autoCreateAnchorObjectMetadataId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "autoCreateOwnerStrategy" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "autoCreateOwnerRoleId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "autoCreateLabelPolicy" character varying',
    );
    await queryRunner.query(`ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_TUPLE" CHECK ((
    "autoCreateEnabled" = false
    AND "autoCreateAnchorObjectMetadataId" IS NULL
    AND "autoCreateOwnerStrategy" IS NULL
    AND "autoCreateOwnerRoleId" IS NULL
    AND "autoCreateLabelPolicy" IS NULL
  ) OR (
    "autoCreateAnchorObjectMetadataId" IS NOT NULL
    AND "autoCreateOwnerStrategy" IS NOT NULL
    AND "autoCreateOwnerRoleId" IS NOT NULL
    AND "autoCreateLabelPolicy" IS NOT NULL
  ))`);
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_LABEL_POLICY" CHECK ("autoCreateLabelPolicy" IS NULL OR "autoCreateLabelPolicy" = \'OMIT\')',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_OWNER_STRATEGY" CHECK ("autoCreateOwnerStrategy" IS NULL OR "autoCreateOwnerStrategy" = \'UNIQUE_ACTIVE_MEMBER_OF_ROLE\')',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ANCHOR" FOREIGN KEY ("autoCreateAnchorObjectMetadataId", "workspaceId") REFERENCES "core"."objectMetadata"("id","workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ROLE" FOREIGN KEY ("autoCreateOwnerRoleId", "workspaceId") REFERENCES "core"."role"("id","workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ROLE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ANCHOR"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_OWNER_STRATEGY"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_LABEL_POLICY"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_TUPLE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "autoCreateLabelPolicy"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "autoCreateOwnerRoleId"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "autoCreateOwnerStrategy"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "autoCreateAnchorObjectMetadataId"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "autoCreateEnabled"',
    );
  }
}
