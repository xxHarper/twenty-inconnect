import { Field, InputType } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  InconnectRecordAccessCreatePolicyGraphql,
  InconnectRecordAccessEnforcementModeGraphql,
  InconnectRecordAccessMissingOwnerPolicyGraphql,
  InconnectRecordAccessOwnerRequirementGraphql,
  InconnectRecordAccessOwnerTransferPolicyGraphql,
  InconnectRecordAccessPrincipalTypeGraphql,
  InconnectRecordAccessRecordEffectGraphql,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-record-access-settings-graphql-enums';
import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import {
  INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES,
  INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES,
  type InconnectRecordAccessEnforcementMode,
  type InconnectRecordAccessPrincipalType,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';

const RECORD_EFFECTS = [
  'ownRecords',
  'ownAndTeamRecords',
  'allRecords',
] as const;
const CREATE_POLICIES = [
  'denied',
  'defaultOwner',
  'assignableOwners',
  'standardPermissionsOnly',
] as const;
const OWNER_TRANSFER_POLICIES = [
  'denied',
  'assignableOwners',
  'standardPermissionsOnly',
] as const;
const OWNER_REQUIREMENTS = ['required', 'optional'] as const;
const MISSING_OWNER_POLICIES = [
  'self',
  'requireExplicit',
  'singleActiveMemberOfRole',
  'standard',
] as const;

@InputType('InconnectRecordAccessManagedObjectInput')
export class InconnectRecordAccessManagedObjectInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  objectMetadataId: string;

  @Field(() => UUIDScalarType)
  @IsUUID()
  ownerFieldMetadataId: string;

  @Field(() => InconnectRecordAccessOwnerRequirementGraphql)
  @IsIn(OWNER_REQUIREMENTS)
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
}

@InputType('InconnectRecordAccessPolicyInput')
export class InconnectRecordAccessPolicyInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  objectMetadataId: string;

  @Field(() => UUIDScalarType)
  @IsUUID()
  roleId: string;

  @Field(() => InconnectRecordAccessPrincipalTypeGraphql)
  @IsIn(INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES)
  principalType: InconnectRecordAccessPrincipalType;

  @Field(() => InconnectRecordAccessRecordEffectGraphql)
  @IsIn(RECORD_EFFECTS)
  recordEffect: InconnectRecordAccessRecordEffect;

  @Field(() => InconnectRecordAccessCreatePolicyGraphql)
  @IsIn(CREATE_POLICIES)
  createPolicy: InconnectRecordAccessCreatePolicy;

  @Field(() => InconnectRecordAccessOwnerTransferPolicyGraphql)
  @IsIn(OWNER_TRANSFER_POLICIES)
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;

  @Field(() => InconnectRecordAccessMissingOwnerPolicyGraphql)
  @IsIn(MISSING_OWNER_POLICIES)
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;

  @Field(() => UUIDScalarType, { nullable: true })
  @ValidateIf((_input, value) => value !== null && value !== undefined)
  @IsUUID()
  defaultOwnerRoleId?: string | null;
}

@InputType('ReplaceInconnectRecordAccessConfigurationInput')
export class ReplaceInconnectRecordAccessConfigurationInputDTO {
  @Field(() => String, { nullable: true })
  @ValidateIf((_input, value) => value !== null)
  @Matches(/^(0|[1-9][0-9]*)$/)
  expectedRevision: string | null;

  @Field(() => InconnectRecordAccessEnforcementModeGraphql)
  @IsIn(INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES)
  enforcementMode: InconnectRecordAccessEnforcementMode;

  @Field(() => [InconnectRecordAccessManagedObjectInputDTO])
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InconnectRecordAccessManagedObjectInputDTO)
  managedObjects: InconnectRecordAccessManagedObjectInputDTO[];

  @Field(() => [InconnectRecordAccessPolicyInputDTO])
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InconnectRecordAccessPolicyInputDTO)
  policies: InconnectRecordAccessPolicyInputDTO[];
}
