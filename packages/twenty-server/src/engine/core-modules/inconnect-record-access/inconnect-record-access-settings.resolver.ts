import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import {
  InconnectRecordAccessSettingsAvailableMetadataDTO,
  InconnectRecordAccessSettingsConfigurationDTO,
  ReplaceInconnectRecordAccessConfigurationResultDTO,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-record-access-settings.dto';
import { ReplaceInconnectRecordAccessConfigurationInputDTO } from 'src/engine/core-modules/inconnect-record-access/dtos/replace-inconnect-record-access-configuration.input';
import { InconnectRecordAccessSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-settings.service';
import { handleInconnectRecordAccessConfigurationGraphqlError } from 'src/engine/core-modules/inconnect-record-access/utils/inconnect-record-access-configuration-graphql-api-exception-handler.util';
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
export class InconnectRecordAccessSettingsResolver {
  constructor(
    private readonly settingsService: InconnectRecordAccessSettingsService,
  ) {}

  @Query(() => InconnectRecordAccessSettingsConfigurationDTO)
  async getInconnectRecordAccessConfiguration(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectRecordAccessSettingsConfigurationDTO> {
    try {
      return await this.settingsService.getConfiguration(workspace.id);
    } catch (error) {
      return handleInconnectRecordAccessConfigurationGraphqlError(error);
    }
  }

  @Query(() => InconnectRecordAccessSettingsAvailableMetadataDTO)
  async getInconnectRecordAccessAvailableMetadata(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<InconnectRecordAccessSettingsAvailableMetadataDTO> {
    try {
      return await this.settingsService.getAvailableMetadata(workspace.id);
    } catch (error) {
      return handleInconnectRecordAccessConfigurationGraphqlError(error);
    }
  }

  @Mutation(() => ReplaceInconnectRecordAccessConfigurationResultDTO)
  async replaceInconnectRecordAccessConfiguration(
    @Args('input') input: ReplaceInconnectRecordAccessConfigurationInputDTO,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ReplaceInconnectRecordAccessConfigurationResultDTO> {
    try {
      return await this.settingsService.replaceConfiguration({
        workspaceId: workspace.id,
        input,
      });
    } catch (error) {
      return handleInconnectRecordAccessConfigurationGraphqlError(error);
    }
  }
}
