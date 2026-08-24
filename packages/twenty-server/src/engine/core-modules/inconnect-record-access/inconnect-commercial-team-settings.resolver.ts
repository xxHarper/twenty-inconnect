import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import {
  InconnectCommercialTeamSettingsAvailableMemberDTO,
  InconnectCommercialTeamSettingsMutationResultDTO,
  InconnectCommercialTeamSettingsTeamDTO,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-commercial-team-settings.dto';
import {
  CreateInconnectCommercialTeamInputDTO,
  DeleteInconnectCommercialTeamInputDTO,
  InconnectCommercialTeamMembershipInputDTO,
  MoveInconnectCommercialTeamMemberInputDTO,
  RenameInconnectCommercialTeamInputDTO,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-commercial-team-settings.input';
import { InconnectCommercialTeamSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team-settings.service';
import { handleInconnectCommercialTeamGraphqlError } from 'src/engine/core-modules/inconnect-record-access/utils/inconnect-commercial-team-graphql-api-exception-handler.util';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-graphql-api-exception.filter';

@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.SECURITY),
)
@UseFilters(
  AuthGraphqlApiExceptionFilter,
  PermissionsGraphqlApiExceptionFilter,
  PreventNestToAutoLogGraphqlErrorsFilter,
)
@UsePipes(ResolverValidationPipe)
@MetadataResolver()
export class InconnectCommercialTeamSettingsResolver {
  constructor(
    private readonly settingsService: InconnectCommercialTeamSettingsService,
  ) {}

  @Query(() => [InconnectCommercialTeamSettingsTeamDTO])
  async getInconnectCommercialTeams(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsTeamDTO[]> {
    try {
      return await this.settingsService.getTeams(workspace.id);
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Query(() => [InconnectCommercialTeamSettingsAvailableMemberDTO])
  async getInconnectCommercialTeamAvailableMembers(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsAvailableMemberDTO[]> {
    try {
      return await this.settingsService.getAvailableMembers(workspace.id);
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async createInconnectCommercialTeam(
    @Args('input') input: CreateInconnectCommercialTeamInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.createTeam({
        workspaceId: workspace.id,
        name: input.name,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async renameInconnectCommercialTeam(
    @Args('input') input: RenameInconnectCommercialTeamInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.renameTeam({
        workspaceId: workspace.id,
        teamId: input.teamId,
        name: input.name,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async assignInconnectCommercialTeamCoordinator(
    @Args('input') input: InconnectCommercialTeamMembershipInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.assignCoordinator({
        workspaceId: workspace.id,
        teamId: input.teamId,
        workspaceMemberId: input.workspaceMemberId,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async addInconnectCommercialTeamExecutive(
    @Args('input') input: InconnectCommercialTeamMembershipInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.addExecutive({
        workspaceId: workspace.id,
        teamId: input.teamId,
        workspaceMemberId: input.workspaceMemberId,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async removeInconnectCommercialTeamExecutive(
    @Args('input') input: InconnectCommercialTeamMembershipInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.removeExecutive({
        workspaceId: workspace.id,
        teamId: input.teamId,
        workspaceMemberId: input.workspaceMemberId,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async moveInconnectCommercialTeamMember(
    @Args('input') input: MoveInconnectCommercialTeamMemberInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.moveMember({
        workspaceId: workspace.id,
        workspaceMemberId: input.workspaceMemberId,
        targetTeamId: input.targetTeamId,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }

  @Mutation(() => InconnectCommercialTeamSettingsMutationResultDTO)
  async deleteInconnectCommercialTeam(
    @Args('input') input: DeleteInconnectCommercialTeamInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectCommercialTeamSettingsMutationResultDTO> {
    try {
      return await this.settingsService.deleteTeam({
        workspaceId: workspace.id,
        teamId: input.teamId,
      });
    } catch (error) {
      return handleInconnectCommercialTeamGraphqlError(error);
    }
  }
}
