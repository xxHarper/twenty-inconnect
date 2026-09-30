import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  InconnectMessagingAutoCreateConfigurationDTO,
  InconnectMessagingAutoCreateConfigurationInput,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingAutoCreateConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-configuration.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingAutoCreateResolver {
  constructor(
    private readonly configurationService: InconnectMessagingAutoCreateConfigurationService,
  ) {}

  @Query(() => InconnectMessagingAutoCreateConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async inconnectMessagingAutoCreateConfiguration(): Promise<InconnectMessagingAutoCreateConfigurationDTO> {
    return this.configurationService.getConfiguration({
      authContext: getWorkspaceAuthContext(),
    });
  }

  @Mutation(() => InconnectMessagingAutoCreateConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async replaceInconnectMessagingAutoCreateConfiguration(
    @Args('input', {
      type: () => InconnectMessagingAutoCreateConfigurationInput,
    })
    input: InconnectMessagingAutoCreateConfigurationInput,
  ): Promise<InconnectMessagingAutoCreateConfigurationDTO> {
    return this.configurationService.replaceConfiguration({
      authContext: getWorkspaceAuthContext(),
      input,
    });
  }
}
