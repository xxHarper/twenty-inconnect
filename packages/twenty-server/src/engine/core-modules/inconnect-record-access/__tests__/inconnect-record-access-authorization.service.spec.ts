import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';

import { DataSource } from 'typeorm';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const OBJECT_METADATA_ID = '20202020-3333-4333-8333-333333333333';
const ROLE_ID = '20202020-4444-4444-8444-444444444444';
const WORKSPACE_MEMBER_ID = '20202020-5555-4555-8555-555555555555';
const TEAM_MEMBER_ID = '20202020-6666-4666-8666-666666666666';
const TEAM_ID = '20202020-7777-4777-8777-777777777777';

const userAuthContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_test' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: WORKSPACE_MEMBER_ID,
  workspaceMember: { id: WORKSPACE_MEMBER_ID },
  user: { id: 'user-id' },
} as never;

const systemAuthContext = {
  type: 'system',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_test' },
} as never;

const baseRule = {
  roleId: ROLE_ID,
  objectMetadataId: OBJECT_METADATA_ID,
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'owner',
  ownerJoinColumnName: 'ownerId',
  createPolicy: 'denied',
  ownerTransferPolicy: 'denied',
  ownerRequirement: 'required',
  missingOwnerPolicy: 'requireExplicit',
} as const;

const buildPolicy = (
  recordEffect: 'ownRecords' | 'ownAndTeamRecords' | 'allRecords',
): InconnectRecordAccessWorkspacePolicy => ({
  status: 'configured',
  managedObjectMetadataIds: [OBJECT_METADATA_ID],
  rules: [{ ...baseRule, recordEffect }],
});

const buildService = ({
  policy = buildPolicy('ownRecords'),
  metadataWorkspaceId = WORKSPACE_ID,
  initialCacheFailure = false,
  teamCacheFailure = false,
  workspaceMemberFailure = false,
  rawRecord = { authorized: 1 },
}: {
  policy?: InconnectRecordAccessWorkspacePolicy;
  metadataWorkspaceId?: string;
  initialCacheFailure?: boolean;
  teamCacheFailure?: boolean;
  workspaceMemberFailure?: boolean;
  rawRecord?: { authorized: number } | null;
} = {}) => {
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(rawRecord),
  };
  const workspaceCacheService = {
    getOrRecompute: jest
      .fn()
      .mockImplementation(async (_workspaceId: string, keys: string[]) => {
        if (keys.includes('inconnectTeamAccessMaps')) {
          if (teamCacheFailure) {
            throw new Error('team cache unavailable');
          }

          return {
            inconnectTeamAccessMaps: {
              version: 1,
              status: 'valid',
              membershipByWorkspaceMemberId: {
                [WORKSPACE_MEMBER_ID]: {
                  teamId: TEAM_ID,
                  membershipType:
                    InconnectCommercialTeamMembershipType.COORDINATOR,
                  isWorkspaceMemberAssignable: true,
                },
                [TEAM_MEMBER_ID]: {
                  teamId: TEAM_ID,
                  membershipType:
                    InconnectCommercialTeamMembershipType.EXECUTIVE,
                  isWorkspaceMemberAssignable: true,
                },
              },
              memberWorkspaceMemberIdsByTeamId: {
                [TEAM_ID]: [WORKSPACE_MEMBER_ID, TEAM_MEMBER_ID],
              },
              assignableMemberWorkspaceMemberIdsByTeamId: {
                [TEAM_ID]: [WORKSPACE_MEMBER_ID, TEAM_MEMBER_ID],
              },
            },
          };
        }

        if (initialCacheFailure) {
          throw new Error('metadata cache unavailable');
        }

        return {
          flatRoleMaps: {
            byUniversalIdentifier: {},
            universalIdentifierById: {},
            universalIdentifiersByApplicationId: {},
          },
          flatObjectMetadataMaps: {
            byUniversalIdentifier: {
              'object-universal-id': {
                id: OBJECT_METADATA_ID,
                workspaceId: metadataWorkspaceId,
                nameSingular: 'lead',
                applicationUniversalIdentifier: 'custom-application-id',
              },
            },
            universalIdentifierById: {
              [OBJECT_METADATA_ID]: 'object-universal-id',
            },
            universalIdentifiersByApplicationId: {},
          },
          flatFieldMetadataMaps: {
            byUniversalIdentifier: {},
            universalIdentifierById: {},
            universalIdentifiersByApplicationId: {},
          },
          userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
          apiKeyRoleMap: {},
        };
      }),
  };
  const policySourceService = {
    resolveWorkspacePolicy: jest.fn().mockResolvedValue(policy),
  };
  const workspaceMemberService = {
    assertActiveWorkspaceMember: workspaceMemberFailure
      ? jest.fn().mockRejectedValue(new Error('inactive member'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const coreDataSource = {
    manager: {},
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const service = new InconnectRecordAccessAuthorizationService(
    coreDataSource as never,
    workspaceCacheService as never,
    policySourceService as never,
    workspaceMemberService as never,
  );

  return {
    service,
    queryBuilder,
    workspaceCacheService,
    workspaceMemberService,
  };
};

describe('InconnectRecordAccessAuthorizationService', () => {
  it('returns not-managed without turning it into universal authorization', async () => {
    const { service } = buildService({ policy: { status: 'unmanaged' } });

    await expect(
      service.resolveReadScope({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: userAuthContext,
      }),
    ).resolves.toEqual({ kind: 'not-managed' });
  });

  it('preserves the existing internal system bypass', async () => {
    const { service, workspaceMemberService } = buildService({
      policy: { status: 'invalid', reason: 'unavailable' },
    });

    await expect(
      service.resolveReadScope({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: systemAuthContext,
      }),
    ).resolves.toEqual({ kind: 'system-bypass' });
    expect(
      workspaceMemberService.assertActiveWorkspaceMember,
    ).not.toHaveBeenCalled();
  });

  it('denies a managed object with no applicable Role rule', async () => {
    const { service } = buildService({
      policy: {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_METADATA_ID],
        rules: [],
      },
    });

    await expect(
      service.resolveReadScope({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: userAuthContext,
      }),
    ).resolves.toEqual({ kind: 'denied' });
  });

  it('returns all-records for the matching allRecords policy', async () => {
    const { service } = buildService({ policy: buildPolicy('allRecords') });

    await expect(
      service.resolveReadScope({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: userAuthContext,
      }),
    ).resolves.toEqual({ kind: 'all-records' });
  });

  it('renders an owner-scoped correlated EXISTS condition', async () => {
    const { service } = buildService();
    const condition = await service.buildAuthorizedRecordExistsCondition({
      workspaceId: WORKSPACE_ID,
      objectMetadataId: OBJECT_METADATA_ID,
      authContext: userAuthContext,
      recordIdReference: {
        tableAlias: 'conversation',
        columnName: 'linkedRecordId',
      },
    });

    expect(condition.scope).toEqual({ kind: 'owner-scoped' });
    expect(condition.sql).toContain('EXISTS (SELECT 1 FROM');
    expect(condition.sql).toContain('"conversation"."linkedRecordId"');
    expect(condition.sql).toContain('"deletedAt" IS NULL');
    expect(condition.sql).toContain('"ownerId" IN');
    expect(Object.values(condition.parameters)).toContainEqual([
      WORKSPACE_MEMBER_ID,
    ]);
  });

  it('expands an owner scope from authoritative Team maps for a coordinator', async () => {
    const { service } = buildService({
      policy: buildPolicy('ownAndTeamRecords'),
    });
    const condition = await service.buildAuthorizedRecordExistsCondition({
      workspaceId: WORKSPACE_ID,
      objectMetadataId: OBJECT_METADATA_ID,
      authContext: userAuthContext,
      recordIdReference: {
        tableAlias: 'conversation',
        columnName: 'linkedRecordId',
      },
    });

    expect(condition.scope).toEqual({ kind: 'owner-scoped' });
    expect(Object.values(condition.parameters)).toContainEqual([
      WORKSPACE_MEMBER_ID,
      TEAM_MEMBER_ID,
    ]);
  });

  it.each([
    [
      'invalid policy',
      { policy: { status: 'invalid', reason: 'corrupt policy' } },
    ],
    [
      'unavailable Team map',
      { policy: buildPolicy('ownAndTeamRecords'), teamCacheFailure: true },
    ],
    ['unavailable metadata cache', { initialCacheFailure: true }],
    ['invalid metadata workspace', { metadataWorkspaceId: OTHER_WORKSPACE_ID }],
    ['invalid actor', { workspaceMemberFailure: true }],
  ] as const)('fails closed for %s', async (_caseName, options) => {
    const { service } = buildService(options);

    await expect(
      service.resolveReadScope({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: userAuthContext,
      }),
    ).resolves.toEqual({ kind: 'denied' });
  });

  it('denies a cross-workspace auth context', async () => {
    const { service } = buildService();

    await expect(
      service.resolveReadScope({
        workspaceId: OTHER_WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        authContext: userAuthContext,
      }),
    ).resolves.toEqual({ kind: 'denied' });
  });

  it('checks record existence and soft-deletion in SQL and denies an empty result', async () => {
    const { service, queryBuilder } = buildService({ rawRecord: null });

    await expect(
      service.isRecordReadable({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        recordId: 'missing-or-soft-deleted-record',
        authContext: userAuthContext,
      }),
    ).resolves.toBe(false);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('"id" = :recordId'),
      { recordId: 'missing-or-soft-deleted-record' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"deletedAt" IS NULL'),
    );
  });

  it('preserves safely escaped dynamic schema and table identifiers', () => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: 'postgres://unused:unused@localhost:5432/unused',
    });
    const sql = dataSource
      .createQueryBuilder()
      .select('1')
      .from('workspace_test._lead', 'record')
      .getQuery();

    expect(sql).toContain('FROM "workspace_test"."_lead" "record"');
  });
});
