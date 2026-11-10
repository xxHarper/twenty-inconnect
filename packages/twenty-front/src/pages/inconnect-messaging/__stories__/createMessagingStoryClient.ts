import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { delay, of } from 'rxjs';

import { type InconnectMessagingConversation } from '@/inconnect-messaging/types/InconnectMessagingRead';
import {
  InconnectMessagingContextState,
  InconnectMessagingContextValueKind,
  InconnectMessagingConversationWorkStateFilter,
  type InconnectMessagingConversationContextQuery,
  type InconnectMessagingConversationWorkState,
  type InconnectMessagingConversationsQueryVariables,
  type InconnectMessagingMessagesQuery,
  type InconnectMessagingPaging,
  type InconnectMessagingSendCapabilitiesQuery,
} from '~/generated-metadata/graphql';
import { createMessagingStoryFixtures } from '~/pages/inconnect-messaging/__stories__/messagingStoryFixtures';

type DemoConversation = ReturnType<typeof createMessagingStoryFixtures>[number];

const rejectOperation = (message: string) =>
  of({ errors: [new GraphQLError(message)] });

const latestInbound = ({ messages }: DemoConversation) =>
  messages.findLast(({ node }) => node.direction === 'INBOUND');

const page = <Node extends { id: string }, EdgeName extends string>(
  nodes: Node[],
  edgeName: EdgeName,
  paging?: InconnectMessagingPaging | null,
) => {
  const first = paging?.first ?? 30;
  const after = paging?.after;
  const start =
    after == null ? 0 : nodes.findIndex(({ id }) => id === after) + 1;
  const slice =
    after != null && start === 0 ? [] : nodes.slice(start, start + first);
  return {
    edges: slice.map((node) => ({
      __typename: edgeName,
      cursor: node.id,
      node,
    })),
    pageInfo: {
      __typename: 'PageInfo' as const,
      hasNextPage: slice.length > 0 && start + slice.length < nodes.length,
      endCursor: slice.at(-1)?.id ?? null,
    },
  };
};

const disabledCapabilities: InconnectMessagingSendCapabilitiesQuery = {
  inconnectMessagingSendCapabilities: {
    __typename: 'InconnectMessagingSendCapabilities',
    canSend: false,
    canSendFreeform: false,
    canSendTemplate: false,
    canSendMedia: false,
    maxMediaItems: 0,
    sessionWindowState: 'CLOSED',
    freeformWindowExpiresAt: null,
    freeformUnavailableReason: 'SESSION_WINDOW_CLOSED',
    templateUnavailableReason: null,
    mediaTypes: [],
  },
};

export const createMessagingStoryClient = () => {
  const conversations = createMessagingStoryFixtures();
  const leadObjectId = crypto.randomUUID();
  const interestFieldId = crypto.randomUUID();
  const stageFieldId = crypto.randomUUID();
  // This map belongs to the one simulated viewer in this story instance.
  const personal = new Map(
    conversations.map((conversation) => [
      conversation.id,
      {
        favorite: conversation.favorite ?? false,
        manualUnread: false,
        readArrival: conversation.unread
          ? 0
          : (latestInbound(conversation)?.arrival ?? 0),
      },
    ]),
  );
  const sharedPending = new Set(
    conversations.filter(({ pending }) => pending).map(({ id }) => id),
  );

  const workState = (
    conversation: DemoConversation,
  ): InconnectMessagingConversationWorkState => {
    const state = personal.get(conversation.id)!;
    return {
      __typename: 'InconnectMessagingConversationWorkState',
      conversationId: conversation.id,
      isFavorite: state.favorite,
      isUnread:
        state.manualUnread ||
        (latestInbound(conversation)?.arrival ?? 0) > state.readArrival,
      isPending: sharedPending.has(conversation.id),
    };
  };

  const readConversation = (
    conversation: DemoConversation,
  ): InconnectMessagingConversation => {
    const { isFavorite, isPending, isUnread } = workState(conversation);
    return {
      __typename: 'InconnectMessagingConversation',
      id: conversation.id,
      externalAddress: conversation.address,
      isLinked: true,
      isFavorite,
      isUnread,
      isPending,
      lastInboundAt: latestInbound(conversation)?.node.displayAt ?? null,
      createdAt: conversation.createdAt,
    };
  };

  // Terminating link. Operation results are snapshots scoped to their variables.
  const link = new ApolloLink(({ operationName, variables }) => {
    if (operationName === 'InconnectMessagingConversations') {
      const {
        search,
        workState: filter,
        paging,
      } = variables as InconnectMessagingConversationsQueryVariables;
      const term = search?.trim().toLowerCase() ?? '';
      const rows = conversations.map(readConversation).filter((row) => {
        if (!row.externalAddress.toLowerCase().includes(term)) return false;
        switch (filter) {
          case InconnectMessagingConversationWorkStateFilter.UNREAD:
            return row.isUnread;
          case InconnectMessagingConversationWorkStateFilter.FAVORITES:
            return row.isFavorite;
          case InconnectMessagingConversationWorkStateFilter.PENDING:
            return row.isPending;
          default:
            return true;
        }
      });
      return of({
        data: {
          inconnectMessagingConversations: {
            __typename: 'InconnectMessagingConversationConnection',
            ...page(rows, 'InconnectMessagingConversationEdge', paging),
          },
        },
      });
    }

    const conversation = conversations.find(
      ({ id }) => id === (variables.conversationId ?? variables.id),
    );
    if (!conversation)
      return rejectOperation('Unknown operation or demo conversation.');

    switch (operationName) {
      case 'InconnectMessagingConversation':
        return of({
          data: {
            inconnectMessagingConversation: readConversation(conversation),
          },
        });
      case 'InconnectMessagingMessages': {
        const displayOrder = conversation.messages
          .map(({ node }) => node)
          .toSorted((left, right) =>
            right.displayAt.localeCompare(left.displayAt),
          );
        const snapshot = page(
          displayOrder,
          'InconnectMessagingMessageEdge',
          variables.paging as InconnectMessagingPaging | undefined,
        );
        const inboundId = latestInbound(conversation)?.node.id;
        const data: InconnectMessagingMessagesQuery = {
          inconnectMessagingMessages: {
            __typename: 'InconnectMessagingMessageConnection',
            ...snapshot,
            readThroughMessageId: snapshot.edges.some(
              ({ node }) => node.id === inboundId,
            )
              ? inboundId
              : null,
          },
        };
        return of({ data });
      }
      case 'InconnectMessagingConversationContext': {
        const data: InconnectMessagingConversationContextQuery = {
          inconnectMessagingConversationContext: {
            __typename: 'InconnectMessagingConversationContext',
            state: InconnectMessagingContextState.LINKED,
            object: {
              __typename: 'InconnectMessagingContextObject',
              objectMetadataId: leadObjectId,
              label: 'Lead',
            },
            record: {
              __typename: 'InconnectMessagingContextRecord',
              recordId: conversation.recordId,
              recordLabel: conversation.recordLabel,
            },
            fields: [
              {
                __typename: 'InconnectMessagingContextField',
                fieldMetadataId: interestFieldId,
                label: 'Interés',
                valueKind: InconnectMessagingContextValueKind.TEXT,
                displayValue: conversation.interest,
                ordinal: 0,
              },
              {
                __typename: 'InconnectMessagingContextField',
                fieldMetadataId: stageFieldId,
                label: 'Etapa',
                valueKind: InconnectMessagingContextValueKind.TEXT,
                displayValue: conversation.stage,
                ordinal: 1,
              },
            ],
          },
        };
        return of({ data });
      }
      case 'InconnectMessagingSendCapabilities':
        return of({ data: disabledCapabilities });
    }

    const state = personal.get(conversation.id)!;
    switch (operationName) {
      case 'SetInconnectMessagingConversationFavorite':
        if (typeof variables.favorite !== 'boolean')
          return rejectOperation('Invalid favorite.');
        state.favorite = variables.favorite;
        break;
      case 'SetInconnectMessagingConversationPending':
        if (typeof variables.pending !== 'boolean')
          return rejectOperation('Invalid pending.');
        if (variables.pending) sharedPending.add(conversation.id);
        else sharedPending.delete(conversation.id);
        break;
      case 'MarkInconnectMessagingConversationUnread':
        state.manualUnread = true;
        break;
      case 'MarkInconnectMessagingConversationRead': {
        const target =
          variables.throughMessageId == null
            ? latestInbound(conversation)
            : conversation.messages.find(
                ({ node }) =>
                  node.direction === 'INBOUND' &&
                  node.id === variables.throughMessageId,
              );
        if (variables.throughMessageId != null && !target) {
          return rejectOperation(
            'Read target must be an inbound message in this conversation.',
          );
        }
        state.manualUnread = false;
        state.readArrival = Math.max(state.readArrival, target?.arrival ?? 0);
        break;
      }
      default:
        return rejectOperation('This operation is outside the Messaging demo.');
    }

    const field =
      operationName.charAt(0).toLowerCase() + operationName.slice(1);
    return of({ data: { [field]: workState(conversation) } });
  });

  // Deliver results asynchronously while keeping the snapshot bound to its request.
  const transport = new ApolloLink((operation, forward) =>
    forward(operation).pipe(delay(0)),
  );
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: transport.concat(link),
  });
};
