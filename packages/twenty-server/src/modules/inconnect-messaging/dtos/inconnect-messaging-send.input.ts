import { Field, InputType, ObjectType } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType('InconnectMessagingTemplateVariableInput')
export class InconnectMessagingTemplateVariableInput {
  @IsString()
  @MaxLength(64)
  @Field(() => String)
  key: string;

  @IsString()
  @MaxLength(10_000)
  @Field(() => String)
  value: string;
}

@InputType('SendInconnectMessagingMessageInput')
export class SendInconnectMessagingMessageInput {
  @IsUUID()
  @Field(() => UUIDScalarType)
  conversationId: string;

  @IsUUID()
  @Field(() => UUIDScalarType)
  clientRequestId: string;

  @IsIn(['FREEFORM', 'TEMPLATE'])
  @Field(() => String)
  mode: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  @Field(() => String, { nullable: true })
  body?: string;

  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  templateId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InconnectMessagingTemplateVariableInput)
  @Field(() => [InconnectMessagingTemplateVariableInput], { nullable: true })
  templateVariables?: InconnectMessagingTemplateVariableInput[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  @Field(() => [UUIDScalarType], { nullable: true })
  outboundUploadIds?: string[];
}

@ObjectType('SendInconnectMessagingMessageResult')
export class SendInconnectMessagingMessageResult {
  @Field(() => UUIDScalarType)
  messageId: string;

  @Field(() => String)
  outboundState: string;
}
