import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { InconnectMessagingWebhookRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-webhook-recovery.cron.command';
import { InconnectMessagingDispatchRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-dispatch-recovery.cron.command';
import { InconnectMessagingOutboxRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-outbox-recovery.cron.command';
import { InconnectMessagingWebhookController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-webhook.controller';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { TwilioWhatsappClientFactory } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-client.factory';
import { InconnectMessagingDispatchJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-dispatch.job';
import { InconnectMessagingDispatchRecoveryCronJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-dispatch-recovery.cron.job';
import { InconnectMessagingWebhookProcessingJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-processing.job';
import { InconnectMessagingWebhookRecoveryCronJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-recovery.cron.job';
import { InconnectMessagingOutboxPublishingJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-outbox-publishing.job';
import { InconnectMessagingOutboxRecoveryCronJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-outbox-recovery.cron.job';
import { InconnectMessagingReadResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-read.resolver';
import { InconnectMessagingSendResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-send.resolver';
import { InconnectMessagingSubscriptionResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-subscription.resolver';
import { InconnectMessagingTemplateResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-template.resolver';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import { InconnectMessagingMessageQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-message-query.service';
import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { InconnectMessagingReadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-read.service';
import { InconnectMessagingSendService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send.service';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';
import { InconnectMessagingRealtimePublisherService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-realtime-publisher.service';
import { InconnectMessagingRealtimeRecipientService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-realtime-recipient.service';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { InconnectMessagingWebhookProcessingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';
import { InconnectMessagingSendCapabilitiesService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send-capabilities.service';
import { InconnectMessagingTemplateCatalogService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-template-catalog.service';

const INCONNECT_MESSAGING_ENTITIES = [
  InconnectMessagingConfigurationEntity,
  InconnectMessagingProviderConnectionEntity,
  InconnectMessagingConversationEntity,
  InconnectMessagingMessageEntity,
  InconnectMessagingDispatchAttemptEntity,
  InconnectMessagingWebhookReceiptEntity,
  InconnectMessagingProviderStatusEventEntity,
  InconnectMessagingOutboxEventEntity,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...INCONNECT_MESSAGING_ENTITIES,
      UserWorkspaceEntity,
    ]),
    InconnectRecordAccessModule,
    SecretEncryptionModule,
    PermissionsModule,
    WorkspaceCacheModule,
  ],
  providers: [
    InconnectMessagingProviderRegistry,
    TwilioWhatsappClientFactory,
    TwilioWhatsappMessagingProvider,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
    InconnectMessagingMessageQueryService,
    InconnectMessagingReadService,
    InconnectMessagingReadResolver,
    InconnectMessagingSendService,
    InconnectMessagingSendResolver,
    InconnectMessagingTemplateCatalogService,
    InconnectMessagingSendCapabilitiesService,
    InconnectMessagingTemplateResolver,
    InconnectMessagingDispatchService,
    InconnectMessagingDispatchJob,
    InconnectMessagingDispatchRecoveryCronJob,
    InconnectMessagingDispatchRecoveryCronCommand,
    InconnectMessagingSubscriptionResolver,
    InconnectMessagingRealtimeRecipientService,
    InconnectMessagingRealtimePublisherService,
    InconnectMessagingOutboxService,
    InconnectMessagingProviderConnectionRoutingService,
    InconnectMessagingWebhookIngressService,
    InconnectMessagingWebhookReceiptService,
    InconnectMessagingWebhookProcessingService,
    InconnectMessagingWebhookProcessingJob,
    InconnectMessagingWebhookRecoveryCronJob,
    InconnectMessagingWebhookRecoveryCronCommand,
    InconnectMessagingOutboxPublishingJob,
    InconnectMessagingOutboxRecoveryCronJob,
    InconnectMessagingOutboxRecoveryCronCommand,
    provideWorkspaceScopedRepository(InconnectMessagingConversationEntity),
    provideWorkspaceScopedRepository(InconnectMessagingConfigurationEntity),
    provideWorkspaceScopedRepository(InconnectMessagingMessageEntity),
  ],
  controllers: [InconnectMessagingWebhookController],
  exports: [
    InconnectMessagingProviderRegistry,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
    InconnectMessagingWebhookRecoveryCronCommand,
    InconnectMessagingDispatchRecoveryCronCommand,
    InconnectMessagingOutboxRecoveryCronCommand,
  ],
})
export class InconnectMessagingModule {}
