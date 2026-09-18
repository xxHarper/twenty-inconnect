import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { INCONNECT_MESSAGING_ATTACHMENT_TYPES } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@InputType('CreateInconnectMessagingOutboundUploadInput')
export class CreateInconnectMessagingOutboundUploadInput {
  @IsUUID()
  @Field(() => UUIDScalarType)
  clientUploadId: string;

  @IsString()
  @MaxLength(180)
  @Field(() => String)
  filename: string;

  @IsInt()
  @Min(1)
  @Max(16 * 1024 * 1024)
  @Field(() => Int)
  size: number;

  @IsIn(INCONNECT_MESSAGING_ATTACHMENT_TYPES)
  @Field(() => String)
  type: string;
}

@ObjectType('InconnectMessagingOutboundUpload')
export class InconnectMessagingOutboundUploadDTO {
  @Field(() => UUIDScalarType)
  uploadId: string;

  @Field(() => String)
  state: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  filename: string;

  @Field(() => Int)
  size: number;

  @Field(() => String, { nullable: true })
  contentType: string | null;

  @Field(() => String, { nullable: true })
  uploadUrl: string | null;

  @Field(() => String, { nullable: true })
  uploadContentType: string | null;

  @Field(() => Date)
  expiresAt: Date;
}
