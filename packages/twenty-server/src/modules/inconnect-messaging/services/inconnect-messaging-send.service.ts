import { Injectable } from '@nestjs/common';

import { createHash, randomUUID } from 'crypto';

import { DataSource } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import {
  ConflictError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { createInconnectMessagingOutboundOutboxEvent } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbound-outbox.util';
import { isInconnectMessagingFreeformWindowOpen } from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';

const MAX_BODY_LENGTH = 4096;

@Injectable()
export class InconnectMessagingSendService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly dispatchService: InconnectMessagingDispatchService,
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  async sendFreeformText({
    authContext,
    conversationId,
    clientRequestId,
    body,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    clientRequestId: string;
    body: string;
  }): Promise<{ messageId: string; outboundState: string }> {
    const authorizedConversation =
      await this.authorizationService.findAuthorizedConversationForSend({
        authContext,
        conversationId,
      });

    if (authorizedConversation === null || !isUserAuthContext(authContext)) {
      throw new NotFoundError('Conversation not found');
    }

    if (body.trim().length === 0 || body.length > MAX_BODY_LENGTH) {
      throw new UserInputError('Invalid message', {
        subCode: 'INVALID_MESSAGE',
      });
    }

    const workspaceId = authContext.workspace.id;
    const actorId = authContext.workspaceMemberId;
    const scopedClientRequestId = uuidv5(
      `${actorId}:${conversationId}:${clientRequestId}`,
      workspaceId,
    );
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          workspaceId,
          actorId,
          conversationId,
          clientRequestId,
          'TEXT',
          'FREEFORM',
          body,
        ]),
      )
      .digest('hex');
    const created = await this.dataSource.transaction(async (manager) => {
      const messageRepository = manager.getRepository(
        InconnectMessagingMessageEntity,
      );
      const existing = await messageRepository.findOne({
        where: {
          workspaceId,
          clientRequestId: scopedClientRequestId,
          direction: 'OUTBOUND',
        },
      });

      if (existing !== null) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
        }

        return {
          messageId: existing.id,
          outboundState: existing.outboundState ?? 'QUEUED',
          created: false,
          event: null,
        };
      }

      const conversation = await manager
        .getRepository(InconnectMessagingConversationEntity)
        .findOne({
          where: { id: conversationId, workspaceId },
          lock: { mode: 'pessimistic_write' },
        });

      if (
        conversation === null ||
        conversation.providerConnectionId !==
          authorizedConversation.providerConnectionId ||
        conversation.linkedRecordId !== authorizedConversation.linkedRecordId ||
        conversation.linkedRecordObjectMetadataId !==
          authorizedConversation.linkedRecordObjectMetadataId
      ) {
        throw new NotFoundError('Conversation not found');
      }

      const stillAuthorized =
        await this.authorizationService.findAuthorizedConversationForSend({
          authContext,
          conversationId,
        });

      if (stillAuthorized === null) {
        throw new NotFoundError('Conversation not found');
      }

      // The persisted effective inbound instant, not caller data, controls free-form permission.
      if (
        !isInconnectMessagingFreeformWindowOpen({
          lastInboundAt: conversation.lastInboundAt,
          now: new Date(),
        })
      ) {
        throw new UserInputError('Free-form messaging window is closed', {
          subCode: 'SESSION_WINDOW_CLOSED',
        });
      }

      const connection = await manager
        .getRepository(InconnectMessagingProviderConnectionEntity)
        .findOne({
          where: {
            id: conversation.providerConnectionId,
            workspaceId,
            lifecycleStatus: 'ENABLED',
          },
        });

      if (connection === null || connection.encryptedCredentials === null) {
        throw new UserInputError('Messaging provider is unavailable', {
          subCode: 'PROVIDER_UNAVAILABLE',
        });
      }

      try {
        const provider = this.providerRegistry.resolve({
          provider: connection.provider,
          channel: connection.channel,
        });

        if (!provider.capabilities.includes('DISPATCH_FREEFORM')) {
          throw new Error('Unsupported provider capability');
        }
      } catch {
        throw new UserInputError('Messaging provider is unavailable', {
          subCode: 'PROVIDER_UNAVAILABLE',
        });
      }

      const messageId = randomUUID();

      await messageRepository
        .createQueryBuilder()
        .insert()
        .values({
          id: messageId,
          workspaceId,
          conversationId,
          providerConnectionId: connection.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          sendMode: 'FREEFORM',
          body,
          outboundState: 'QUEUED',
          providerMessageId: null,
          providerStatus: null,
          clientRequestId: scopedClientRequestId,
          requestFingerprint,
          retryOfMessageId: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          error: null,
          providerMetadata: null,
          serverReceivedAt: null,
          providerOccurredAt: null,
          effectiveInboundAt: null,
          timestampSource: null,
        })
        .orIgnore()
        .execute();

      const persisted = await messageRepository.findOne({
        where: {
          workspaceId,
          clientRequestId: scopedClientRequestId,
          direction: 'OUTBOUND',
        },
      });

      if (persisted === null) {
        throw new Error('Outbound message persistence failed');
      }

      if (persisted.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
      }

      if (persisted.id !== messageId) {
        return {
          messageId: persisted.id,
          outboundState: persisted.outboundState ?? 'QUEUED',
          created: false,
          event: null,
        };
      }

      await manager
        .getRepository(InconnectMessagingDispatchAttemptEntity)
        .insert({
          workspaceId,
          messageId,
          attemptNumber: 1,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: new Date(),
          providerRequestStartedAt: null,
          completedAt: null,
          outcome: null,
          error: null,
          providerMetadata: null,
        });

      const event = await createInconnectMessagingOutboundOutboxEvent({
        manager,
        workspaceId,
        messageId,
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        deduplicationKey: `inconnect-messaging:message:${messageId}:created`,
      });

      return { messageId, outboundState: 'QUEUED', created: true, event };
    });

    // Both transports are best-effort after commit; PostgreSQL recovery is authoritative.
    if (created.created) {
      await this.dispatchService.requestDispatch(created.messageId);
      if (created.event !== null) {
        await this.outboxService.requestPublication(
          created.event as InconnectMessagingOutboxPublicationRequest,
        );
      }
    }

    return {
      messageId: created.messageId,
      outboundState: created.outboundState,
    };
  }
}
