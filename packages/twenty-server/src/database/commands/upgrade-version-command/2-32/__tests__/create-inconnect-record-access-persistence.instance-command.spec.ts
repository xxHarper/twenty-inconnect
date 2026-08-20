import { type QueryRunner } from 'typeorm';

import { CreateInconnectRecordAccessPersistenceFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence';

describe('CreateInconnectRecordAccessPersistenceFastInstanceCommand', () => {
  it('creates normalized, workspace-isolated persistence with strict policy checks', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map((call) => call[0] as string);
    const sql = statements.join('\n');

    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectRecordAccessConfiguration"',
    );
    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectRecordAccessManagedObject"',
    );
    expect(sql).toContain('CREATE TABLE "core"."inconnectRecordAccessPolicy"');
    expect(sql).toContain('"revision" bigint NOT NULL DEFAULT 0');
    expect(sql).toContain('CHECK ("revision" >= 0)');
    expect(sql).toContain(
      'UNIQUE" ON "core"."inconnectRecordAccessManagedObject" ("workspaceId", "objectMetadataId")',
    );
    expect(sql).toContain(
      'UNIQUE" ON "core"."inconnectRecordAccessPolicy" ("workspaceId", "managedObjectId", "roleId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("ownerFieldMetadataId", "objectMetadataId", "workspaceId") REFERENCES "core"."fieldMetadata"("id", "objectMetadataId", "workspaceId") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("managedObjectId", "workspaceId") REFERENCES "core"."inconnectRecordAccessManagedObject"("id", "workspaceId") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("roleId", "workspaceId") REFERENCES "core"."role"("id", "workspaceId") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("defaultOwnerRoleId", "workspaceId") REFERENCES "core"."role"("id", "workspaceId") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'CHECK (("missingOwnerPolicy" = \'singleActiveMemberOfRole\') = ("defaultOwnerRoleId" IS NOT NULL))',
    );
    expect(sql).toContain(
      'CHECK ("createPolicy" <> \'denied\' OR "missingOwnerPolicy" = \'requireExplicit\')',
    );
    expect(sql).toContain(
      "CHECK (\"createPolicy\" NOT IN ('defaultOwner', 'assignableOwners') OR \"missingOwnerPolicy\" = 'self')",
    );
    expect(
      statements.every((statement) => !statement.match(/\bINSERT\b/i)),
    ).toBe(true);
  });

  it('adds only the composite uniqueness required by PostgreSQL foreign keys', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');

    expect(sql).toContain('ON "core"."role" ("id", "workspaceId")');
    expect(sql).toContain('ON "core"."objectMetadata" ("id", "workspaceId")');
    expect(sql).toContain(
      'ON "core"."fieldMetadata" ("id", "objectMetadataId", "workspaceId")',
    );
  });

  it('drops dependents before parents and then removes auxiliary indexes', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map((call) => call[0] as string);
    const policyDropIndex = statements.indexOf(
      'DROP TABLE "core"."inconnectRecordAccessPolicy"',
    );
    const managedObjectDropIndex = statements.indexOf(
      'DROP TABLE "core"."inconnectRecordAccessManagedObject"',
    );
    const configurationDropIndex = statements.indexOf(
      'DROP TABLE "core"."inconnectRecordAccessConfiguration"',
    );
    const roleIndexDropIndex = statements.indexOf(
      'DROP INDEX "core"."IDX_ROLE_ID_WORKSPACE_ID_INCONNECT_UNIQUE"',
    );

    expect(policyDropIndex).toBeGreaterThan(-1);
    expect(managedObjectDropIndex).toBeGreaterThan(policyDropIndex);
    expect(configurationDropIndex).toBeGreaterThan(managedObjectDropIndex);
    expect(roleIndexDropIndex).toBeGreaterThan(configurationDropIndex);
  });
});
