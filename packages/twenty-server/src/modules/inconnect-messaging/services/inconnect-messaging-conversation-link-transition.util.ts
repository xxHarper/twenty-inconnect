import { randomUUID } from 'crypto';

import { type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { type InconnectMessagingBackgroundPhoneIdentityActor } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export const persistInconnectMessagingConversationLinkTransition = async ({
  manager,
  conversation,
  objectMetadataId,
  recordId,
  actor,
}: {
  manager: EntityManager;
  conversation: InconnectMessagingConversationEntity;
  objectMetadataId: string;
  recordId: string;
  actor?: InconnectMessagingBackgroundPhoneIdentityActor;
}): Promise<InconnectMessagingOutboxPublicationRequest> => {
  conversation.linkedRecordObjectMetadataId = objectMetadataId;
  conversation.linkedRecordId = recordId;
  await manager
    .getRepository(InconnectMessagingConversationEntity)
    .save(conversation);

  const eventId = randomUUID();

  await manager.getRepository(InconnectMessagingOutboxEventEntity).insert({
    id: eventId,
    workspaceId: conversation.workspaceId,
    aggregateType: 'CONVERSATION',
    aggregateId: conversation.id,
    eventType: 'CONVERSATION_LINKED',
    immutablePayload: {
      conversationId: conversation.id,
      ...(actor === undefined ? {} : { actor }),
    },
    deduplicationKey: `inconnect-messaging:conversation-linked:${eventId}`,
    availableAt: new Date(),
    processingState: 'PENDING',
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    error: null,
    publishedAt: null,
  });

  return {
    id: eventId,
    workspaceId: conversation.workspaceId,
    eventType: 'CONVERSATION_LINKED',
  };
};
