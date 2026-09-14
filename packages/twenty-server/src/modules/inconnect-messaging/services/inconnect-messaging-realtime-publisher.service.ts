import { Injectable } from '@nestjs/common';

import { SubscriptionService } from 'src/engine/subscriptions/subscription.service';
import { type InconnectMessagingRealtimeHint } from 'src/modules/inconnect-messaging/types/inconnect-messaging-realtime.type';

@Injectable()
export class InconnectMessagingRealtimePublisherService {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  async publishToMember({
    workspaceId,
    workspaceMemberId,
    hint,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    hint: InconnectMessagingRealtimeHint;
  }): Promise<void> {
    await this.subscriptionService.publishToInconnectMessaging({
      workspaceId,
      workspaceMemberId,
      payload: { onInconnectMessagingEvent: hint },
    });
  }
}
