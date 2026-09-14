import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InconnectMessagingPagingInput } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-paging.input';
import {
  InconnectMessagingConversationConnectionDTO,
  InconnectMessagingConversationDTO,
  InconnectMessagingMessageConnectionDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-read.dto';
import { InconnectMessagingReadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-read.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingReadResolver {
  constructor(
    private readonly inconnectMessagingReadService: InconnectMessagingReadService,
  ) {}

  @Query(() => InconnectMessagingConversationDTO, { nullable: true })
  async inconnectMessagingConversation(
    @Args('id', { type: () => UUIDScalarType }) id: string,
  ): Promise<InconnectMessagingConversationDTO | null> {
    return this.inconnectMessagingReadService.getConversation({
      authContext: getWorkspaceAuthContext(),
      conversationId: id,
    });
  }

  @Query(() => InconnectMessagingConversationConnectionDTO)
  async inconnectMessagingConversations(
    @Args('search', { type: () => String, nullable: true })
    search?: string,
    @Args('paging', {
      type: () => InconnectMessagingPagingInput,
      nullable: true,
    })
    paging?: InconnectMessagingPagingInput,
  ): Promise<InconnectMessagingConversationConnectionDTO> {
    return this.inconnectMessagingReadService.getConversations({
      authContext: getWorkspaceAuthContext(),
      search,
      first: paging?.first,
      after: paging?.after,
    });
  }

  @Query(() => InconnectMessagingMessageConnectionDTO, { nullable: true })
  async inconnectMessagingMessages(
    @Args('conversationId', { type: () => UUIDScalarType })
    conversationId: string,
    @Args('paging', {
      type: () => InconnectMessagingPagingInput,
      nullable: true,
    })
    paging?: InconnectMessagingPagingInput,
  ): Promise<InconnectMessagingMessageConnectionDTO | null> {
    return this.inconnectMessagingReadService.getMessages({
      authContext: getWorkspaceAuthContext(),
      conversationId,
      first: paging?.first,
      after: paging?.after,
    });
  }
}
