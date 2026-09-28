import {
  Field,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

export enum InconnectMessagingPhoneIdentityFieldRoleDTO {
  PRIMARY = 'PRIMARY',
  MATCH_ONLY = 'MATCH_ONLY',
}

registerEnumType(InconnectMessagingPhoneIdentityFieldRoleDTO, {
  name: 'InconnectMessagingPhoneIdentityFieldRole',
});

@InputType('InconnectMessagingPhoneIdentityFieldInput')
export class InconnectMessagingPhoneIdentityFieldInput {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => InconnectMessagingPhoneIdentityFieldRoleDTO)
  role: InconnectMessagingPhoneIdentityFieldRoleDTO;
}

@ObjectType('InconnectMessagingPhoneIdentityConfiguredField')
export class InconnectMessagingPhoneIdentityConfiguredFieldDTO {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => String)
  label: string;

  @Field(() => String)
  type: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => InconnectMessagingPhoneIdentityFieldRoleDTO)
  role: InconnectMessagingPhoneIdentityFieldRoleDTO;

  @Field(() => Int)
  ordinal: number;
}

@ObjectType('InconnectMessagingPhoneIdentityCandidateField')
export class InconnectMessagingPhoneIdentityCandidateFieldDTO {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => String)
  label: string;

  @Field(() => String)
  type: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => [InconnectMessagingPhoneIdentityFieldRoleDTO])
  eligibleRoles: InconnectMessagingPhoneIdentityFieldRoleDTO[];
}

@ObjectType('InconnectMessagingPhoneIdentityAnchor')
export class InconnectMessagingPhoneIdentityAnchorDTO {
  @Field(() => UUIDScalarType)
  objectMetadataId: string;

  @Field(() => String)
  label: string;
}

@ObjectType('InconnectMessagingPhoneIdentityConfiguration')
export class InconnectMessagingPhoneIdentityConfigurationDTO {
  @Field(() => InconnectMessagingPhoneIdentityAnchorDTO)
  anchorObject: InconnectMessagingPhoneIdentityAnchorDTO;

  @Field(() => [InconnectMessagingPhoneIdentityConfiguredFieldDTO])
  fields: InconnectMessagingPhoneIdentityConfiguredFieldDTO[];

  @Field(() => [InconnectMessagingPhoneIdentityCandidateFieldDTO])
  availableFields: InconnectMessagingPhoneIdentityCandidateFieldDTO[];

  @Field(() => Int)
  maximumFieldCount: number;
}
