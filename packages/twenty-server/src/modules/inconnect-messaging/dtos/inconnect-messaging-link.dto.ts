import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { PageInfoDTO } from 'src/engine/metadata-modules/pagination/dtos/page-info.dto';
import { InconnectMessagingContextFieldDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';

@ObjectType('InconnectMessagingConversationLinkCandidate')
export class InconnectMessagingConversationLinkCandidateDTO {
  @Field(() => UUIDScalarType)
  recordId: string;

  @Field(() => String, { nullable: true })
  recordLabel: string | null;

  @Field(() => [InconnectMessagingContextFieldDTO])
  fields: InconnectMessagingContextFieldDTO[];
}

@ObjectType('InconnectMessagingConversationLinkCandidateEdge')
export class InconnectMessagingConversationLinkCandidateEdgeDTO {
  @Field(() => InconnectMessagingConversationLinkCandidateDTO)
  node: InconnectMessagingConversationLinkCandidateDTO;

  @Field(() => String)
  cursor: string;
}

@ObjectType('InconnectMessagingConversationLinkCandidateConnection')
export class InconnectMessagingConversationLinkCandidateConnectionDTO {
  @Field(() => [InconnectMessagingConversationLinkCandidateEdgeDTO])
  edges: InconnectMessagingConversationLinkCandidateEdgeDTO[];

  @Field(() => PageInfoDTO)
  pageInfo: PageInfoDTO;

  @Field(() => Int)
  totalCount: number;
}
