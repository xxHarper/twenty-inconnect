import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

export enum InconnectMessagingConversationWorkStateFilter {
  ALL = 'ALL',
  UNREAD = 'UNREAD',
  FAVORITES = 'FAVORITES',
  PENDING = 'PENDING',
}

registerEnumType(InconnectMessagingConversationWorkStateFilter, {
  name: 'InconnectMessagingConversationWorkStateFilter',
});

@ObjectType('InconnectMessagingConversationWorkState')
export class InconnectMessagingConversationWorkStateDTO {
  @Field(() => UUIDScalarType)
  conversationId: string;

  @Field(() => Boolean)
  isFavorite: boolean;

  @Field(() => Boolean)
  isUnread: boolean;

  @Field(() => Boolean)
  isPending: boolean;
}
