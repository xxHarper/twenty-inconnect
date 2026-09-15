import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  SendInconnectMessagingMessageInput,
  SendInconnectMessagingMessageResult,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-send.input';
import { InconnectMessagingSendService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
@UsePipes(ResolverValidationPipe)
export class InconnectMessagingSendResolver {
  constructor(private readonly sendService: InconnectMessagingSendService) {}

  @Mutation(() => SendInconnectMessagingMessageResult)
  @UseGuards(CustomPermissionGuard)
  async sendInconnectMessagingMessage(
    @Args('input', { type: () => SendInconnectMessagingMessageInput })
    input: SendInconnectMessagingMessageInput,
  ): Promise<SendInconnectMessagingMessageResult> {
    return this.sendService.sendFreeformText({
      authContext: getWorkspaceAuthContext(),
      conversationId: input.conversationId,
      clientRequestId: input.clientRequestId,
      body: input.body,
    });
  }
}
