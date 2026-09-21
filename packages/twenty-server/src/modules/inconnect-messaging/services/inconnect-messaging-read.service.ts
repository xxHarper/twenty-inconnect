import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import {
  type InconnectMessagingConversationConnectionDTO,
  type InconnectMessagingConversationDTO,
  type InconnectMessagingLocationDTO,
  type InconnectMessagingMediaDTO,
  type InconnectMessagingMessageConnectionDTO,
  type InconnectMessagingMessageDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-read.dto';
import { InconnectMessagingConversationWorkStateFilter } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-work-state.dto';
import { type InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  InconnectMessagingConversationQueryService,
  type InconnectMessagingConversationWithWorkState,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import { InconnectMessagingMessageQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-message-query.service';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class InconnectMessagingReadService {
  constructor(
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly conversationQueryService: InconnectMessagingConversationQueryService,
    private readonly messageQueryService: InconnectMessagingMessageQueryService,
  ) {}

  async getConversation({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationDTO | null> {
    const conversation =
      await this.conversationQueryService.getAuthorizedConversation({
        authContext,
        conversationId,
      });

    return conversation === null ? null : this.toConversationDTO(conversation);
  }

  async getConversations({
    authContext,
    search,
    workState,
    first,
    after,
  }: {
    authContext: WorkspaceAuthContext;
    search?: string;
    workState?: InconnectMessagingConversationWorkStateFilter;
    first?: number;
    after?: string;
  }): Promise<InconnectMessagingConversationConnectionDTO> {
    const pageSize = this.resolvePageSize(first);
    const page =
      await this.conversationQueryService.getAuthorizedConversationPage({
        authContext,
        search,
        workState,
        first: pageSize,
        after,
      });
    const edges = page.edges.map(({ cursor, node }) => ({
      cursor,
      node: this.toConversationDTO(node),
    }));

    return {
      edges,
      totalCount: page.totalCount,
      pageInfo: {
        hasNextPage: page.hasNextPage,
        hasPreviousPage: isDefined(after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
    };
  }

  async getMessages({
    authContext,
    conversationId,
    first,
    after,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    first?: number;
    after?: string;
  }): Promise<InconnectMessagingMessageConnectionDTO | null> {
    const pageSize = this.resolvePageSize(first);
    const page = await this.messageQueryService.getAuthorizedMessagePage({
      authContext,
      conversationId,
      first: pageSize,
      after,
    });

    if (page === null) {
      return null;
    }

    const edges = page.edges.map(({ cursor, node, sortAt }) => ({
      cursor,
      node: this.toMessageDTO(node, sortAt),
    }));

    return {
      edges,
      totalCount: page.totalCount,
      pageInfo: {
        hasNextPage: page.hasNextPage,
        hasPreviousPage: isDefined(after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
    };
  }

  private resolvePageSize(first: number | undefined): number {
    const pageSize = first ?? DEFAULT_PAGE_SIZE;

    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new UserInputError(
        `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}`,
      );
    }

    return pageSize;
  }

  private toConversationDTO(
    result: InconnectMessagingConversationWithWorkState,
  ): InconnectMessagingConversationDTO {
    const { conversation } = result;

    return {
      id: conversation.id,
      externalAddress: conversation.externalAddressNormalized,
      isLinked:
        conversation.linkedRecordObjectMetadataId !== null &&
        conversation.linkedRecordId !== null,
      linkedRecordObjectMetadataId: conversation.linkedRecordObjectMetadataId,
      linkedRecordId: conversation.linkedRecordId,
      lastInboundAt: conversation.lastInboundAt,
      isFavorite: result.isFavorite,
      isUnread: result.isUnread,
      isPending: result.isPending,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessageDTO(
    message: InconnectMessagingMessageEntity,
    displayAt: Date,
  ): InconnectMessagingMessageDTO {
    return {
      id: message.id,
      direction: message.direction,
      type: message.type,
      body: message.body,
      sendMode: message.sendMode,
      outboundState: message.outboundState,
      displayAt,
      createdAt: message.createdAt,
      location: this.toSafeLocation(message.providerMetadata),
      media: this.toSafeMedia(message),
      template:
        message.sendMode === 'TEMPLATE' &&
        message.templateId !== null &&
        message.templateDisplayName !== null &&
        message.templateLanguage !== null &&
        message.templateVariables !== null
          ? {
              id: message.templateId,
              displayName: message.templateDisplayName,
              language: message.templateLanguage,
              variables: Object.entries(message.templateVariables)
                .sort(([left], [right]) =>
                  left.localeCompare(right, 'en', { numeric: true }),
                )
                .map(([key, value]) => ({ key, value })),
            }
          : null,
    };
  }

  private toSafeLocation(
    providerMetadata: Record<string, unknown> | null,
  ): InconnectMessagingLocationDTO | null {
    const location = providerMetadata?.location;

    if (
      typeof location !== 'object' ||
      location === null ||
      Array.isArray(location)
    ) {
      return null;
    }

    const values = location as Record<string, unknown>;

    if (
      typeof values.latitude !== 'string' ||
      typeof values.longitude !== 'string'
    ) {
      return null;
    }

    return {
      latitude: values.latitude,
      longitude: values.longitude,
      label: typeof values.label === 'string' ? values.label : null,
      name: typeof values.name === 'string' ? values.name : null,
      address: typeof values.address === 'string' ? values.address : null,
    };
  }

  private toSafeMedia(
    message: InconnectMessagingMessageEntity,
  ): InconnectMessagingMediaDTO[] {
    if (message.attachments?.length > 0) {
      return [...message.attachments]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((attachment) => ({
          id: attachment.id,
          type: attachment.type,
          filename: attachment.safeFilename,
          contentType:
            attachment.mimeType ?? attachment.declaredMimeType ?? null,
          size: attachment.size === null ? null : Number(attachment.size),
          availabilityState: attachment.ingestionState,
          accessUrl:
            attachment.ingestionState === 'AVAILABLE'
              ? `/inconnect-messaging/attachments/${attachment.id}`
              : null,
        }));
    }

    const media = message.providerMetadata?.media;

    if (!Array.isArray(media)) {
      return [];
    }

    return media.slice(0, 10).map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return {
          id: null,
          type: message.type,
          filename: 'Attachment',
          contentType: null,
          size: null,
          availabilityState: 'UNKNOWN',
          accessUrl: null,
        };
      }

      const contentType = (item as Record<string, unknown>).contentType;

      return {
        id: null,
        type: message.type,
        filename: message.body.trim() || 'Attachment',
        contentType: typeof contentType === 'string' ? contentType : null,
        size: null,
        availabilityState: 'UNKNOWN',
        accessUrl: null,
      };
    });
  }
}
