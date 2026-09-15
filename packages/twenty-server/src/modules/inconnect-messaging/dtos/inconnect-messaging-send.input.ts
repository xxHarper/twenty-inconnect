import { Field, InputType, ObjectType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType('SendInconnectMessagingMessageInput')
export class SendInconnectMessagingMessageInput {
  @IsUUID()
  @Field(() => UUIDScalarType)
  conversationId: string;

  @IsUUID()
  @Field(() => UUIDScalarType)
  clientRequestId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Field(() => String)
  body: string;
}

@ObjectType('SendInconnectMessagingMessageResult')
export class SendInconnectMessagingMessageResult {
  @Field(() => UUIDScalarType)
  messageId: string;

  @Field(() => String)
  outboundState: string;
}
