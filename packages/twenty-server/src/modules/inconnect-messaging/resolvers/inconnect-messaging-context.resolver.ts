import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  InconnectMessagingContextConfigurationDTO,
  InconnectMessagingConversationContextDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingContextConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context-configuration.service';
import { InconnectMessagingContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingContextResolver {
  constructor(
    private readonly contextService: InconnectMessagingContextService,
    private readonly contextConfigurationService: InconnectMessagingContextConfigurationService,
  ) {}

  @Query(() => InconnectMessagingConversationContextDTO, { nullable: true })
  @UseGuards(CustomPermissionGuard)
  async inconnectMessagingConversationContext(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
  ): Promise<InconnectMessagingConversationContextDTO | null> {
    return this.contextService.getConversationContext({
      authContext: getWorkspaceAuthContext(),
      conversationId,
    });
  }

  @Query(() => InconnectMessagingContextConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async inconnectMessagingContextConfiguration(): Promise<InconnectMessagingContextConfigurationDTO> {
    return this.contextConfigurationService.getConfiguration({
      authContext: getWorkspaceAuthContext(),
    });
  }

  @Mutation(() => InconnectMessagingContextConfigurationDTO)
  @UseGuards(
    SettingsPermissionGuard(PermissionFlagType.MANAGE_INCONNECT_MESSAGING),
  )
  async replaceInconnectMessagingContextConfiguration(
    @Args('fieldMetadataIds', { type: () => [UUIDScalarType] })
    fieldMetadataIds: string[],
  ): Promise<InconnectMessagingContextConfigurationDTO> {
    return this.contextConfigurationService.replaceConfiguration({
      authContext: getWorkspaceAuthContext(),
      fieldMetadataIds,
    });
  }
}
