import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('InconnectMessagingTemplateVariable')
export class InconnectMessagingTemplateVariableDTO {
  @Field(() => String)
  key: string;

  @Field(() => Boolean)
  required: boolean;

  @Field(() => Int)
  maxLength: number;
}

@ObjectType('InconnectMessagingTemplate')
export class InconnectMessagingTemplateDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  displayName: string;

  @Field(() => String)
  language: string;

  @Field(() => String)
  body: string;

  @Field(() => [InconnectMessagingTemplateVariableDTO])
  variables: InconnectMessagingTemplateVariableDTO[];
}

@ObjectType('InconnectMessagingMediaTypeCapability')
export class InconnectMessagingMediaTypeCapabilityDTO {
  @Field(() => String)
  type: string;

  @Field(() => [String])
  mimeTypes: string[];

  @Field(() => Int)
  maxBytes: number;

  @Field(() => Boolean)
  captionSupported: boolean;
}

@ObjectType('InconnectMessagingSendCapabilities')
export class InconnectMessagingSendCapabilitiesDTO {
  @Field(() => Boolean)
  canSend: boolean;

  @Field(() => Boolean)
  canSendFreeform: boolean;

  @Field(() => Boolean)
  canSendTemplate: boolean;

  @Field(() => Boolean)
  canSendMedia: boolean;

  @Field(() => Int)
  maxMediaItems: number;

  @Field(() => [InconnectMessagingMediaTypeCapabilityDTO])
  mediaTypes: InconnectMessagingMediaTypeCapabilityDTO[];

  @Field(() => String)
  sessionWindowState: string;

  @Field(() => Date, { nullable: true })
  freeformWindowExpiresAt: Date | null;

  @Field(() => String, { nullable: true })
  freeformUnavailableReason: string | null;

  @Field(() => String, { nullable: true })
  templateUnavailableReason: string | null;
}

@ObjectType('InconnectMessagingTemplateVariableValue')
export class InconnectMessagingTemplateVariableValueDTO {
  @Field(() => String)
  key: string;

  @Field(() => String)
  value: string;
}

@ObjectType('InconnectMessagingMessageTemplateAudit')
export class InconnectMessagingMessageTemplateAuditDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  displayName: string;

  @Field(() => String)
  language: string;

  @Field(() => [InconnectMessagingTemplateVariableValueDTO])
  variables: InconnectMessagingTemplateVariableValueDTO[];
}
