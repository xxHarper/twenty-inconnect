import {
  Field,
  InputType,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

export enum InconnectMessagingAutoCreateOwnerStrategyDTO {
  UNIQUE_ACTIVE_MEMBER_OF_ROLE = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
}

registerEnumType(InconnectMessagingAutoCreateOwnerStrategyDTO, {
  name: 'InconnectMessagingAutoCreateOwnerStrategy',
});

export enum InconnectMessagingAutoCreateLabelPolicyDTO {
  OMIT = 'OMIT',
}

registerEnumType(InconnectMessagingAutoCreateLabelPolicyDTO, {
  name: 'InconnectMessagingAutoCreateLabelPolicy',
});

export enum InconnectMessagingAutoCreateReadinessDTO {
  DISABLED = 'DISABLED',
  INVALID = 'INVALID',
  NOT_READY = 'NOT_READY',
  READY_FOR_RUNTIME = 'READY_FOR_RUNTIME',
}

registerEnumType(InconnectMessagingAutoCreateReadinessDTO, {
  name: 'InconnectMessagingAutoCreateReadiness',
});

export enum InconnectMessagingAutoCreateValidationIssueDTO {
  CONFIGURATION_INCOMPLETE = 'CONFIGURATION_INCOMPLETE',
  CURRENT_ANCHOR_INVALID = 'CURRENT_ANCHOR_INVALID',
  CONFIGURED_ANCHOR_MISMATCH = 'CONFIGURED_ANCHOR_MISMATCH',
  PRIMARY_MISSING = 'PRIMARY_MISSING',
  PRIMARY_MULTIPLE = 'PRIMARY_MULTIPLE',
  PRIMARY_METADATA_MISSING = 'PRIMARY_METADATA_MISSING',
  PRIMARY_WRONG_WORKSPACE = 'PRIMARY_WRONG_WORKSPACE',
  PRIMARY_WRONG_ANCHOR = 'PRIMARY_WRONG_ANCHOR',
  PRIMARY_INACTIVE = 'PRIMARY_INACTIVE',
  PRIMARY_WRONG_TYPE = 'PRIMARY_WRONG_TYPE',
  OWNER_STRATEGY_INVALID = 'OWNER_STRATEGY_INVALID',
  OWNER_ROLE_INVALID = 'OWNER_ROLE_INVALID',
  LABEL_POLICY_INVALID = 'LABEL_POLICY_INVALID',
  REQUIRED_FIELD_UNSATISFIED = 'REQUIRED_FIELD_UNSATISFIED',
  OWNER_CONFIGURATION_INVALID = 'OWNER_CONFIGURATION_INVALID',
  PHONE_UNIQUENESS_NOT_GUARANTEED = 'PHONE_UNIQUENESS_NOT_GUARANTEED',
  UNSUPPORTED_REQUIRED_FIELD = 'UNSUPPORTED_REQUIRED_FIELD',
  UNSUPPORTED_ANCHOR = 'UNSUPPORTED_ANCHOR',
  METADATA_INVALID = 'METADATA_INVALID',
  RUNTIME_NOT_IMPLEMENTED = 'RUNTIME_NOT_IMPLEMENTED',
}

registerEnumType(InconnectMessagingAutoCreateValidationIssueDTO, {
  name: 'InconnectMessagingAutoCreateValidationIssue',
});

export enum InconnectMessagingAutoCreatePrimaryStatusDTO {
  VALID = 'VALID',
  MISSING = 'MISSING',
  MULTIPLE = 'MULTIPLE',
  METADATA_MISSING = 'METADATA_MISSING',
  WRONG_WORKSPACE = 'WRONG_WORKSPACE',
  WRONG_ANCHOR = 'WRONG_ANCHOR',
  INACTIVE = 'INACTIVE',
  WRONG_TYPE = 'WRONG_TYPE',
}

registerEnumType(InconnectMessagingAutoCreatePrimaryStatusDTO, {
  name: 'InconnectMessagingAutoCreatePrimaryStatus',
});

@InputType('InconnectMessagingAutoCreateConfigurationInput')
export class InconnectMessagingAutoCreateConfigurationInput {
  @Field(() => Boolean)
  enabled: boolean;

  @Field(() => InconnectMessagingAutoCreateOwnerStrategyDTO)
  ownerStrategy: InconnectMessagingAutoCreateOwnerStrategyDTO;

  @Field(() => UUIDScalarType)
  ownerRoleId: string;

  @Field(() => InconnectMessagingAutoCreateLabelPolicyDTO)
  labelPolicy: InconnectMessagingAutoCreateLabelPolicyDTO;
}

@ObjectType('InconnectMessagingAutoCreateAnchor')
export class InconnectMessagingAutoCreateAnchorDTO {
  @Field(() => UUIDScalarType)
  objectMetadataId: string;

  @Field(() => String)
  label: string;
}

@ObjectType('InconnectMessagingAutoCreatePrimaryPhoneIdentity')
export class InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO {
  @Field(() => InconnectMessagingAutoCreatePrimaryStatusDTO)
  status: InconnectMessagingAutoCreatePrimaryStatusDTO;

  @Field(() => UUIDScalarType, { nullable: true })
  fieldMetadataId: string | null;

  @Field(() => String, { nullable: true })
  label: string | null;

  @Field(() => String, { nullable: true })
  type: string | null;

  @Field(() => Boolean, { nullable: true })
  isActive: boolean | null;
}

@ObjectType('InconnectMessagingAutoCreateOwnerRole')
export class InconnectMessagingAutoCreateOwnerRoleDTO {
  @Field(() => UUIDScalarType)
  roleId: string;

  @Field(() => String)
  label: string;
}

@ObjectType('InconnectMessagingAutoCreateStoredConfiguration')
export class InconnectMessagingAutoCreateStoredConfigurationDTO {
  @Field(() => Boolean)
  enabled: boolean;

  @Field(() => UUIDScalarType, { nullable: true })
  configuredAnchorObjectMetadataId: string | null;

  @Field(() => InconnectMessagingAutoCreateOwnerStrategyDTO, {
    nullable: true,
  })
  ownerStrategy: InconnectMessagingAutoCreateOwnerStrategyDTO | null;

  @Field(() => UUIDScalarType, { nullable: true })
  ownerRoleId: string | null;

  @Field(() => InconnectMessagingAutoCreateLabelPolicyDTO, {
    nullable: true,
  })
  labelPolicy: InconnectMessagingAutoCreateLabelPolicyDTO | null;
}

@ObjectType('InconnectMessagingAutoCreateConfiguration')
export class InconnectMessagingAutoCreateConfigurationDTO {
  @Field(() => InconnectMessagingAutoCreateAnchorDTO, { nullable: true })
  anchorObject: InconnectMessagingAutoCreateAnchorDTO | null;

  @Field(() => InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO)
  primaryPhoneIdentity: InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO;

  @Field(() => InconnectMessagingAutoCreateStoredConfigurationDTO, {
    nullable: true,
  })
  configuration: InconnectMessagingAutoCreateStoredConfigurationDTO | null;

  @Field(() => [InconnectMessagingAutoCreateOwnerRoleDTO])
  eligibleOwnerRoles: InconnectMessagingAutoCreateOwnerRoleDTO[];

  @Field(() => InconnectMessagingAutoCreateReadinessDTO)
  readiness: InconnectMessagingAutoCreateReadinessDTO;

  @Field(() => [InconnectMessagingAutoCreateValidationIssueDTO])
  validationIssues: InconnectMessagingAutoCreateValidationIssueDTO[];

  @Field(() => Boolean)
  effectiveEnabled: boolean;
}
