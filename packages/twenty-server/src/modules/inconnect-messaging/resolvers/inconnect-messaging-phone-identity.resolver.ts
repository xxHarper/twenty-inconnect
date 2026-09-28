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
  InconnectMessagingPhoneIdentityConfigurationDTO,
  InconnectMessagingPhoneIdentityFieldInput,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-phone-identity.dto';
import { InconnectMessagingPhoneIdentityConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-configuration.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingPhoneIdentityResolver {
  constructor(
    private readonly configurationService: InconnectMessagingPhoneIdentityConfigurationService,
  ) {}

  @Query(() => InconnectMessagingPhoneIdentityConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async inconnectMessagingPhoneIdentityConfiguration(): Promise<InconnectMessagingPhoneIdentityConfigurationDTO> {
    return this.configurationService.getConfiguration({
      authContext: getWorkspaceAuthContext(),
    });
  }

  @Mutation(() => InconnectMessagingPhoneIdentityConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async replaceInconnectMessagingPhoneIdentityConfiguration(
    @Args('fields', {
      type: () => [InconnectMessagingPhoneIdentityFieldInput],
    })
    fields: InconnectMessagingPhoneIdentityFieldInput[],
  ): Promise<InconnectMessagingPhoneIdentityConfigurationDTO> {
    return this.configurationService.replaceConfiguration({
      authContext: getWorkspaceAuthContext(),
      fields,
    });
  }
}
