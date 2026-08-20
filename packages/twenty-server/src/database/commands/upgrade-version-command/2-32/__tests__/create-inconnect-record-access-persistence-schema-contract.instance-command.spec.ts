import { type QueryRunner } from 'typeorm';

import { CreateInconnectRecordAccessPersistenceFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence';

describe('INCONNECT record-access persistence schema contract', () => {
  it('uses the approved enum checks and dependency delete behavior', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');

    expect(sql).toContain("\"enforcementMode\" IN ('MANAGED', 'UNMANAGED')");
    expect(sql).toContain("\"ownerRequirement\" IN ('required', 'optional')");
    expect(sql).toContain('"principalType" = \'WORKSPACE_MEMBER\'');
    expect(sql).toContain(
      "\"recordEffect\" IN ('ownRecords', 'ownAndTeamRecords', 'allRecords')",
    );
    expect(sql).toContain(
      "\"createPolicy\" IN ('denied', 'defaultOwner', 'assignableOwners', 'standardPermissionsOnly')",
    );
    expect(sql).toContain(
      "\"ownerTransferPolicy\" IN ('denied', 'assignableOwners', 'standardPermissionsOnly')",
    );
    expect(sql).toContain(
      "\"missingOwnerPolicy\" IN ('self', 'requireExplicit', 'singleActiveMemberOfRole', 'standard')",
    );
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId") REFERENCES "core"."inconnectRecordAccessConfiguration"("workspaceId") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("objectMetadataId", "workspaceId") REFERENCES "core"."objectMetadata"("id", "workspaceId") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("ownerFieldMetadataId", "objectMetadataId", "workspaceId") REFERENCES "core"."fieldMetadata"("id", "objectMetadataId", "workspaceId") ON DELETE RESTRICT',
    );
  });
});
