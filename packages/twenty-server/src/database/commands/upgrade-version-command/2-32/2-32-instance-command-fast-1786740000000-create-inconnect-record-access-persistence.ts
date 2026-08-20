import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1786740000000)
export class CreateInconnectRecordAccessPersistenceFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_ROLE_ID_WORKSPACE_ID_INCONNECT_UNIQUE" ON "core"."role" ("id", "workspaceId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_OBJECT_METADATA_ID_WORKSPACE_ID_INCONNECT_UNIQUE" ON "core"."objectMetadata" ("id", "workspaceId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_FIELD_METADATA_ID_OBJECT_WORKSPACE_INCONNECT_UNIQUE" ON "core"."fieldMetadata" ("id", "objectMetadataId", "workspaceId")',
    );

    await queryRunner.query(
      'CREATE TABLE "core"."inconnectRecordAccessConfiguration" ("workspaceId" uuid NOT NULL, "enforcementMode" character varying NOT NULL, "revision" bigint NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_CONFIGURATION_ENFORCEMENT_MODE" CHECK ("enforcementMode" IN (\'MANAGED\', \'UNMANAGED\')), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_CONFIGURATION_REVISION" CHECK ("revision" >= 0), CONSTRAINT "PK_INCONNECT_RECORD_ACCESS_CONFIGURATION" PRIMARY KEY ("workspaceId"))',
    );

    await queryRunner.query(
      'CREATE TABLE "core"."inconnectRecordAccessManagedObject" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "objectMetadataId" uuid NOT NULL, "ownerFieldMetadataId" uuid NOT NULL, "ownerRequirement" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OWNER_REQUIREMENT" CHECK ("ownerRequirement" IN (\'required\', \'optional\')), CONSTRAINT "PK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT" PRIMARY KEY ("id"))',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_ID_WORKSPACE_UNIQUE" ON "core"."inconnectRecordAccessManagedObject" ("id", "workspaceId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_RA_MANAGED_OBJECT_WORKSPACE_OBJECT_UNIQUE" ON "core"."inconnectRecordAccessManagedObject" ("workspaceId", "objectMetadataId")',
    );

    await queryRunner.query(
      'CREATE TABLE "core"."inconnectRecordAccessPolicy" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "managedObjectId" uuid NOT NULL, "roleId" uuid NOT NULL, "principalType" character varying NOT NULL, "recordEffect" character varying NOT NULL, "createPolicy" character varying NOT NULL, "ownerTransferPolicy" character varying NOT NULL, "missingOwnerPolicy" character varying NOT NULL, "defaultOwnerRoleId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_PRINCIPAL_TYPE" CHECK ("principalType" = \'WORKSPACE_MEMBER\'), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_RECORD_EFFECT" CHECK ("recordEffect" IN (\'ownRecords\', \'ownAndTeamRecords\', \'allRecords\')), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_CREATE_POLICY" CHECK ("createPolicy" IN (\'denied\', \'defaultOwner\', \'assignableOwners\', \'standardPermissionsOnly\')), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_OWNER_TRANSFER_POLICY" CHECK ("ownerTransferPolicy" IN (\'denied\', \'assignableOwners\', \'standardPermissionsOnly\')), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_MISSING_OWNER_POLICY" CHECK ("missingOwnerPolicy" IN (\'self\', \'requireExplicit\', \'singleActiveMemberOfRole\', \'standard\')), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE" CHECK (("missingOwnerPolicy" = \'singleActiveMemberOfRole\') = ("defaultOwnerRoleId" IS NOT NULL)), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_DENIED_CREATE" CHECK ("createPolicy" <> \'denied\' OR "missingOwnerPolicy" = \'requireExplicit\'), CONSTRAINT "CHK_INCONNECT_RECORD_ACCESS_POLICY_SCOPED_CREATE" CHECK ("createPolicy" NOT IN (\'defaultOwner\', \'assignableOwners\') OR "missingOwnerPolicy" = \'self\'), CONSTRAINT "PK_INCONNECT_RECORD_ACCESS_POLICY" PRIMARY KEY ("id"))',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_RA_POLICY_WORKSPACE_MANAGED_OBJECT_ROLE_UNIQUE" ON "core"."inconnectRecordAccessPolicy" ("workspaceId", "managedObjectId", "roleId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_ROLE" ON "core"."inconnectRecordAccessPolicy" ("workspaceId", "roleId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_DEFAULT_OWNER_ROLE" ON "core"."inconnectRecordAccessPolicy" ("workspaceId", "defaultOwnerRoleId") WHERE "defaultOwnerRoleId" IS NOT NULL',
    );

    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessConfiguration" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_CONFIGURATION_WORKSPACE" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_CONFIGURATION" FOREIGN KEY ("workspaceId") REFERENCES "core"."inconnectRecordAccessConfiguration"("workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OBJECT_METADATA" FOREIGN KEY ("objectMetadataId", "workspaceId") REFERENCES "core"."objectMetadata"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OWNER_FIELD" FOREIGN KEY ("ownerFieldMetadataId", "objectMetadataId", "workspaceId") REFERENCES "core"."fieldMetadata"("id", "objectMetadataId", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_MANAGED_OBJECT" FOREIGN KEY ("managedObjectId", "workspaceId") REFERENCES "core"."inconnectRecordAccessManagedObject"("id", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_ROLE" FOREIGN KEY ("roleId", "workspaceId") REFERENCES "core"."role"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" ADD CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE" FOREIGN KEY ("defaultOwnerRoleId", "workspaceId") REFERENCES "core"."role"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_ROLE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessPolicy" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_POLICY_MANAGED_OBJECT"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OWNER_FIELD"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OBJECT_METADATA"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessManagedObject" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_CONFIGURATION"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectRecordAccessConfiguration" DROP CONSTRAINT "FK_INCONNECT_RECORD_ACCESS_CONFIGURATION_WORKSPACE"',
    );

    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_DEFAULT_OWNER_ROLE"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_ROLE"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_RA_POLICY_WORKSPACE_MANAGED_OBJECT_ROLE_UNIQUE"',
    );
    await queryRunner.query('DROP TABLE "core"."inconnectRecordAccessPolicy"');
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_RA_MANAGED_OBJECT_WORKSPACE_OBJECT_UNIQUE"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_ID_WORKSPACE_UNIQUE"',
    );
    await queryRunner.query(
      'DROP TABLE "core"."inconnectRecordAccessManagedObject"',
    );
    await queryRunner.query(
      'DROP TABLE "core"."inconnectRecordAccessConfiguration"',
    );

    await queryRunner.query(
      'DROP INDEX "core"."IDX_FIELD_METADATA_ID_OBJECT_WORKSPACE_INCONNECT_UNIQUE"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_OBJECT_METADATA_ID_WORKSPACE_ID_INCONNECT_UNIQUE"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_ROLE_ID_WORKSPACE_ID_INCONNECT_UNIQUE"',
    );
  }
}
