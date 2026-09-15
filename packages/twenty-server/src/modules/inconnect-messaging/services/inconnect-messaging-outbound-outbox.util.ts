import { randomUUID } from 'crypto';

import { type EntityManager } from 'typeorm';

import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

export const createInconnectMessagingOutboundOutboxEvent = async ({
  manager,
  workspaceId,
  messageId,
  eventType,
  deduplicationKey,
}: {
  manager: EntityManager;
  workspaceId: string;
  messageId: string;
  eventType: 'OUTBOUND_MESSAGE_CREATED' | 'OUTBOUND_MESSAGE_STATUS_CHANGED';
  deduplicationKey: string;
}): Promise<InconnectMessagingOutboxPublicationRequest> => {
  const id = randomUUID();

  await manager.getRepository(InconnectMessagingOutboxEventEntity).insert({
    id,
    workspaceId,
    aggregateType: 'MESSAGE',
    aggregateId: messageId,
    eventType,
    immutablePayload: { messageId },
    deduplicationKey,
    availableAt: new Date(),
    processingState: 'PENDING',
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    error: null,
    publishedAt: null,
  });

  return { id, workspaceId, eventType };
};
