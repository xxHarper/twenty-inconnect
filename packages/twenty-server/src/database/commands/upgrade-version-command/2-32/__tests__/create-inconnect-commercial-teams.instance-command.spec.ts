import { type QueryRunner } from 'typeorm';

import { CreateInconnectCommercialTeamsFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786578553730-create-inconnect-commercial-teams';

describe('CreateInconnectCommercialTeamsFastInstanceCommand', () => {
  it('creates workspace-isolated teams and active-membership constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateInconnectCommercialTeamsFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map((call) => call[0] as string);
    const sql = statements.join('\n');

    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectCommercialTeam"',
    );
    expect(sql).toContain(
      '"normalizedName" text GENERATED ALWAYS AS (lower(btrim("name"))) STORED',
    );
    expect(sql).toContain(
      'IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_NORMALIZED_NAME_UNIQUE',
    );
    expect(sql).toContain('WHERE "deletedAt" IS NULL');
    expect(sql).toContain(
      'IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_MEMBER_UNIQUE',
    );
    expect(sql).toContain(
      'IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_COORDINATOR_UNIQUE',
    );
    expect(sql).toContain(
      '"membershipType" = \'COORDINATOR\'',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("teamId", "workspaceId") REFERENCES "core"."inconnectCommercialTeam"("id","workspaceId") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE',
    );
  });

  it('drops membership before team on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateInconnectCommercialTeamsFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map((call) => call[0] as string);
    const membershipDropIndex = statements.indexOf(
      'DROP TABLE "core"."inconnectCommercialTeamMembership"',
    );
    const teamDropIndex = statements.indexOf(
      'DROP TABLE "core"."inconnectCommercialTeam"',
    );

    expect(membershipDropIndex).toBeGreaterThan(-1);
    expect(teamDropIndex).toBeGreaterThan(membershipDropIndex);
  });
});
