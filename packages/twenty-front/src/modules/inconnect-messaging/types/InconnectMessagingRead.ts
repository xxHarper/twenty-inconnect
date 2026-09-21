import type {
  InconnectMessagingConversationQuery,
  InconnectMessagingConversationsQuery,
  InconnectMessagingMessagesQuery,
  InconnectMessagingTemplatesQuery,
} from '~/generated-metadata/graphql';

export type InconnectMessagingConversation = NonNullable<
  InconnectMessagingConversationQuery['inconnectMessagingConversation']
>;

export type InconnectMessagingConversationListItem = NonNullable<
  InconnectMessagingConversationsQuery['inconnectMessagingConversations']
>['edges'][number]['node'];

export type InconnectMessagingMessage = NonNullable<
  InconnectMessagingMessagesQuery['inconnectMessagingMessages']
>['edges'][number]['node'];

export type InconnectMessagingTemplate = NonNullable<
  InconnectMessagingTemplatesQuery['inconnectMessagingTemplates']
>[number];
