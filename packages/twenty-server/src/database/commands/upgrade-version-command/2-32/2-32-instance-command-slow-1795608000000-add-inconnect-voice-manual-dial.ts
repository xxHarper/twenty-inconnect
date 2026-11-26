import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';

// Freeze the definitions alongside the upgrade so future label changes cannot rewrite it.
const flags = [
  ['544b42b4-259c-4b7b-9576-31cdb7025e38', 'DIAL_INCONNECT_VOICE', 'Dial without a Lead',
    'Place INCONNECT Voice calls to approved destinations without a visible Lead', 'IconPhone'],
  ['a5bc064b-740e-4d37-833e-8bb6559e20d5', 'READ_UNLINKED_INCONNECT_VOICE_HISTORY', 'Read personal unlinked Voice history',
    'Read your own INCONNECT Voice calls without a Lead association', 'IconHistory'],
] as const;

// DEV-LOCAL-R1 already passed the Fast phase. The Slow runner executes up and tracks it atomically.
@RegisteredInstanceCommand('2.32.0', 1795608000000, { type: 'slow' })
export class AddInconnectVoiceManualDialSlowInstanceCommand implements SlowInstanceCommand {
  async runDataMigration(): Promise<void> {}

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      ALTER COLUMN "objectMetadataId" DROP NOT NULL,
      ALTER COLUMN "recordId" DROP NOT NULL,
      ADD CONSTRAINT "CHK_inconnectVoiceCall_crmPair"
        CHECK (("objectMetadataId" IS NULL) = ("recordId" IS NULL))`);
    await queryRunner.query(`CREATE INDEX "IDX_inconnectVoiceCall_actorHistory"
      ON core."inconnectVoiceCall" ("workspaceId", "actorMemberId", "createdAt" DESC, id DESC)`);
    for (const flag of flags) {
      await queryRunner.query(`INSERT INTO core."permissionFlag"
        ("id", "workspaceId", "applicationId", "universalIdentifier", "key", label, description, icon,
          "permissionType", "createdAt", "updatedAt")
        SELECT gen_random_uuid(), app."workspaceId", app.id, $1::uuid, $2, $3, $4, $5, 'tool', now(), now()
        FROM core.application app
        JOIN core.workspace workspace ON workspace.id = app."workspaceId"
        WHERE app."universalIdentifier" = $6::uuid AND app."deletedAt" IS NULL
          AND workspace."deletedAt" IS NULL
        ON CONFLICT ("key", "workspaceId") DO NOTHING`,
        [...flag, TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER],
      );
      const [conflict]: { invalid: boolean }[] = await queryRunner.query(`SELECT EXISTS (
        SELECT 1 FROM core.application app
        JOIN core.workspace workspace ON workspace.id = app."workspaceId"
        WHERE app."universalIdentifier" = $3::uuid AND app."deletedAt" IS NULL
          AND workspace."deletedAt" IS NULL AND NOT EXISTS (
            SELECT 1 FROM core."permissionFlag" flag
            WHERE flag."workspaceId" = app."workspaceId" AND flag."applicationId" = app.id
              AND flag."universalIdentifier" = $1::uuid AND flag."key" = $2 AND flag."permissionType" = 'tool'
          )
        ) AS invalid`, [flag[0], flag[1], TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER]);
      if (conflict?.invalid !== false) throw new Error('Voice permission metadata is inconsistent');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [grants]: { present: boolean }[] = await queryRunner.query(`SELECT EXISTS (
      SELECT 1 FROM core."rolePermissionFlag" role_grant
        JOIN core."permissionFlag" flag ON flag.id = role_grant."permissionFlagId"
      WHERE flag."universalIdentifier" = ANY($1::uuid[])
    ) AS present`, [flags.map(([identifier]) => identifier)]);
    if (grants?.present !== false) throw new Error('Voice permission grants must be reviewed before reversal');
    // SET NOT NULL rejects reversal while unlinked history exists.
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      ALTER COLUMN "objectMetadataId" SET NOT NULL,
      ALTER COLUMN "recordId" SET NOT NULL,
      DROP CONSTRAINT "CHK_inconnectVoiceCall_crmPair"`);
    await queryRunner.query('DROP INDEX core."IDX_inconnectVoiceCall_actorHistory"');
    await queryRunner.query(`DELETE FROM core."permissionFlag" flag USING core.application app
      WHERE flag."universalIdentifier" = ANY($1::uuid[]) AND flag."applicationId" = app.id
        AND app."universalIdentifier" = $2::uuid`,
      [flags.map(([identifier]) => identifier), TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER],
    );
  }
}
