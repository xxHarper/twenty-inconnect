import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type EntityManager, In, IsNull } from 'typeorm';

import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import {
  InconnectCommercialTeamException,
  InconnectCommercialTeamExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team.exception';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import {
  type WorkspaceCacheGenerations,
  WorkspaceCacheService,
} from 'src/engine/workspace-cache/services/workspace-cache.service';

type TeamIdentity = { workspaceId: string; teamId: string };
type MemberIdentity = { workspaceId: string; workspaceMemberId: string };

@Injectable()
export class InconnectCommercialTeamService {
  private readonly logger = new Logger(InconnectCommercialTeamService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly workspaceMemberService: InconnectWorkspaceMemberService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async createTeam({
    workspaceId,
    name,
  }: {
    workspaceId: string;
    name: string;
  }): Promise<InconnectCommercialTeamEntity> {
    const team = await this.runTransactionAndInvalidate(
      workspaceId,
      async (manager) => {
        const normalizedName = this.normalizeTeamName(name);

        return manager.getRepository(InconnectCommercialTeamEntity).save({
          workspaceId,
          name: normalizedName,
        });
      },
    );

    return team;
  }

  async renameTeam({
    workspaceId,
    teamId,
    name,
  }: TeamIdentity & { name: string }): Promise<InconnectCommercialTeamEntity> {
    return this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      const team = await this.getActiveTeamOrThrow({
        manager,
        workspaceId,
        teamId,
        lock: true,
      });
      const normalizedName = this.normalizeTeamName(name);

      team.name = normalizedName;

      return manager.getRepository(InconnectCommercialTeamEntity).save(team);
    });
  }

  async deleteTeam({ workspaceId, teamId }: TeamIdentity): Promise<void> {
    await this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      await this.getActiveTeamOrThrow({
        manager,
        workspaceId,
        teamId,
        lock: true,
      });

      const deletedAt = new Date();

      await manager
        .getRepository(InconnectCommercialTeamMembershipEntity)
        .update({ workspaceId, teamId, deletedAt: IsNull() }, { deletedAt });
      await manager
        .getRepository(InconnectCommercialTeamEntity)
        .update(
          { workspaceId, id: teamId, deletedAt: IsNull() },
          { deletedAt },
        );
    });
  }

  async addExecutive({
    workspaceId,
    teamId,
    workspaceMemberId,
  }: TeamIdentity &
    MemberIdentity): Promise<InconnectCommercialTeamMembershipEntity> {
    return this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      await this.getActiveTeamOrThrow({
        manager,
        workspaceId,
        teamId,
        lock: true,
      });
      await this.assertMemberHasNoActiveMembership({
        manager,
        workspaceId,
        workspaceMemberId,
      });
      await this.workspaceMemberService.assertAssignableWorkspaceMember({
        manager,
        workspaceId,
        workspaceMemberId,
      });

      return manager
        .getRepository(InconnectCommercialTeamMembershipEntity)
        .save({
          workspaceId,
          teamId,
          workspaceMemberId,
          membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
        });
    });
  }

  async assignCoordinator({
    workspaceId,
    teamId,
    workspaceMemberId,
  }: TeamIdentity &
    MemberIdentity): Promise<InconnectCommercialTeamMembershipEntity> {
    return this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      await this.getActiveTeamOrThrow({
        manager,
        workspaceId,
        teamId,
        lock: true,
      });
      const repository = manager.getRepository(
        InconnectCommercialTeamMembershipEntity,
      );
      const memberships = await repository.find({
        where: [
          { workspaceId, teamId, deletedAt: IsNull() },
          { workspaceId, workspaceMemberId, deletedAt: IsNull() },
        ],
        lock: { mode: 'pessimistic_write' },
      });
      const targetMembership = memberships.find(
        (membership) => membership.workspaceMemberId === workspaceMemberId,
      );

      if (targetMembership && targetMembership.teamId !== teamId) {
        throw new InconnectCommercialTeamException(
          'Workspace Member already belongs to another commercial team',
          InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
        );
      }

      if (
        targetMembership?.membershipType ===
        InconnectCommercialTeamMembershipType.COORDINATOR
      ) {
        return targetMembership;
      }

      await this.workspaceMemberService.assertAssignableWorkspaceMember({
        manager,
        workspaceId,
        workspaceMemberId,
      });

      const currentCoordinator = memberships.find(
        (membership) =>
          membership.teamId === teamId &&
          membership.membershipType ===
            InconnectCommercialTeamMembershipType.COORDINATOR,
      );

      if (currentCoordinator) {
        currentCoordinator.membershipType =
          InconnectCommercialTeamMembershipType.EXECUTIVE;
        await repository.save(currentCoordinator);
      }

      if (targetMembership) {
        targetMembership.membershipType =
          InconnectCommercialTeamMembershipType.COORDINATOR;

        return repository.save(targetMembership);
      }

      return repository.save({
        workspaceId,
        teamId,
        workspaceMemberId,
        membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
      });
    });
  }

  async removeMember({
    workspaceId,
    workspaceMemberId,
  }: MemberIdentity): Promise<void> {
    await this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      const membershipSnapshot = await this.getActiveMembershipOrThrow({
        manager,
        workspaceId,
        workspaceMemberId,
        lock: false,
      });

      await this.lockActiveTeamsInOrder({
        manager,
        workspaceId,
        teamIds: [membershipSnapshot.teamId],
      });

      const membership = await this.getActiveMembershipOrThrow({
        manager,
        workspaceId,
        workspaceMemberId,
        lock: true,
      });

      this.assertMembershipStillBelongsToTeam(
        membership,
        membershipSnapshot.teamId,
      );
      membership.deletedAt = new Date();
      await manager
        .getRepository(InconnectCommercialTeamMembershipEntity)
        .save(membership);
    });
  }

  async moveMember({
    workspaceId,
    workspaceMemberId,
    targetTeamId,
  }: MemberIdentity & {
    targetTeamId: string;
  }): Promise<InconnectCommercialTeamMembershipEntity> {
    return this.runTransactionAndInvalidate(workspaceId, async (manager) => {
      const membershipSnapshot = await this.getActiveMembershipOrThrow({
        manager,
        workspaceId,
        workspaceMemberId,
        lock: false,
      });

      await this.lockActiveTeamsInOrder({
        manager,
        workspaceId,
        teamIds: [membershipSnapshot.teamId, targetTeamId],
      });

      const membership = await this.getActiveMembershipOrThrow({
        manager,
        workspaceId,
        workspaceMemberId,
        lock: true,
      });

      this.assertMembershipStillBelongsToTeam(
        membership,
        membershipSnapshot.teamId,
      );

      if (
        membership.membershipType ===
        InconnectCommercialTeamMembershipType.COORDINATOR
      ) {
        throw new InconnectCommercialTeamException(
          'A coordinator must be reassigned explicitly',
          InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
        );
      }

      await this.workspaceMemberService.assertAssignableWorkspaceMember({
        manager,
        workspaceId,
        workspaceMemberId,
      });

      membership.teamId = targetTeamId;

      return manager
        .getRepository(InconnectCommercialTeamMembershipEntity)
        .save(membership);
    });
  }

  async getTeamForWorkspaceMember({
    workspaceId,
    workspaceMemberId,
  }: MemberIdentity): Promise<InconnectCommercialTeamEntity | null> {
    const membership = await this.dataSource
      .getRepository(InconnectCommercialTeamMembershipEntity)
      .findOne({
        where: {
          workspaceId,
          workspaceMemberId,
          deletedAt: IsNull(),
          team: { workspaceId, deletedAt: IsNull() },
        },
        relations: { team: true },
      });

    return membership?.team ?? null;
  }

  async getMembersForTeam({
    workspaceId,
    teamId,
  }: TeamIdentity): Promise<InconnectCommercialTeamMembershipEntity[]> {
    return this.dataSource
      .getRepository(InconnectCommercialTeamMembershipEntity)
      .find({
        where: {
          workspaceId,
          teamId,
          deletedAt: IsNull(),
          team: { workspaceId, deletedAt: IsNull() },
        },
        order: { createdAt: 'ASC' },
      });
  }

  private async lockActiveTeamsInOrder({
    manager,
    workspaceId,
    teamIds,
  }: {
    manager: EntityManager;
    workspaceId: string;
    teamIds: string[];
  }): Promise<void> {
    const orderedTeamIds = [...new Set(teamIds)].sort();
    const lockedTeams = await manager
      .getRepository(InconnectCommercialTeamEntity)
      .find({
        where: {
          workspaceId,
          id: In(orderedTeamIds),
          deletedAt: IsNull(),
        },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

    if (lockedTeams.length !== orderedTeamIds.length) {
      throw new InconnectCommercialTeamException(
        'Commercial team does not exist in this workspace',
        InconnectCommercialTeamExceptionCode.NOT_FOUND,
      );
    }
  }

  private assertMembershipStillBelongsToTeam(
    membership: InconnectCommercialTeamMembershipEntity,
    expectedTeamId: string,
  ): void {
    if (membership.teamId !== expectedTeamId) {
      throw new InconnectCommercialTeamException(
        'Commercial team membership changed concurrently',
        InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
      );
    }
  }

  private normalizeTeamName(name: string): string {
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      throw new InconnectCommercialTeamException(
        'Commercial team name cannot be empty',
        InconnectCommercialTeamExceptionCode.INVALID_INPUT,
      );
    }

    return trimmedName;
  }

  private async getActiveTeamOrThrow({
    manager,
    workspaceId,
    teamId,
    lock,
  }: TeamIdentity & {
    manager: EntityManager;
    lock: boolean;
  }): Promise<InconnectCommercialTeamEntity> {
    const team = await manager
      .getRepository(InconnectCommercialTeamEntity)
      .findOne({
        where: { id: teamId, workspaceId, deletedAt: IsNull() },
        lock: lock ? { mode: 'pessimistic_write' } : undefined,
      });

    if (!team) {
      throw new InconnectCommercialTeamException(
        'Commercial team does not exist in this workspace',
        InconnectCommercialTeamExceptionCode.NOT_FOUND,
      );
    }

    return team;
  }

  private async getActiveMembershipOrThrow({
    manager,
    workspaceId,
    workspaceMemberId,
    lock,
  }: MemberIdentity & {
    manager: EntityManager;
    lock: boolean;
  }): Promise<InconnectCommercialTeamMembershipEntity> {
    const membership = await manager
      .getRepository(InconnectCommercialTeamMembershipEntity)
      .findOne({
        where: { workspaceId, workspaceMemberId, deletedAt: IsNull() },
        lock: lock ? { mode: 'pessimistic_write' } : undefined,
      });

    if (!membership) {
      throw new InconnectCommercialTeamException(
        'Commercial team membership does not exist',
        InconnectCommercialTeamExceptionCode.NOT_FOUND,
      );
    }

    return membership;
  }

  private async assertMemberHasNoActiveMembership({
    manager,
    workspaceId,
    workspaceMemberId,
  }: MemberIdentity & { manager: EntityManager }): Promise<void> {
    const membership = await manager
      .getRepository(InconnectCommercialTeamMembershipEntity)
      .findOne({
        where: { workspaceId, workspaceMemberId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

    if (membership) {
      throw new InconnectCommercialTeamException(
        'Workspace Member already belongs to a commercial team',
        InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
      );
    }
  }

  private async runTransactionAndInvalidate<TResult>(
    workspaceId: string,
    operation: (manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    let generations: WorkspaceCacheGenerations = {};
    const result = await this.dataSource.transaction(async (manager) => {
      const operationResult = await operation(manager);

      generations =
        await this.workspaceCacheService.revokeGenerationFencedEntries(
          workspaceId,
          ['inconnectTeamAccessMaps'],
          'Commercial team data changed and is awaiting recomputation',
        );

      return operationResult;
    });

    try {
      await this.workspaceCacheService.recomputeGenerationFencedEntries(
        workspaceId,
        generations,
      );
    } catch (error) {
      // The database commit already succeeded. The fenced invalid value remains
      // authoritative, so callers get the persisted result without stale access.
      this.logger.error(
        `INCONNECT team cache recomputation failed after commit for workspace ${workspaceId}`,
        error,
      );
    }

    return result;
  }
}
