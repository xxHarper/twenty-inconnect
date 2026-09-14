import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Subscription } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { SubscriptionService } from 'src/engine/subscriptions/subscription.service';
import { InconnectMessagingRealtimeEventDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-read.dto';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard)
export class InconnectMessagingSubscriptionResolver {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  @Subscription(() => InconnectMessagingRealtimeEventDTO)
  async onInconnectMessagingEvent() {
    const authContext = getWorkspaceAuthContext();

    if (
      !isUserAuthContext(authContext) ||
      !(await this.authorizationService.canAccessMessaging(authContext))
    ) {
      throw new ForbiddenException('INCONNECT Messaging access denied');
    }

    return this.subscriptionService.subscribeToInconnectMessaging({
      workspaceId: authContext.workspace.id,
      workspaceMemberId: authContext.workspaceMemberId,
    });
  }
}
