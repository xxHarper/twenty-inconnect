import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isNonEmptyString } from '@sniptt/guards';
import { DataSource, type EntityManager } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ConflictError,
  NotFoundError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { type InconnectMessagingConversationContextDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context.service';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

@Injectable()
export class InconnectMessagingConversationLinkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly contextService: InconnectMessagingContextService,
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  async linkConversation({
    authContext,
    conversationId,
    recordId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    recordId: string;
  }): Promise<InconnectMessagingConversationContextDTO | null> {
    if (!(await this.authorizationService.canUseManualLinking(authContext))) {
      throw new NotFoundError('Conversation not found');
    }

    const publicationRequest = await this.dataSource.transaction(
      async (manager) =>
        this.linkInsideTransaction({
          manager,
          authContext,
          conversationId,
          recordId,
        }),
    );

    if (publicationRequest !== null) {
      await this.outboxService.requestPublication(publicationRequest);
    }

    return this.contextService.getConversationContext({
      authContext,
      conversationId,
    });
  }

  private async linkInsideTransaction({
    manager,
    authContext,
    conversationId,
    recordId,
  }: {
    manager: EntityManager;
    authContext: WorkspaceAuthContext;
    conversationId: string;
    recordId: string;
  }): Promise<InconnectMessagingOutboxPublicationRequest | null> {
    const workspaceId = authContext.workspace.id;
    const conversationRepository = manager.getRepository(
      InconnectMessagingConversationEntity,
    );
    const conversation = await conversationRepository.findOne({
      where: { id: conversationId, workspaceId },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      conversation === null ||
      !(await this.authorizationService.canManuallyLinkConversation({
        authContext,
        conversation,
      }))
    ) {
      throw new NotFoundError('Conversation not found');
    }

    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (configuration === null) {
      throw new NotFoundError('Conversation not found');
    }

    const anchorObjectMetadataId = configuration.anchorObjectMetadataId;
    const isAlreadyLinked =
      conversation.linkedRecordObjectMetadataId !== null &&
      conversation.linkedRecordId !== null;

    if (
      isAlreadyLinked &&
      (conversation.linkedRecordObjectMetadataId !== anchorObjectMetadataId ||
        conversation.linkedRecordId !== recordId)
    ) {
      throw new ConflictError('CONVERSATION_ALREADY_LINKED');
    }

    if (
      !isNonEmptyString(authContext.workspace.databaseSchema) ||
      !(await this.authorizationService.canReadObjectRecords({
        authContext,
        objectMetadataId: anchorObjectMetadataId,
      }))
    ) {
      throw new NotFoundError('Record not found');
    }

    const objectMetadata = await manager
      .getRepository(ObjectMetadataEntity)
      .findOne({
        where: {
          id: anchorObjectMetadataId,
          workspaceId,
        },
      });

    if (objectMetadata === null) {
      throw new NotFoundError('Record not found');
    }

    const { flatObjectMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
      ]);
    const objectUniversalIdentifier =
      flatObjectMetadataMaps.universalIdentifierById[objectMetadata.id];
    const flatObjectMetadata = objectUniversalIdentifier
      ? flatObjectMetadataMaps.byUniversalIdentifier[objectUniversalIdentifier]
      : undefined;

    if (
      flatObjectMetadata === undefined ||
      flatObjectMetadata.id !== objectMetadata.id ||
      flatObjectMetadata.workspaceId !== workspaceId
    ) {
      throw new NotFoundError('Record not found');
    }

    const recordAlias = 'inconnect_messaging_link_target';
    const escapedRecordAlias = escapeIdentifier(recordAlias);
    const qualifiedTableName = `${authContext.workspace.databaseSchema}.${computeObjectTargetTable(
      flatObjectMetadata,
    )}`;
    const targetQueryBuilder = manager
      .createQueryBuilder()
      .select(`${escapedRecordAlias}."id"`, 'recordId')
      .from(qualifiedTableName, recordAlias)
      .where(`${escapedRecordAlias}."id" = :linkTargetRecordId`, {
        linkTargetRecordId: recordId,
      })
      .andWhere(`${escapedRecordAlias}."deletedAt" IS NULL`)
      .setLock('pessimistic_read');
    const recordAccessScope =
      await this.recordAccessAuthorizationService.applyReadScopeToQueryBuilder({
        queryBuilder: targetQueryBuilder,
        tableAlias: recordAlias,
        workspaceId,
        objectMetadataId: objectMetadata.id,
        authContext,
      });
    const targetRecord =
      recordAccessScope.kind === 'denied'
        ? null
        : await targetQueryBuilder.getRawOne();

    if (targetRecord === null || targetRecord === undefined) {
      throw new NotFoundError('Record not found');
    }

    if (isAlreadyLinked) {
      return null;
    }

    conversation.linkedRecordObjectMetadataId = anchorObjectMetadataId;
    conversation.linkedRecordId = recordId;
    await conversationRepository.save(conversation);

    const eventId = randomUUID();

    await manager.getRepository(InconnectMessagingOutboxEventEntity).insert({
      id: eventId,
      workspaceId,
      aggregateType: 'CONVERSATION',
      aggregateId: conversation.id,
      eventType: 'CONVERSATION_LINKED',
      immutablePayload: { conversationId: conversation.id },
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
      workspaceId,
      eventType: 'CONVERSATION_LINKED',
    };
  }
}
