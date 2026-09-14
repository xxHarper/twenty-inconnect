import { Field, InputType, Int } from '@nestjs/graphql';

import { ConnectionCursorScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType('InconnectMessagingPaging')
export class InconnectMessagingPagingInput {
  @Field(() => Int, { nullable: true })
  first?: number;

  @Field(() => ConnectionCursorScalarType, { nullable: true })
  after?: string;
}
