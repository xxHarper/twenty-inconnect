import type {
  InconnectMessagingConversationQuery,
  InconnectMessagingMessagesQuery,
} from '~/generated-metadata/graphql';

export type InconnectMessagingConversation = NonNullable<
  InconnectMessagingConversationQuery['inconnectMessagingConversation']
>;

export type InconnectMessagingMessage = NonNullable<
  InconnectMessagingMessagesQuery['inconnectMessagingMessages']
>['edges'][number]['node'];
