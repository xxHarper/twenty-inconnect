import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type EntityManager, IsNull } from 'typeorm';

import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import {
  InconnectCommercialTeamException,
  InconnectCommercialTeamExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team.exception';
import { InconnectCommercialTeamService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team.service';
import {
  type InconnectWorkspaceMemberProfile,
  InconnectWorkspaceMemberService,
} from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import {
  type InconnectCommercialTeamSettingsAvailableMember,
  type InconnectCommercialTeamSettingsMember,
  type InconnectCommercialTeamSettingsMutationResult,
  type InconnectCommercialTeamSettingsTeam,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-settings.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

type ActiveCommercialTeamRows = {
  teams: InconnectCommercialTeamEntity[];
  memberships: InconnectCommercialTeamMembershipEntity[];
  teamsById: Map<string, InconnectCommercialTeamEntity>;
};

@Injectable()
export class InconnectCommercialTeamSettingsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly commercialTeamService: InconnectCommercialTeamService,
    private readonly workspaceMemberService: InconnectWorkspaceMemberService,
  ) {}

  async getTeams(
    workspaceId: string,
  ): Promise<InconnectCommercialTeamSettingsTeam[]> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      const { teams, memberships } = await this.loadActiveCommercialTeamRows({
        manager,
        workspaceId,
      });
      const profiles =
        await this.workspaceMemberService.getWorkspaceMemberProfiles({
          manager,
          workspaceId,
          workspaceMemberIds: memberships.map(
            ({ workspaceMemberId }) => workspaceMemberId,
          ),
        });
      const resultByTeamId = new Map<
        string,
        InconnectCommercialTeamSettingsTeam
      >(
        teams.map((team) => [
          team.id,
          {
            id: team.id,
            name: team.name,
            coordinator: null,
            executives: [],
          },
        ]),
      );

      for (const membership of memberships) {
        const team = resultByTeamId.get(membership.teamId);
        const profile = profiles.get(membership.workspaceMemberId);

        if (!team || !profile) {
          throw new InconnectCommercialTeamException(
            'Commercial team membership references an invalid workspace member or team',
            InconnectCommercialTeamExceptionCode.WORKSPACE_MEMBER_INVALID,
          );
        }

        const member = this.toSettingsMember({ membership, profile });

        if (
          membership.membershipType ===
          InconnectCommercialTeamMembershipType.COORDINATOR
        ) {
          if (team.coordinator) {
            throw new InconnectCommercialTeamException(
              'Commercial team has multiple active coordinators',
              InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
            );
          }

          team.coordinator = member;
        } else if (
          membership.membershipType ===
          InconnectCommercialTeamMembershipType.EXECUTIVE
        ) {
          team.executives.push(member);
        } else {
          throw new InconnectCommercialTeamException(
            'Commercial team membership has an unsupported type',
            InconnectCommercialTeamExceptionCode.INVALID_INPUT,
          );
        }
      }

      return [...resultByTeamId.values()].map((team) => ({
        ...team,
        executives: team.executives.sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      }));
    });
  }

  async getAvailableMembers(
    workspaceId: string,
  ): Promise<InconnectCommercialTeamSettingsAvailableMember[]> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      const { memberships } = await this.loadActiveCommercialTeamRows({
        manager,
        workspaceId,
      });
      const membershipsByWorkspaceMemberId = new Map(
        memberships.map((membership) => [
          membership.workspaceMemberId,
          membership,
        ]),
      );
      const profiles =
        await this.workspaceMemberService.getAssignableWorkspaceMemberProfiles({
          manager,
          workspaceId,
        });

      return profiles
        .map((profile) => {
          const membership = membershipsByWorkspaceMemberId.get(profile.id);

          return {
            workspaceMemberId: profile.id,
            displayName: this.computeDisplayName(profile),
            email: profile.email,
            currentTeamId: membership?.teamId ?? null,
            currentMembershipType: membership?.membershipType ?? null,
          };
        })
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        );
    });
  }

  async createTeam({
    workspaceId,
    name,
  }: {
    workspaceId: string;
    name: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { result: team, cacheStatus } =
      await this.commercialTeamService.createTeam({
        workspaceId,
        name,
      });

    return { teamId: team.id, membershipId: null, cacheStatus };
  }

  async renameTeam({
    workspaceId,
    teamId,
    name,
  }: {
    workspaceId: string;
    teamId: string;
    name: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { result: team, cacheStatus } =
      await this.commercialTeamService.renameTeam({
        workspaceId,
        teamId,
        name,
      });

    return { teamId: team.id, membershipId: null, cacheStatus };
  }

  async assignCoordinator({
    workspaceId,
    teamId,
    workspaceMemberId,
  }: {
    workspaceId: string;
    teamId: string;
    workspaceMemberId: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { result: membership, cacheStatus } =
      await this.commercialTeamService.assignCoordinator({
        workspaceId,
        teamId,
        workspaceMemberId,
      });

    return {
      teamId: membership.teamId,
      membershipId: membership.id,
      cacheStatus,
    };
  }

  async addExecutive({
    workspaceId,
    teamId,
    workspaceMemberId,
  }: {
    workspaceId: string;
    teamId: string;
    workspaceMemberId: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { result: membership, cacheStatus } =
      await this.commercialTeamService.addExecutive({
        workspaceId,
        teamId,
        workspaceMemberId,
      });

    return {
      teamId: membership.teamId,
      membershipId: membership.id,
      cacheStatus,
    };
  }

  async removeExecutive({
    workspaceId,
    teamId,
    workspaceMemberId,
  }: {
    workspaceId: string;
    teamId: string;
    workspaceMemberId: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { cacheStatus } = await this.commercialTeamService.removeExecutive({
      workspaceId,
      teamId,
      workspaceMemberId,
    });

    return { teamId, membershipId: null, cacheStatus };
  }

  async moveMember({
    workspaceId,
    workspaceMemberId,
    targetTeamId,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    targetTeamId: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { result: membership, cacheStatus } =
      await this.commercialTeamService.moveMember({
        workspaceId,
        workspaceMemberId,
        targetTeamId,
      });

    return {
      teamId: membership.teamId,
      membershipId: membership.id,
      cacheStatus,
    };
  }

  async deleteTeam({
    workspaceId,
    teamId,
  }: {
    workspaceId: string;
    teamId: string;
  }): Promise<InconnectCommercialTeamSettingsMutationResult> {
    const { cacheStatus } = await this.commercialTeamService.deleteTeam({
      workspaceId,
      teamId,
    });

    return { teamId, membershipId: null, cacheStatus };
  }

  private async loadActiveCommercialTeamRows({
    manager,
    workspaceId,
  }: {
    manager: EntityManager;
    workspaceId: string;
  }): Promise<ActiveCommercialTeamRows> {
    const teams = await manager
      .getRepository(InconnectCommercialTeamEntity)
      .find({
        where: { workspaceId, deletedAt: IsNull() },
        order: { name: 'ASC', id: 'ASC' },
      });
    const memberships = await manager
      .getRepository(InconnectCommercialTeamMembershipEntity)
      .find({
        where: { workspaceId, deletedAt: IsNull() },
        order: { teamId: 'ASC', createdAt: 'ASC', id: 'ASC' },
      });
    const teamsById = new Map(teams.map((team) => [team.id, team]));

    if (memberships.some((membership) => !teamsById.has(membership.teamId))) {
      throw new InconnectCommercialTeamException(
        'An active commercial team membership references an inactive team',
        InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
      );
    }

    return { teams, memberships, teamsById };
  }

  private toSettingsMember({
    membership,
    profile,
  }: {
    membership: InconnectCommercialTeamMembershipEntity;
    profile: InconnectWorkspaceMemberProfile;
  }): InconnectCommercialTeamSettingsMember {
    return {
      membershipId: membership.id,
      workspaceMemberId: membership.workspaceMemberId,
      displayName: this.computeDisplayName(profile),
      email: profile.email,
      isAssignable: profile.isAssignable,
    };
  }

  private computeDisplayName(profile: InconnectWorkspaceMemberProfile): string {
    const name = `${profile.firstName} ${profile.lastName}`.trim();

    return name || profile.email || profile.id;
  }
}
