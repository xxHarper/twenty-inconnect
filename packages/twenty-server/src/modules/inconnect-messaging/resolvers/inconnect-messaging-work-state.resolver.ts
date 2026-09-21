import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InconnectMessagingConversationWorkStateDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-work-state.dto';
import { InconnectMessagingWorkStateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-work-state.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingWorkStateResolver {
  constructor(
    private readonly workStateService: InconnectMessagingWorkStateService,
  ) {}

  @Mutation(() => InconnectMessagingConversationWorkStateDTO)
  async setInconnectMessagingConversationFavorite(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('favorite', { type: () => Boolean }) favorite: boolean,
  ): Promise<InconnectMessagingConversationWorkStateDTO> {
    return this.workStateService.setFavorite({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      favorite,
    });
  }

  @Mutation(() => InconnectMessagingConversationWorkStateDTO)
  async markInconnectMessagingConversationRead(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('throughMessageId', {
      type: () => UUIDScalarType,
      nullable: true,
    })
    throughMessageId?: string,
  ): Promise<InconnectMessagingConversationWorkStateDTO> {
    return this.workStateService.markRead({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      throughMessageId,
    });
  }

  @Mutation(() => InconnectMessagingConversationWorkStateDTO)
  async markInconnectMessagingConversationUnread(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
  ): Promise<InconnectMessagingConversationWorkStateDTO> {
    return this.workStateService.markUnread({
      authContext: getWorkspaceAuthContext(),
      conversationId,
    });
  }

  @Mutation(() => InconnectMessagingConversationWorkStateDTO)
  async setInconnectMessagingConversationPending(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('pending', { type: () => Boolean }) pending: boolean,
  ): Promise<InconnectMessagingConversationWorkStateDTO> {
    return this.workStateService.setPending({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      pending,
    });
  }
}
