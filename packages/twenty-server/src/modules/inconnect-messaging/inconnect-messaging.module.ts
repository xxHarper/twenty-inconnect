import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { InconnectMessagingWebhookRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-webhook-recovery.cron.command';
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
import { InconnectMessagingWebhookProcessingJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-processing.job';
import { InconnectMessagingWebhookRecoveryCronJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-recovery.cron.job';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { InconnectMessagingWebhookProcessingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

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
    TypeOrmModule.forFeature(INCONNECT_MESSAGING_ENTITIES),
    InconnectRecordAccessModule,
    SecretEncryptionModule,
    PermissionsModule,
    WorkspaceCacheModule,
  ],
  providers: [
    InconnectMessagingProviderRegistry,
    TwilioWhatsappMessagingProvider,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
    InconnectMessagingProviderConnectionRoutingService,
    InconnectMessagingWebhookIngressService,
    InconnectMessagingWebhookReceiptService,
    InconnectMessagingWebhookProcessingService,
    InconnectMessagingWebhookProcessingJob,
    InconnectMessagingWebhookRecoveryCronJob,
    InconnectMessagingWebhookRecoveryCronCommand,
    provideWorkspaceScopedRepository(InconnectMessagingConversationEntity),
    provideWorkspaceScopedRepository(InconnectMessagingConfigurationEntity),
  ],
  controllers: [InconnectMessagingWebhookController],
  exports: [
    InconnectMessagingProviderRegistry,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
    InconnectMessagingWebhookRecoveryCronCommand,
  ],
})
export class InconnectMessagingModule {}
