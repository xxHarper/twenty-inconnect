import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { type InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { WorkspaceInconnectTeamAccessMapsCacheService } from 'src/engine/core-modules/inconnect-record-access/services/workspace-inconnect-team-access-maps-cache.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

const WORKSPACE_A_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B_ID = '00000000-0000-4000-8000-000000000002';
const TEAM_A_ID = '00000000-0000-4000-8000-000000000101';
const TEAM_B_ID = '00000000-0000-4000-8000-000000000102';
const MEMBER_A_ID = '00000000-0000-4000-8000-000000000201';
const MEMBER_B_ID = '00000000-0000-4000-8000-000000000202';

type TeamFixture = {
  id: string;
  workspaceId: string;
  deletedAt: Date | null;
};

type MembershipFixture = {
  id: string;
  workspaceId: string;
  teamId: string;
  workspaceMemberId: string;
  membershipType: InconnectCommercialTeamMembershipType;
  deletedAt: Date | null;
};

const buildService = ({
  teams,
  memberships,
  existingWorkspaceMemberIds,
  assignableWorkspaceMemberIds,
}: {
  teams: TeamFixture[];
  memberships: MembershipFixture[];
  existingWorkspaceMemberIds: Set<string>;
  assignableWorkspaceMemberIds: Set<string>;
}) => {
  const query = jest.fn().mockResolvedValue(undefined);
  const getRepository = jest.fn((entity) => ({
    find: jest.fn(async ({ where }: { where: { workspaceId: string } }) =>
      entity === InconnectCommercialTeamEntity
        ? teams.filter((team) => team.workspaceId === where.workspaceId)
        : memberships.filter(
            (membership) =>
              membership.workspaceId === where.workspaceId &&
              membership.deletedAt === null,
          ),
    ),
  }));
  const manager = { getRepository, query } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolation: string,
      operation: (transactionManager: EntityManager) => unknown,
    ) => {
      expect(isolation).toBe('REPEATABLE READ');

      return operation(manager);
    },
  );
  const dataSource = { transaction } as unknown as DataSource;
  const workspaceMemberService = {
    getWorkspaceMemberStates: jest.fn(
      async ({ workspaceMemberIds }: { workspaceMemberIds: string[] }) =>
        new Map(
          workspaceMemberIds
            .filter((workspaceMemberId) =>
              existingWorkspaceMemberIds.has(workspaceMemberId),
            )
            .map((workspaceMemberId) => [
              workspaceMemberId,
              {
                id: workspaceMemberId,
                isAssignable:
                  assignableWorkspaceMemberIds.has(workspaceMemberId),
              },
            ]),
        ),
    ),
  } as unknown as InconnectWorkspaceMemberService;

  return {
    query,
    service: new WorkspaceInconnectTeamAccessMapsCacheService(
      dataSource,
      workspaceMemberService,
    ),
    transaction,
  };
};

describe('WorkspaceInconnectTeamAccessMapsCacheService', () => {
  it('builds historical record-scope and assignable-member maps separately in one read-only snapshot', async () => {
    const { query, service, transaction } = buildService({
      teams: [{ id: TEAM_A_ID, workspaceId: WORKSPACE_A_ID, deletedAt: null }],
      memberships: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
          deletedAt: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000302',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_B_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
      ],
      existingWorkspaceMemberIds: new Set([MEMBER_A_ID, MEMBER_B_ID]),
      assignableWorkspaceMemberIds: new Set([MEMBER_A_ID]),
    });

    await expect(service.computeForCache(WORKSPACE_A_ID)).resolves.toEqual({
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {
        [MEMBER_A_ID]: {
          teamId: TEAM_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
          isWorkspaceMemberAssignable: true,
        },
        [MEMBER_B_ID]: {
          teamId: TEAM_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          isWorkspaceMemberAssignable: false,
        },
      },
      memberWorkspaceMemberIdsByTeamId: {
        [TEAM_A_ID]: [MEMBER_A_ID, MEMBER_B_ID],
      },
      assignableMemberWorkspaceMemberIdsByTeamId: {
        [TEAM_A_ID]: [MEMBER_A_ID],
      },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
  });

  it('keeps cache entries isolated by workspace', async () => {
    const { service } = buildService({
      teams: [
        { id: TEAM_A_ID, workspaceId: WORKSPACE_A_ID, deletedAt: null },
        { id: TEAM_B_ID, workspaceId: WORKSPACE_B_ID, deletedAt: null },
      ],
      memberships: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000302',
          workspaceId: WORKSPACE_B_ID,
          teamId: TEAM_B_ID,
          workspaceMemberId: MEMBER_B_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
      ],
      existingWorkspaceMemberIds: new Set([MEMBER_A_ID, MEMBER_B_ID]),
      assignableWorkspaceMemberIds: new Set([MEMBER_A_ID, MEMBER_B_ID]),
    });

    const workspaceAMaps = await service.computeForCache(WORKSPACE_A_ID);

    expect(workspaceAMaps).toMatchObject({
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: { [MEMBER_A_ID]: expect.any(Object) },
    });
    expect(
      workspaceAMaps.status === 'valid' &&
        workspaceAMaps.membershipByWorkspaceMemberId[MEMBER_B_ID],
    ).toBeUndefined();
  });

  it('returns invalid when an active membership references a soft-deleted Team', async () => {
    const { service } = buildService({
      teams: [
        {
          id: TEAM_A_ID,
          workspaceId: WORKSPACE_A_ID,
          deletedAt: new Date(),
        },
      ],
      memberships: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
      ],
      existingWorkspaceMemberIds: new Set([MEMBER_A_ID]),
      assignableWorkspaceMemberIds: new Set([MEMBER_A_ID]),
    });

    await expect(
      service.computeForCache(WORKSPACE_A_ID),
    ).resolves.toMatchObject({
      version: 1,
      status: 'invalid',
    });
  });

  it('returns invalid for missing Workspace Member and duplicate active membership data', async () => {
    const missingMemberService = buildService({
      teams: [{ id: TEAM_A_ID, workspaceId: WORKSPACE_A_ID, deletedAt: null }],
      memberships: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
      ],
      existingWorkspaceMemberIds: new Set(),
      assignableWorkspaceMemberIds: new Set(),
    });
    const duplicateService = buildService({
      teams: [
        { id: TEAM_A_ID, workspaceId: WORKSPACE_A_ID, deletedAt: null },
        { id: TEAM_B_ID, workspaceId: WORKSPACE_A_ID, deletedAt: null },
      ],
      memberships: [
        {
          id: '00000000-0000-4000-8000-000000000301',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_A_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000302',
          workspaceId: WORKSPACE_A_ID,
          teamId: TEAM_B_ID,
          workspaceMemberId: MEMBER_A_ID,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
          deletedAt: null,
        },
      ],
      existingWorkspaceMemberIds: new Set([MEMBER_A_ID]),
      assignableWorkspaceMemberIds: new Set([MEMBER_A_ID]),
    });

    await expect(
      missingMemberService.service.computeForCache(WORKSPACE_A_ID),
    ).resolves.toMatchObject({ status: 'invalid' });
    await expect(
      duplicateService.service.computeForCache(WORKSPACE_A_ID),
    ).resolves.toMatchObject({ status: 'invalid' });
  });

  it('represents a workspace without teams as a valid empty map, never allRecords', async () => {
    const { service } = buildService({
      teams: [],
      memberships: [],
      existingWorkspaceMemberIds: new Set(),
      assignableWorkspaceMemberIds: new Set(),
    });

    await expect(service.computeForCache(WORKSPACE_A_ID)).resolves.toEqual({
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {},
      memberWorkspaceMemberIdsByTeamId: {},
      assignableMemberWorkspaceMemberIdsByTeamId: {},
    });
  });
});
