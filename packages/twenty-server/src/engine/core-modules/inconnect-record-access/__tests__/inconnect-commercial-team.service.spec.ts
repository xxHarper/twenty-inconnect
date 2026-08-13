import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { InconnectCommercialTeamService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team.service';
import { type InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_A_ID = 'workspace-a-id';
const WORKSPACE_B_ID = 'workspace-b-id';
const SCOTT_ID = 'scott-id';
const TIM_ID = 'tim-id';

type StoredTeam = InconnectCommercialTeamEntity;
type StoredMembership = InconnectCommercialTeamMembershipEntity;

const matchesWhere = (
  value: object,
  where: Record<string, unknown>,
): boolean => {
  const indexedValue = value as Record<string, unknown>;

  return Object.entries(where).every(([key, expected]) => {
    if (
      typeof expected === 'object' &&
      expected !== null &&
      '_type' in expected
    ) {
      const findOperator = expected as {
        _type: string;
        _value?: unknown[];
      };

      if (findOperator._type === 'isNull') {
        return indexedValue[key] === null;
      }

      if (findOperator._type === 'in') {
        return findOperator._value?.includes(indexedValue[key]);
      }
    }

    return indexedValue[key] === expected;
  });
};

const buildHarness = () => {
  const teams: StoredTeam[] = [];
  const memberships: StoredMembership[] = [];
  let teamSequence = 0;
  let membershipSequence = 0;

  const teamRepository = {
    save: jest.fn(async (input: Partial<StoredTeam>) => {
      const normalizedName = input.name?.trim().toLocaleLowerCase();
      const duplicate = teams.find(
        (team) =>
          team.workspaceId === input.workspaceId &&
          team.normalizedName === normalizedName &&
          team.deletedAt === null &&
          team.id !== input.id,
      );

      if (duplicate) {
        throw new Error('duplicate team name');
      }

      const existing = teams.find((team) => team.id === input.id);

      if (existing) {
        Object.assign(existing, input, {
          normalizedName,
          updatedAt: new Date(),
        });

        return existing;
      }

      const team = {
        id: `team-${++teamSequence}`,
        workspaceId: input.workspaceId,
        name: input.name,
        normalizedName,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as StoredTeam;

      teams.push(team);

      return team;
    }),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        teams.find((team) => matchesWhere(team, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      teams.filter((team) => matchesWhere(team, where)),
    ),
    update: jest.fn(
      async (where: Record<string, unknown>, values: Partial<StoredTeam>) => {
        teams
          .filter((team) => matchesWhere(team, where))
          .forEach((team) => Object.assign(team, values));
      },
    ),
  };
  const membershipRepository = {
    save: jest.fn(async (input: Partial<StoredMembership>) => {
      const existing = memberships.find(
        (membership) => membership.id === input.id,
      );

      if (existing) {
        Object.assign(existing, input, { updatedAt: new Date() });

        return existing;
      }

      if (
        memberships.some(
          (membership) =>
            membership.workspaceId === input.workspaceId &&
            membership.workspaceMemberId === input.workspaceMemberId &&
            membership.deletedAt === null,
        )
      ) {
        throw new Error('duplicate active member');
      }

      if (
        input.membershipType ===
          InconnectCommercialTeamMembershipType.COORDINATOR &&
        memberships.some(
          (membership) =>
            membership.teamId === input.teamId &&
            membership.membershipType ===
              InconnectCommercialTeamMembershipType.COORDINATOR &&
            membership.deletedAt === null,
        )
      ) {
        throw new Error('duplicate active coordinator');
      }

      const membership = {
        id: `membership-${++membershipSequence}`,
        workspaceId: input.workspaceId,
        teamId: input.teamId,
        workspaceMemberId: input.workspaceMemberId,
        membershipType: input.membershipType,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as StoredMembership;

      memberships.push(membership);

      return membership;
    }),
    findOne: jest.fn(
      async ({
        where,
        relations,
      }: {
        where: Record<string, unknown>;
        relations?: { team?: boolean };
      }) => {
        const membership = memberships.find((item) =>
          matchesWhere(item, where),
        );

        if (membership && relations?.team) {
          membership.team = teams.find(
            (team) => team.id === membership.teamId,
          ) as StoredTeam;
        }

        return membership ?? null;
      },
    ),
    find: jest.fn(
      async ({
        where,
      }: {
        where: Record<string, unknown> | Record<string, unknown>[];
      }) =>
        memberships.filter((membership) =>
          (Array.isArray(where) ? where : [where]).some((criteria) =>
            matchesWhere(membership, criteria),
          ),
        ),
    ),
    update: jest.fn(
      async (
        where: Record<string, unknown>,
        values: Partial<StoredMembership>,
      ) => {
        memberships
          .filter((membership) => matchesWhere(membership, where))
          .forEach((membership) => Object.assign(membership, values));
      },
    ),
  };
  const getRepository = (entity: unknown) =>
    entity === InconnectCommercialTeamEntity
      ? teamRepository
      : membershipRepository;
  const manager = { getRepository } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      async (operation: (transactionManager: EntityManager) => unknown) =>
        operation(manager),
    ),
    getRepository,
  } as unknown as DataSource;
  const activeMembersByWorkspace = new Map([
    [WORKSPACE_A_ID, new Set([SCOTT_ID, TIM_ID])],
    [WORKSPACE_B_ID, new Set([SCOTT_ID])],
  ]);
  const workspaceMemberService = {
    assertAssignableWorkspaceMember: jest.fn(
      async ({
        workspaceId,
        workspaceMemberId,
      }: {
        workspaceId: string;
        workspaceMemberId: string;
      }) => {
        if (
          !activeMembersByWorkspace.get(workspaceId)?.has(workspaceMemberId)
        ) {
          throw new Error('invalid workspace member');
        }
      },
    ),
  } as unknown as InconnectWorkspaceMemberService;
  const workspaceCacheService = {
    revokeGenerationFencedEntries: jest.fn().mockResolvedValue({
      inconnectTeamAccessMaps: 1,
    }),
    recomputeGenerationFencedEntries: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceCacheService;
  const service = new InconnectCommercialTeamService(
    dataSource,
    workspaceMemberService,
    workspaceCacheService,
  );

  return {
    service,
    teams,
    memberships,
    activeMembersByWorkspace,
    workspaceCacheService,
    teamRepository,
    membershipRepository,
  };
};

describe('InconnectCommercialTeamService', () => {
  it('creates, renames and soft-deletes a team while invalidating its workspace cache', async () => {
    const harness = buildHarness();
    const team = await harness.service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: '  Equipo Norte  ',
    });

    expect(team).toMatchObject({
      name: 'Equipo Norte',
      normalizedName: 'equipo norte',
    });

    const renamed = await harness.service.renameTeam({
      workspaceId: WORKSPACE_A_ID,
      teamId: team.id,
      name: 'Equipo Centro',
    });

    expect(renamed.normalizedName).toBe('equipo centro');

    await harness.service.deleteTeam({
      workspaceId: WORKSPACE_A_ID,
      teamId: team.id,
    });

    expect(team.deletedAt).toBeInstanceOf(Date);
    expect(
      harness.workspaceCacheService.revokeGenerationFencedEntries,
    ).toHaveBeenCalledTimes(3);
    expect(
      harness.workspaceCacheService.revokeGenerationFencedEntries,
    ).toHaveBeenLastCalledWith(
      WORKSPACE_A_ID,
      ['inconnectTeamAccessMaps'],
      expect.any(String),
    );
    expect(
      harness.workspaceCacheService.recomputeGenerationFencedEntries,
    ).toHaveBeenCalledTimes(3);
  });

  it('rejects a case-insensitive duplicate name in one workspace but permits it in another', async () => {
    const { service } = buildHarness();

    await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });

    await expect(
      service.createTeam({
        workspaceId: WORKSPACE_A_ID,
        name: ' equipo NORTE ',
      }),
    ).rejects.toThrow('duplicate team name');
    await expect(
      service.createTeam({
        workspaceId: WORKSPACE_B_ID,
        name: 'equipo norte',
      }),
    ).resolves.toBeDefined();
  });

  it('adds members, changes coordinator atomically and keeps one active coordinator', async () => {
    const { service, memberships } = buildHarness();
    const team = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });

    await service.assignCoordinator({
      workspaceId: WORKSPACE_A_ID,
      teamId: team.id,
      workspaceMemberId: SCOTT_ID,
    });
    await service.addExecutive({
      workspaceId: WORKSPACE_A_ID,
      teamId: team.id,
      workspaceMemberId: TIM_ID,
    });
    await service.assignCoordinator({
      workspaceId: WORKSPACE_A_ID,
      teamId: team.id,
      workspaceMemberId: TIM_ID,
    });

    expect(
      memberships.filter(
        (membership) =>
          membership.deletedAt === null &&
          membership.membershipType ===
            InconnectCommercialTeamMembershipType.COORDINATOR,
      ),
    ).toHaveLength(1);
    expect(
      memberships.find(
        (membership) => membership.workspaceMemberId === SCOTT_ID,
      )?.membershipType,
    ).toBe(InconnectCommercialTeamMembershipType.EXECUTIVE);
  });

  it('rejects a second active team for a Workspace Member and supports an atomic move', async () => {
    const { service, teamRepository } = buildHarness();
    const firstTeam = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });
    const secondTeam = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Sur',
    });

    await service.addExecutive({
      workspaceId: WORKSPACE_A_ID,
      teamId: firstTeam.id,
      workspaceMemberId: SCOTT_ID,
    });
    await expect(
      service.addExecutive({
        workspaceId: WORKSPACE_A_ID,
        teamId: secondTeam.id,
        workspaceMemberId: SCOTT_ID,
      }),
    ).rejects.toThrow();

    const moved = await service.moveMember({
      workspaceId: WORKSPACE_A_ID,
      workspaceMemberId: SCOTT_ID,
      targetTeamId: secondTeam.id,
    });

    expect(moved.teamId).toBe(secondTeam.id);
    expect(teamRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      }),
    );
  });

  it('allows membership again after soft removal', async () => {
    const { service } = buildHarness();
    const firstTeam = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });
    const secondTeam = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Sur',
    });

    await service.addExecutive({
      workspaceId: WORKSPACE_A_ID,
      teamId: firstTeam.id,
      workspaceMemberId: SCOTT_ID,
    });
    await service.removeMember({
      workspaceId: WORKSPACE_A_ID,
      workspaceMemberId: SCOTT_ID,
    });

    await expect(
      service.addExecutive({
        workspaceId: WORKSPACE_A_ID,
        teamId: secondTeam.id,
        workspaceMemberId: SCOTT_ID,
      }),
    ).resolves.toMatchObject({ teamId: secondTeam.id });
  });

  it('rejects a Workspace Member that does not belong to the target workspace', async () => {
    const { service, activeMembersByWorkspace } = buildHarness();
    const team = await service.createTeam({
      workspaceId: WORKSPACE_A_ID,
      name: 'Equipo Norte',
    });

    activeMembersByWorkspace.get(WORKSPACE_A_ID)?.delete(TIM_ID);

    await expect(
      service.addExecutive({
        workspaceId: WORKSPACE_A_ID,
        teamId: team.id,
        workspaceMemberId: TIM_ID,
      }),
    ).rejects.toThrow('invalid workspace member');
  });

  it('keeps the committed result while a failed recomputation leaves cache revoked', async () => {
    const { service, workspaceCacheService } = buildHarness();

    (
      workspaceCacheService.recomputeGenerationFencedEntries as jest.Mock
    ).mockRejectedValueOnce(new Error('cache unavailable'));

    await expect(
      service.createTeam({
        workspaceId: WORKSPACE_A_ID,
        name: 'Equipo Norte',
      }),
    ).resolves.toBeDefined();
    expect(
      workspaceCacheService.revokeGenerationFencedEntries,
    ).toHaveBeenCalledTimes(1);
  });

  it('adds active-Team predicates to both membership getters', async () => {
    const { service, membershipRepository } = buildHarness();

    await service.getTeamForWorkspaceMember({
      workspaceId: WORKSPACE_A_ID,
      workspaceMemberId: SCOTT_ID,
    });
    await service.getMembersForTeam({
      workspaceId: WORKSPACE_A_ID,
      teamId: 'team-id',
    });

    expect(membershipRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          team: expect.objectContaining({ workspaceId: WORKSPACE_A_ID }),
        }),
      }),
    );
    expect(membershipRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          team: expect.objectContaining({ workspaceId: WORKSPACE_A_ID }),
        }),
      }),
    );
  });
});
