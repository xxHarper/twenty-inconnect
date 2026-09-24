import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InconnectMessagingConversationContextDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingConversationLinkCandidateConnectionDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-link.dto';
import { InconnectMessagingPagingInput } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-paging.input';
import { InconnectMessagingConversationLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-link.service';
import { InconnectMessagingLinkCandidateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-link-candidate.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingLinkResolver {
  constructor(
    private readonly linkCandidateService: InconnectMessagingLinkCandidateService,
    private readonly conversationLinkService: InconnectMessagingConversationLinkService,
  ) {}

  @Query(() => InconnectMessagingConversationLinkCandidateConnectionDTO)
  async inconnectMessagingConversationLinkCandidates(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('search', { type: () => String }) search: string,
    @Args('paging', {
      type: () => InconnectMessagingPagingInput,
      nullable: true,
    })
    paging?: InconnectMessagingPagingInput,
  ): Promise<InconnectMessagingConversationLinkCandidateConnectionDTO> {
    return this.linkCandidateService.getCandidates({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      search,
      first: paging?.first,
      after: paging?.after,
    });
  }

  @Mutation(() => InconnectMessagingConversationContextDTO, {
    nullable: true,
  })
  async linkInconnectMessagingConversation(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('recordId', { type: () => UUIDScalarType }) recordId: string,
  ): Promise<InconnectMessagingConversationContextDTO | null> {
    return this.conversationLinkService.linkConversation({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      recordId,
    });
  }
}
