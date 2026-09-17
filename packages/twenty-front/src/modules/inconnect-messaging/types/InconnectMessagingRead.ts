import type {
  InconnectMessagingConversationQuery,
  InconnectMessagingMessagesQuery,
  InconnectMessagingTemplatesQuery,
} from '~/generated-metadata/graphql';

export type InconnectMessagingConversation = NonNullable<
  InconnectMessagingConversationQuery['inconnectMessagingConversation']
>;

export type InconnectMessagingMessage = NonNullable<
  InconnectMessagingMessagesQuery['inconnectMessagingMessages']
>['edges'][number]['node'];

export type InconnectMessagingTemplate = NonNullable<
  InconnectMessagingTemplatesQuery['inconnectMessagingTemplates']
>[number];
