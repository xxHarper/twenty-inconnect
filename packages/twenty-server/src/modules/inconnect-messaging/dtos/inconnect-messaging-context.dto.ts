import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

export enum InconnectMessagingContextState {
  UNASSIGNED = 'UNASSIGNED',
  LINKED = 'LINKED',
}

export enum InconnectMessagingContextValueKind {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  DATE = 'DATE',
  DATE_TIME = 'DATE_TIME',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  URL = 'URL',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
}

registerEnumType(InconnectMessagingContextState, {
  name: 'InconnectMessagingContextState',
});
registerEnumType(InconnectMessagingContextValueKind, {
  name: 'InconnectMessagingContextValueKind',
});

@ObjectType('InconnectMessagingContextObject')
export class InconnectMessagingContextObjectDTO {
  @Field(() => UUIDScalarType)
  objectMetadataId: string;

  @Field(() => String)
  label: string;
}

@ObjectType('InconnectMessagingContextRecord')
export class InconnectMessagingContextRecordDTO {
  @Field(() => UUIDScalarType)
  recordId: string;

  @Field(() => String, { nullable: true })
  recordLabel: string | null;
}

@ObjectType('InconnectMessagingContextField')
export class InconnectMessagingContextFieldDTO {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => String)
  label: string;

  @Field(() => InconnectMessagingContextValueKind)
  valueKind: InconnectMessagingContextValueKind;

  @Field(() => String, { nullable: true })
  displayValue: string | null;

  @Field(() => Int)
  ordinal: number;
}

@ObjectType('InconnectMessagingConversationContext')
export class InconnectMessagingConversationContextDTO {
  @Field(() => InconnectMessagingContextState)
  state: InconnectMessagingContextState;

  @Field(() => InconnectMessagingContextObjectDTO, { nullable: true })
  object: InconnectMessagingContextObjectDTO | null;

  @Field(() => InconnectMessagingContextRecordDTO, { nullable: true })
  record: InconnectMessagingContextRecordDTO | null;

  @Field(() => [InconnectMessagingContextFieldDTO])
  fields: InconnectMessagingContextFieldDTO[];
}

@ObjectType('InconnectMessagingContextConfiguredField')
export class InconnectMessagingContextConfiguredFieldDTO {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => String)
  label: string;

  @Field(() => InconnectMessagingContextValueKind)
  valueKind: InconnectMessagingContextValueKind;

  @Field(() => Int)
  ordinal: number;
}

@ObjectType('InconnectMessagingContextCandidateField')
export class InconnectMessagingContextCandidateFieldDTO {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => String)
  label: string;

  @Field(() => InconnectMessagingContextValueKind)
  valueKind: InconnectMessagingContextValueKind;

  @Field(() => Boolean)
  isLabelIdentifier: boolean;
}

@ObjectType('InconnectMessagingContextConfiguration')
export class InconnectMessagingContextConfigurationDTO {
  @Field(() => InconnectMessagingContextObjectDTO)
  anchorObject: InconnectMessagingContextObjectDTO;

  @Field(() => [InconnectMessagingContextConfiguredFieldDTO])
  fields: InconnectMessagingContextConfiguredFieldDTO[];

  @Field(() => [InconnectMessagingContextCandidateFieldDTO])
  availableFields: InconnectMessagingContextCandidateFieldDTO[];

  @Field(() => Int)
  maximumFieldCount: number;
}
