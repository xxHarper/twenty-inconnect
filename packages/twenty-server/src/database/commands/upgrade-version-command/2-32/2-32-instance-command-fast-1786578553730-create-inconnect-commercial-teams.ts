import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1786578553730)
export class CreateInconnectCommercialTeamsFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "core"."inconnectCommercialTeam" ("workspaceId" uuid NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "normalizedName" text GENERATED ALWAYS AS (lower(btrim("name"))) STORED, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_INCONNECT_COMMERCIAL_TEAM_NORMALIZED_NAME" CHECK (btrim("name") <> \'\'), CONSTRAINT "PK_1949152b1f940b81fa6c4f39714" PRIMARY KEY ("id"))');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_NORMALIZED_NAME_UNIQUE" ON "core"."inconnectCommercialTeam" ("workspaceId", "normalizedName") WHERE "deletedAt" IS NULL');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_ID_WORKSPACE_ID_UNIQUE" ON "core"."inconnectCommercialTeam" ("id", "workspaceId") ');
    await queryRunner.query('CREATE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_ID" ON "core"."inconnectCommercialTeam" ("workspaceId") ');
    await queryRunner.query('CREATE TABLE "core"."inconnectCommercialTeamMembership" ("workspaceId" uuid NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "teamId" uuid NOT NULL, "workspaceMemberId" uuid NOT NULL, "membershipType" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_TYPE" CHECK ("membershipType" IN (\'COORDINATOR\', \'EXECUTIVE\')), CONSTRAINT "PK_769f9a3278ccd7facd692798a21" PRIMARY KEY ("id"))');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_COORDINATOR_UNIQUE" ON "core"."inconnectCommercialTeamMembership" ("teamId") WHERE "deletedAt" IS NULL AND "membershipType" = \'COORDINATOR\'');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_MEMBER_UNIQUE" ON "core"."inconnectCommercialTeamMembership" ("workspaceId", "workspaceMemberId") WHERE "deletedAt" IS NULL');
    await queryRunner.query('CREATE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_MEMBER_ID" ON "core"."inconnectCommercialTeamMembership" ("workspaceMemberId") ');
    await queryRunner.query('CREATE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_TEAM_ID" ON "core"."inconnectCommercialTeamMembership" ("teamId") ');
    await queryRunner.query('CREATE INDEX "IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_WORKSPACE_ID" ON "core"."inconnectCommercialTeamMembership" ("workspaceId") ');
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeam" ADD CONSTRAINT "FK_35cd9ba5f3d7dd0cb3bc40d5b1f" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeamMembership" ADD CONSTRAINT "FK_33cdbe13eb157d162130dbcdee5" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeamMembership" ADD CONSTRAINT "FK_7db90294f75fa48d98259944ae9" FOREIGN KEY ("teamId", "workspaceId") REFERENCES "core"."inconnectCommercialTeam"("id","workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeamMembership" DROP CONSTRAINT "FK_7db90294f75fa48d98259944ae9"');
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeamMembership" DROP CONSTRAINT "FK_33cdbe13eb157d162130dbcdee5"');
    await queryRunner.query('ALTER TABLE "core"."inconnectCommercialTeam" DROP CONSTRAINT "FK_35cd9ba5f3d7dd0cb3bc40d5b1f"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_WORKSPACE_ID"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_TEAM_ID"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_MEMBER_ID"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_MEMBER_UNIQUE"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_COORDINATOR_UNIQUE"');
    await queryRunner.query('DROP TABLE "core"."inconnectCommercialTeamMembership"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_ID"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_ID_WORKSPACE_ID_UNIQUE"');
    await queryRunner.query('DROP INDEX "core"."IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_NORMALIZED_NAME_UNIQUE"');
    await queryRunner.query('DROP TABLE "core"."inconnectCommercialTeam"');
  }
}
