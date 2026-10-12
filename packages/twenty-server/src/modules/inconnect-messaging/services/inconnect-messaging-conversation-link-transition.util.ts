import { randomUUID } from 'crypto';

import { type EntityManager } from 'typeorm';

import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { type InconnectMessagingBackgroundPhoneIdentityActor } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export const persistInconnectMessagingConversationLinkTransition = async ({
  manager,
  queryRunner,
  coreQueryBuilderService,
  conversation,
  objectMetadataId,
  recordId,
  actor,
}: {
  manager?: EntityManager;
  queryRunner?: WorkspaceQueryRunner;
  coreQueryBuilderService?: WorkspaceQueryRunnerCoreQueryBuilderService;
  conversation: InconnectMessagingConversationEntity;
  objectMetadataId: string;
  recordId: string;
  actor?: InconnectMessagingBackgroundPhoneIdentityActor;
}): Promise<InconnectMessagingOutboxPublicationRequest> => {
  const eventId = randomUUID();
  const event = {
    id: eventId,
    workspaceId: conversation.workspaceId,
    aggregateType: 'CONVERSATION' as const,
    aggregateId: conversation.id,
    eventType: 'CONVERSATION_LINKED',
    immutablePayload: {
      conversationId: conversation.id,
      ...(actor === undefined ? {} : { actor }),
    },
    deduplicationKey: `inconnect-messaging:conversation-linked:${eventId}`,
    availableAt: new Date(),
    processingState: 'PENDING' as const,
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    error: null,
    publishedAt: null,
  };

  if (manager !== undefined) {
    conversation.linkedRecordObjectMetadataId = objectMetadataId;
    conversation.linkedRecordId = recordId;
    await manager
      .getRepository(InconnectMessagingConversationEntity)
      .save(conversation);
    await manager
      .getRepository(InconnectMessagingOutboxEventEntity)
      .insert(event);
  } else {
    if (queryRunner === undefined || coreQueryBuilderService === undefined) {
      throw new Error('Core query context is required');
    }

    const updateResult = await coreQueryBuilderService
      .createCoreQueryBuilder({
        queryRunner,
        target: InconnectMessagingConversationEntity,
        alias: 'conversation',
      })
      .update()
      .set({
        linkedRecordObjectMetadataId: objectMetadataId,
        linkedRecordId: recordId,
      })
      .where('id = :conversationId', { conversationId: conversation.id })
      .andWhere('workspaceId = :workspaceId', {
        workspaceId: conversation.workspaceId,
      })
      .andWhere('linkedRecordObjectMetadataId IS NULL')
      .andWhere('linkedRecordId IS NULL')
      .updateEntity(false)
      .execute();

    if (updateResult.affected !== 1) {
      throw new Error(
        'Messaging Conversation link transition did not affect exactly one unassigned row',
      );
    }

    await coreQueryBuilderService
      .createCoreQueryBuilder({
        queryRunner,
        target: InconnectMessagingOutboxEventEntity,
        alias: 'outboxEvent',
      })
      .insert()
      .into(InconnectMessagingOutboxEventEntity)
      .values(event)
      .updateEntity(false)
      .execute();

    conversation.linkedRecordObjectMetadataId = objectMetadataId;
    conversation.linkedRecordId = recordId;
  }

  return {
    id: eventId,
    workspaceId: conversation.workspaceId,
    eventType: 'CONVERSATION_LINKED',
  };
};
