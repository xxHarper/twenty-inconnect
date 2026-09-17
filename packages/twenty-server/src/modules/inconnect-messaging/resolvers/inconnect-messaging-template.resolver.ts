import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  InconnectMessagingSendCapabilitiesDTO,
  InconnectMessagingTemplateDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';
import { InconnectMessagingSendCapabilitiesService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send-capabilities.service';
import { InconnectMessagingTemplateCatalogService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-template-catalog.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingTemplateResolver {
  constructor(
    private readonly templateCatalogService: InconnectMessagingTemplateCatalogService,
    private readonly sendCapabilitiesService: InconnectMessagingSendCapabilitiesService,
  ) {}

  @Query(() => [InconnectMessagingTemplateDTO], { nullable: true })
  @UseGuards(CustomPermissionGuard)
  async inconnectMessagingTemplates(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
  ): Promise<InconnectMessagingTemplateDTO[] | null> {
    return this.templateCatalogService.getTemplates({
      authContext: getWorkspaceAuthContext(),
      conversationId,
    });
  }

  @Query(() => InconnectMessagingSendCapabilitiesDTO, { nullable: true })
  @UseGuards(CustomPermissionGuard)
  async inconnectMessagingSendCapabilities(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
  ): Promise<InconnectMessagingSendCapabilitiesDTO | null> {
    return this.sendCapabilitiesService.getCapabilities({
      authContext: getWorkspaceAuthContext(),
      conversationId,
    });
  }
}
