import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { type GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const OBJECT_ID = '00000000-0000-4000-8000-000000000002';
const ROLE_ID = '00000000-0000-4000-8000-000000000003';
const OWNER_FIELD_ID = '00000000-0000-4000-8000-000000000004';
const WORKSPACE_MEMBER_ID = '00000000-0000-4000-8000-000000000005';
const USER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000006';

const emptyFlatMaps = {
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
};
const teamMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {},
  memberWorkspaceMemberIdsByTeamId: {},
  assignableMemberWorkspaceMemberIdsByTeamId: {},
};
const authContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID },
  workspaceMemberId: WORKSPACE_MEMBER_ID,
  userWorkspaceId: USER_WORKSPACE_ID,
} as WorkspaceAuthContext;

const buildPolicy = (
  recordEffect: 'allRecords' | 'ownAndTeamRecords',
): InconnectRecordAccessWorkspacePolicy => ({
  status: 'configured',
  managedObjectMetadataIds: [OBJECT_ID],
  rules: [
    {
      roleId: ROLE_ID,
      objectMetadataId: OBJECT_ID,
      ownerFieldMetadataId: OWNER_FIELD_ID,
      ownerFieldName: 'owner',
      ownerJoinColumnName: 'ownerId',
      recordEffect,
      createPolicy: 'denied',
      ownerTransferPolicy: 'denied',
      ownerRequirement: 'required',
      missingOwnerPolicy: 'requireExplicit',
    },
  ],
});

const buildHarness = (
  policy: InconnectRecordAccessWorkspacePolicy,
  { teamCacheUnavailable = false } = {},
) => {
  const getOrRecompute = jest.fn(
    async (_workspaceId: string, keys: string[]) => {
      if (keys.length === 1 && keys[0] === 'inconnectTeamAccessMaps') {
        if (teamCacheUnavailable) {
          throw new Error('Redis unavailable');
        }

        return { inconnectTeamAccessMaps: teamMaps };
      }

      return {
        flatObjectMetadataMaps: emptyFlatMaps,
        flatFieldMetadataMaps: emptyFlatMaps,
        flatRoleMaps: emptyFlatMaps,
        userWorkspaceRoleMap: { [USER_WORKSPACE_ID]: ROLE_ID },
        apiKeyRoleMap: {},
        ORMEntityMetadatas: [],
      };
    },
  );
  const resolveWorkspacePolicy = jest.fn().mockResolvedValue(policy);
  const manager = new GlobalWorkspaceOrmManager(
    {} as GlobalWorkspaceDataSourceService,
    { getOrRecompute } as unknown as WorkspaceCacheService,
    {
      resolveWorkspacePolicy,
    } as unknown as InconnectRecordAccessPolicySourceService,
  );

  return { getOrRecompute, manager, resolveWorkspacePolicy };
};

describe('GlobalWorkspaceOrmManager INCONNECT policy source integration', () => {
  it('passes the centrally selected policy into the ORM context without loading Team for allRecords', async () => {
    const policy = buildPolicy('allRecords');
    const { getOrRecompute, manager, resolveWorkspacePolicy } =
      buildHarness(policy);

    const context = await manager.executeInWorkspaceContext(
      () => getWorkspaceContext(),
      authContext,
      { lite: true },
    );

    expect(context.inconnectRecordAccessPolicy).toBe(policy);
    expect(context.inconnectTeamAccessMaps).toEqual({
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {},
      memberWorkspaceMemberIdsByTeamId: {},
      assignableMemberWorkspaceMemberIdsByTeamId: {},
    });
    expect(resolveWorkspacePolicy).toHaveBeenCalledTimes(1);
    expect(getOrRecompute).toHaveBeenCalledTimes(1);
    expect(getOrRecompute.mock.calls[0][1]).not.toContain(
      'inconnectRecordAccessPolicyMaps',
    );
    expect(getOrRecompute.mock.calls[0][1]).not.toContain(
      'inconnectTeamAccessMaps',
    );
  });

  it('loads the existing Team authority only for an applicable ownAndTeam policy', async () => {
    const policy = buildPolicy('ownAndTeamRecords');
    const { getOrRecompute, manager } = buildHarness(policy);

    const context = await manager.executeInWorkspaceContext(
      () => getWorkspaceContext(),
      authContext,
      { lite: true },
    );

    expect(context.inconnectTeamAccessMaps).toBe(teamMaps);
    expect(getOrRecompute).toHaveBeenCalledTimes(2);
    expect(getOrRecompute.mock.calls[1]).toEqual([
      WORKSPACE_ID,
      ['inconnectTeamAccessMaps'],
    ]);
  });

  it('does not load Team for a denied source-level policy', async () => {
    const { getOrRecompute, manager } = buildHarness({
      status: 'invalid',
      reason: 'database cache unavailable',
    });

    const context = await manager.executeInWorkspaceContext(
      () => getWorkspaceContext(),
      authContext,
      { lite: true },
    );

    expect(context.inconnectRecordAccessPolicy).toMatchObject({
      status: 'invalid',
    });
    expect(getOrRecompute).toHaveBeenCalledTimes(1);
  });

  it('converts a technical Team cache failure into explicit fail-closed authority', async () => {
    const { manager } = buildHarness(buildPolicy('ownAndTeamRecords'), {
      teamCacheUnavailable: true,
    });

    const context = await manager.executeInWorkspaceContext(
      () => getWorkspaceContext(),
      authContext,
      { lite: true },
    );

    expect(context.inconnectTeamAccessMaps).toEqual({
      version: 1,
      status: 'invalid',
      reason: 'INCONNECT team cache is unavailable',
      failureKind: 'recomputation-failed',
    });
  });
});
