import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { PageInfoDTO } from 'src/engine/metadata-modules/pagination/dtos/page-info.dto';
import { InconnectMessagingMessageTemplateAuditDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';

@ObjectType('InconnectMessagingConversation')
export class InconnectMessagingConversationDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  externalAddress: string;

  @Field(() => Boolean)
  isLinked: boolean;

  @Field(() => UUIDScalarType, { nullable: true })
  linkedRecordObjectMetadataId: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  linkedRecordId: string | null;

  @Field(() => Date, { nullable: true })
  lastInboundAt: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType('InconnectMessagingConversationEdge')
export class InconnectMessagingConversationEdgeDTO {
  @Field(() => InconnectMessagingConversationDTO)
  node: InconnectMessagingConversationDTO;

  @Field(() => String)
  cursor: string;
}

@ObjectType('InconnectMessagingConversationConnection')
export class InconnectMessagingConversationConnectionDTO {
  @Field(() => [InconnectMessagingConversationEdgeDTO])
  edges: InconnectMessagingConversationEdgeDTO[];

  @Field(() => PageInfoDTO)
  pageInfo: PageInfoDTO;

  @Field(() => Int)
  totalCount: number;
}

@ObjectType('InconnectMessagingLocation')
export class InconnectMessagingLocationDTO {
  @Field(() => String)
  latitude: string;

  @Field(() => String)
  longitude: string;

  @Field(() => String, { nullable: true })
  label: string | null;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field(() => String, { nullable: true })
  address: string | null;
}

@ObjectType('InconnectMessagingMedia')
export class InconnectMessagingMediaDTO {
  @Field(() => String, { nullable: true })
  contentType: string | null;
}

@ObjectType('InconnectMessagingMessage')
export class InconnectMessagingMessageDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  direction: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  body: string;

  @Field(() => String, { nullable: true })
  sendMode: string | null;

  @Field(() => String, { nullable: true })
  outboundState: string | null;

  @Field(() => Date)
  displayAt: Date;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => InconnectMessagingLocationDTO, { nullable: true })
  location: InconnectMessagingLocationDTO | null;

  @Field(() => [InconnectMessagingMediaDTO])
  media: InconnectMessagingMediaDTO[];

  @Field(() => InconnectMessagingMessageTemplateAuditDTO, { nullable: true })
  template: InconnectMessagingMessageTemplateAuditDTO | null;
}

@ObjectType('InconnectMessagingMessageEdge')
export class InconnectMessagingMessageEdgeDTO {
  @Field(() => InconnectMessagingMessageDTO)
  node: InconnectMessagingMessageDTO;

  @Field(() => String)
  cursor: string;
}

@ObjectType('InconnectMessagingMessageConnection')
export class InconnectMessagingMessageConnectionDTO {
  @Field(() => [InconnectMessagingMessageEdgeDTO])
  edges: InconnectMessagingMessageEdgeDTO[];

  @Field(() => PageInfoDTO)
  pageInfo: PageInfoDTO;

  @Field(() => Int)
  totalCount: number;
}

@ObjectType('InconnectMessagingRealtimeEvent')
export class InconnectMessagingRealtimeEventDTO {
  @Field(() => UUIDScalarType)
  eventId: string;

  @Field(() => String)
  eventType: string;

  @Field(() => UUIDScalarType)
  conversationId: string;

  @Field(() => UUIDScalarType, { nullable: true })
  messageId: string | null;

  @Field(() => Date)
  occurredAt: Date;
}
