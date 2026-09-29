import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { persistInconnectMessagingConversationLinkTransition } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-link-transition.util';
import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { InconnectMessagingBackgroundPhoneIdentityResolverService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';
import { INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type InconnectMessagingInboundAutoLinkResult = {
  state:
    | 'ALREADY_LINKED'
    | 'DISABLED'
    | 'INVALID'
    | 'NO_MATCH'
    | 'AMBIGUOUS'
    | 'LINKED';
  publicationRequest: InconnectMessagingOutboxPublicationRequest | null;
};

@Injectable()
export class InconnectMessagingInboundAutoLinkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly backgroundPhoneIdentityResolverService: InconnectMessagingBackgroundPhoneIdentityResolverService,
  ) {}

  async attemptForInboundMessage({
    workspaceId,
    messageId,
  }: {
    workspaceId: string;
    messageId: string;
  }): Promise<InconnectMessagingInboundAutoLinkResult> {
    const message = await this.dataSource
      .getRepository(InconnectMessagingMessageEntity)
      .findOne({
        select: { conversationId: true },
        where: {
          id: messageId,
          workspaceId,
          direction: 'INBOUND',
        },
      });

    if (message === null) {
      return { state: 'NO_MATCH', publicationRequest: null };
    }

    const conversation = await this.dataSource
      .getRepository(InconnectMessagingConversationEntity)
      .findOne({
        select: {
          id: true,
          workspaceId: true,
          externalAddressNormalized: true,
          linkedRecordObjectMetadataId: true,
          linkedRecordId: true,
        },
        where: { id: message.conversationId, workspaceId },
      });

    if (conversation === null) {
      return { state: 'NO_MATCH', publicationRequest: null };
    }

    if (
      conversation.linkedRecordObjectMetadataId !== null &&
      conversation.linkedRecordId !== null
    ) {
      return { state: 'ALREADY_LINKED', publicationRequest: null };
    }

    const initialResolution =
      await this.backgroundPhoneIdentityResolverService.resolvePhoneIdentity({
        workspaceId,
        input: conversation.externalAddressNormalized,
      });

    if (initialResolution.state !== 'UNIQUE') {
      return { state: initialResolution.state, publicationRequest: null };
    }

    return this.dataSource.transaction(async (manager) => {
      const lockedConversation = await manager
        .getRepository(InconnectMessagingConversationEntity)
        .findOne({
          where: { id: conversation.id, workspaceId },
          lock: { mode: 'pessimistic_write' },
        });

      if (lockedConversation === null) {
        return { state: 'NO_MATCH', publicationRequest: null };
      }

      if (
        lockedConversation.linkedRecordObjectMetadataId !== null &&
        lockedConversation.linkedRecordId !== null
      ) {
        return { state: 'ALREADY_LINKED', publicationRequest: null };
      }

      const revalidatedResolution =
        await this.backgroundPhoneIdentityResolverService.resolvePhoneIdentityForLink(
          {
            manager,
            workspaceId,
            input: lockedConversation.externalAddressNormalized,
          },
        );

      if (revalidatedResolution.state !== 'UNIQUE') {
        return {
          state: revalidatedResolution.state,
          publicationRequest: null,
        };
      }

      const publicationRequest =
        await persistInconnectMessagingConversationLinkTransition({
          manager,
          conversation: lockedConversation,
          objectMetadataId: revalidatedResolution.objectMetadataId,
          recordId: revalidatedResolution.recordId,
          actor: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        });

      return { state: 'LINKED', publicationRequest };
    });
  }
}
