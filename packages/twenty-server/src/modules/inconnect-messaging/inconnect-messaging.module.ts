import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';

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
    PermissionsModule,
    WorkspaceCacheModule,
  ],
  providers: [
    InconnectMessagingProviderRegistry,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
    provideWorkspaceScopedRepository(InconnectMessagingConversationEntity),
    provideWorkspaceScopedRepository(InconnectMessagingConfigurationEntity),
  ],
  exports: [
    InconnectMessagingProviderRegistry,
    InconnectMessagingAuthorizationService,
    InconnectMessagingConversationQueryService,
  ],
})
export class InconnectMessagingModule {}
