import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { type InconnectCommercialTeamService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team.service';
import { InconnectCommercialTeamSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team-settings.service';
import { type InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

const WORKSPACE_A_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B_ID = '00000000-0000-4000-8000-000000000002';
const TEAM_NORTH_ID = '00000000-0000-4000-8000-000000000010';
const TEAM_SOUTH_ID = '00000000-0000-4000-8000-000000000011';
const TIM_ID = '00000000-0000-4000-8000-000000000020';
const SCOTT_ID = '00000000-0000-4000-8000-000000000021';
const JANE_ID = '00000000-0000-4000-8000-000000000022';

const buildHarness = ({
  teams = [],
  memberships = [],
}: {
  teams?: InconnectCommercialTeamEntity[];
  memberships?: InconnectCommercialTeamMembershipEntity[];
}) => {
  const query = jest.fn().mockResolvedValue(undefined);
  const teamFind = jest.fn().mockResolvedValue(teams);
  const membershipFind = jest.fn().mockResolvedValue(memberships);
  const manager = {
    query,
    getRepository: jest.fn((entity: unknown) => ({
      find:
        entity === InconnectCommercialTeamEntity ? teamFind : membershipFind,
    })),
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolation: string,
      operation: (entityManager: EntityManager) => Promise<unknown>,
    ) => operation(manager),
  );
  const getWorkspaceMemberProfiles = jest.fn().mockResolvedValue(
    new Map([
      [
        TIM_ID,
        {
          id: TIM_ID,
          firstName: 'Tim',
          lastName: 'Apple',
          email: 'tim@apple.dev',
          isAssignable: true,
        },
      ],
      [
        SCOTT_ID,
        {
          id: SCOTT_ID,
          firstName: 'Scott',
          lastName: 'Forstall',
          email: 'scott@apple.dev',
          isAssignable: false,
        },
      ],
    ]),
  );
  const getAssignableWorkspaceMemberProfiles = jest.fn().mockResolvedValue([
    {
      id: TIM_ID,
      firstName: 'Tim',
      lastName: 'Apple',
      email: 'tim@apple.dev',
      isAssignable: true,
    },
    {
      id: JANE_ID,
      firstName: 'Jane',
      lastName: 'Austen',
      email: 'jane@apple.dev',
      isAssignable: true,
    },
  ]);
  const commercialTeamService = {
    createTeam: jest.fn().mockResolvedValue({
      result: { id: TEAM_NORTH_ID },
      cacheStatus: 'recomputed',
    }),
    renameTeam: jest.fn().mockResolvedValue({
      result: { id: TEAM_NORTH_ID },
      cacheStatus: 'recomputed',
    }),
    assignCoordinator: jest.fn().mockResolvedValue({
      result: {
        id: '00000000-0000-4000-8000-000000000030',
        teamId: TEAM_NORTH_ID,
      },
      cacheStatus: 'recomputed',
    }),
    addExecutive: jest.fn().mockResolvedValue({
      result: {
        id: '00000000-0000-4000-8000-000000000031',
        teamId: TEAM_NORTH_ID,
      },
      cacheStatus: 'recomputed',
    }),
    removeExecutive: jest.fn().mockResolvedValue({
      result: undefined,
      cacheStatus: 'recomputed',
    }),
    moveMember: jest.fn().mockResolvedValue({
      result: {
        id: '00000000-0000-4000-8000-000000000031',
        teamId: TEAM_SOUTH_ID,
      },
      cacheStatus: 'recomputed',
    }),
    deleteTeam: jest.fn().mockResolvedValue({
      result: undefined,
      cacheStatus: 'recomputed',
    }),
  };
  const service = new InconnectCommercialTeamSettingsService(
    { transaction } as unknown as DataSource,
    commercialTeamService as unknown as InconnectCommercialTeamService,
    {
      getWorkspaceMemberProfiles,
      getAssignableWorkspaceMemberProfiles,
    } as unknown as InconnectWorkspaceMemberService,
  );

  return {
    commercialTeamService,
    getAssignableWorkspaceMemberProfiles,
    getWorkspaceMemberProfiles,
    membershipFind,
    query,
    service,
    teamFind,
    transaction,
  };
};

const northTeam = {
  id: TEAM_NORTH_ID,
  workspaceId: WORKSPACE_A_ID,
  name: 'Equipo Norte',
  deletedAt: null,
} as InconnectCommercialTeamEntity;

const northMemberships = [
  {
    id: '00000000-0000-4000-8000-000000000030',
    workspaceId: WORKSPACE_A_ID,
    teamId: TEAM_NORTH_ID,
    workspaceMemberId: TIM_ID,
    membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
    deletedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000031',
    workspaceId: WORKSPACE_A_ID,
    teamId: TEAM_NORTH_ID,
    workspaceMemberId: SCOTT_ID,
    membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
    deletedAt: null,
  },
] as InconnectCommercialTeamMembershipEntity[];

describe('InconnectCommercialTeamSettingsService', () => {
  it('reads active teams and memberships in one read-only repeatable-read snapshot', async () => {
    const harness = buildHarness({
      teams: [northTeam],
      memberships: northMemberships,
    });

    await expect(harness.service.getTeams(WORKSPACE_A_ID)).resolves.toEqual([
      {
        id: TEAM_NORTH_ID,
        name: 'Equipo Norte',
        coordinator: {
          membershipId: northMemberships[0].id,
          workspaceMemberId: TIM_ID,
          displayName: 'Tim Apple',
          email: 'tim@apple.dev',
          isAssignable: true,
        },
        executives: [
          {
            membershipId: northMemberships[1].id,
            workspaceMemberId: SCOTT_ID,
            displayName: 'Scott Forstall',
            email: 'scott@apple.dev',
            isAssignable: false,
          },
        ],
      },
    ]);
    expect(harness.transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(harness.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(harness.teamFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: WORKSPACE_A_ID }),
      }),
    );
    expect(harness.membershipFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: WORKSPACE_A_ID }),
      }),
    );
    expect(harness.getWorkspaceMemberProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        workspaceMemberIds: [TIM_ID, SCOTT_ID],
      }),
    );
  });

  it('lists only assignable members and includes their current active membership', async () => {
    const harness = buildHarness({
      teams: [northTeam],
      memberships: northMemberships,
    });

    await expect(
      harness.service.getAvailableMembers(WORKSPACE_A_ID),
    ).resolves.toEqual([
      {
        workspaceMemberId: JANE_ID,
        displayName: 'Jane Austen',
        email: 'jane@apple.dev',
        currentTeamId: null,
        currentMembershipType: null,
      },
      {
        workspaceMemberId: TIM_ID,
        displayName: 'Tim Apple',
        email: 'tim@apple.dev',
        currentTeamId: TEAM_NORTH_ID,
        currentMembershipType:
          InconnectCommercialTeamMembershipType.COORDINATOR,
      },
    ]);
    expect(harness.getAssignableWorkspaceMemberProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID }),
    );
  });

  it('fails closed when an active membership references an inactive team', async () => {
    const harness = buildHarness({
      teams: [],
      memberships: northMemberships,
    });

    await expect(harness.service.getTeams(WORKSPACE_A_ID)).rejects.toThrow(
      'inactive team',
    );
  });

  it('delegates every mutation with the trusted workspace and never accepts a separate workspace source', async () => {
    const harness = buildHarness({});

    const results = [];
    results.push(
      await harness.service.createTeam({
        workspaceId: WORKSPACE_A_ID,
        name: 'Equipo Norte',
      }),
    );
    results.push(
      await harness.service.renameTeam({
        workspaceId: WORKSPACE_A_ID,
        teamId: TEAM_NORTH_ID,
        name: 'Equipo Centro',
      }),
    );
    results.push(
      await harness.service.assignCoordinator({
        workspaceId: WORKSPACE_A_ID,
        teamId: TEAM_NORTH_ID,
        workspaceMemberId: TIM_ID,
      }),
    );
    results.push(
      await harness.service.addExecutive({
        workspaceId: WORKSPACE_A_ID,
        teamId: TEAM_NORTH_ID,
        workspaceMemberId: SCOTT_ID,
      }),
    );
    results.push(
      await harness.service.removeExecutive({
        workspaceId: WORKSPACE_A_ID,
        teamId: TEAM_NORTH_ID,
        workspaceMemberId: SCOTT_ID,
      }),
    );
    results.push(
      await harness.service.moveMember({
        workspaceId: WORKSPACE_A_ID,
        workspaceMemberId: SCOTT_ID,
        targetTeamId: TEAM_SOUTH_ID,
      }),
    );
    results.push(
      await harness.service.deleteTeam({
        workspaceId: WORKSPACE_A_ID,
        teamId: TEAM_NORTH_ID,
      }),
    );

    expect(results).toHaveLength(7);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cacheStatus: 'recomputed' }),
      ]),
    );
    expect(
      results.every(({ cacheStatus }) => cacheStatus === 'recomputed'),
    ).toBe(true);

    expect(harness.commercialTeamService.createTeam).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });
    expect(
      harness.commercialTeamService.assignCoordinator,
    ).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A_ID,
      teamId: TEAM_NORTH_ID,
      workspaceMemberId: TIM_ID,
    });
    expect(harness.commercialTeamService.removeExecutive).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A_ID,
      teamId: TEAM_NORTH_ID,
      workspaceMemberId: SCOTT_ID,
    });
    expect(harness.commercialTeamService.moveMember).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A_ID,
      workspaceMemberId: SCOTT_ID,
      targetTeamId: TEAM_SOUTH_ID,
    });
  });

  it('returns post-commit cache failure as success and refetches the persisted state', async () => {
    const persistedTeams: InconnectCommercialTeamEntity[] = [];
    const harness = buildHarness({ teams: persistedTeams });

    harness.commercialTeamService.createTeam.mockImplementationOnce(
      async ({ workspaceId, name }: { workspaceId: string; name: string }) => {
        const team = {
          id: TEAM_NORTH_ID,
          workspaceId,
          name,
          deletedAt: null,
        } as InconnectCommercialTeamEntity;

        persistedTeams.push(team);
        harness.teamFind.mockResolvedValue(persistedTeams);

        return {
          result: team,
          cacheStatus: 'recomputation-failed',
        };
      },
    );

    await expect(
      harness.service.createTeam({
        workspaceId: WORKSPACE_A_ID,
        name: 'Equipo Norte',
      }),
    ).resolves.toEqual({
      teamId: TEAM_NORTH_ID,
      membershipId: null,
      cacheStatus: 'recomputation-failed',
    });

    await expect(harness.service.getTeams(WORKSPACE_A_ID)).resolves.toEqual([
      {
        id: TEAM_NORTH_ID,
        name: 'Equipo Norte',
        coordinator: null,
        executives: [],
      },
    ]);
  });

  it('keeps workspace A reads isolated even when valid workspace B IDs exist', async () => {
    const harness = buildHarness({});

    await harness.service.getTeams(WORKSPACE_A_ID);

    expect(harness.teamFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
        }),
      }),
    );
    expect(harness.teamFind).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_B_ID,
        }),
      }),
    );
  });
});
