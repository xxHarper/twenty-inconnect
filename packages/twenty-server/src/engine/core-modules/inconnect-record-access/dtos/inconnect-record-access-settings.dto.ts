import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  InconnectRecordAccessCacheStatusGraphql,
  InconnectRecordAccessConfigurationStatusGraphql,
  InconnectRecordAccessCreatePolicyGraphql,
  InconnectRecordAccessEnforcementModeGraphql,
  InconnectRecordAccessMissingOwnerPolicyGraphql,
  InconnectRecordAccessOwnerRequirementGraphql,
  InconnectRecordAccessOwnerTransferPolicyGraphql,
  InconnectRecordAccessPrincipalTypeGraphql,
  InconnectRecordAccessRecordEffectGraphql,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-record-access-settings-graphql-enums';
import {
  type InconnectRecordAccessSettingsAvailableMetadata,
  type InconnectRecordAccessSettingsConfiguration,
  type InconnectRecordAccessSettingsManagedObject,
  type InconnectRecordAccessSettingsObjectCandidate,
  type InconnectRecordAccessSettingsOwnerFieldCandidate,
  type InconnectRecordAccessSettingsPolicy,
  type InconnectRecordAccessSettingsRoleCandidate,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-settings.type';
import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import {
  type InconnectRecordAccessEnforcementMode,
  type InconnectRecordAccessPrincipalType,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';

@ObjectType('InconnectRecordAccessSettingsPolicy')
export class InconnectRecordAccessSettingsPolicyDTO implements InconnectRecordAccessSettingsPolicy {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UUIDScalarType)
  roleId: string;

  @Field(() => String)
  roleLabel: string;

  @Field(() => UUIDScalarType)
  roleUniversalIdentifier: string;

  @Field(() => InconnectRecordAccessPrincipalTypeGraphql)
  principalType: InconnectRecordAccessPrincipalType;

  @Field(() => InconnectRecordAccessRecordEffectGraphql)
  recordEffect: InconnectRecordAccessRecordEffect;

  @Field(() => InconnectRecordAccessCreatePolicyGraphql)
  createPolicy: InconnectRecordAccessCreatePolicy;

  @Field(() => InconnectRecordAccessOwnerTransferPolicyGraphql)
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;

  @Field(() => InconnectRecordAccessMissingOwnerPolicyGraphql)
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;

  @Field(() => UUIDScalarType, { nullable: true })
  defaultOwnerRoleId: string | null;

  @Field(() => String, { nullable: true })
  defaultOwnerRoleLabel: string | null;
}

@ObjectType('InconnectRecordAccessSettingsManagedObject')
export class InconnectRecordAccessSettingsManagedObjectDTO implements InconnectRecordAccessSettingsManagedObject {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UUIDScalarType)
  objectMetadataId: string;

  @Field(() => UUIDScalarType)
  objectUniversalIdentifier: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => String)
  objectLabelSingular: string;

  @Field(() => UUIDScalarType)
  ownerFieldMetadataId: string;

  @Field(() => UUIDScalarType)
  ownerFieldUniversalIdentifier: string;

  @Field(() => String)
  ownerFieldName: string;

  @Field(() => String)
  ownerFieldLabel: string;

  @Field(() => InconnectRecordAccessOwnerRequirementGraphql)
  ownerRequirement: InconnectRecordAccessOwnerRequirement;

  @Field(() => [InconnectRecordAccessSettingsPolicyDTO])
  policies: InconnectRecordAccessSettingsPolicyDTO[];
}

@ObjectType('InconnectRecordAccessSettingsConfiguration')
export class InconnectRecordAccessSettingsConfigurationDTO implements InconnectRecordAccessSettingsConfiguration {
  @Field(() => InconnectRecordAccessConfigurationStatusGraphql)
  status: InconnectRecordAccessSettingsConfiguration['status'];

  @Field(() => InconnectRecordAccessEnforcementModeGraphql, { nullable: true })
  enforcementMode: InconnectRecordAccessEnforcementMode | null;

  @Field(() => String, { nullable: true })
  revision: string | null;

  @Field(() => [InconnectRecordAccessSettingsManagedObjectDTO])
  managedObjects: InconnectRecordAccessSettingsManagedObjectDTO[];
}

@ObjectType('InconnectRecordAccessSettingsOwnerFieldCandidate')
export class InconnectRecordAccessSettingsOwnerFieldCandidateDTO implements InconnectRecordAccessSettingsOwnerFieldCandidate {
  @Field(() => UUIDScalarType)
  fieldMetadataId: string;

  @Field(() => UUIDScalarType)
  universalIdentifier: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  label: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => String)
  joinColumnName: string;
}

@ObjectType('InconnectRecordAccessSettingsObjectCandidate')
export class InconnectRecordAccessSettingsObjectCandidateDTO implements InconnectRecordAccessSettingsObjectCandidate {
  @Field(() => UUIDScalarType)
  objectMetadataId: string;

  @Field(() => UUIDScalarType)
  universalIdentifier: string;

  @Field(() => String)
  nameSingular: string;

  @Field(() => String)
  namePlural: string;

  @Field(() => String)
  labelSingular: string;

  @Field(() => String)
  labelPlural: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => [InconnectRecordAccessSettingsOwnerFieldCandidateDTO])
  ownerFields: InconnectRecordAccessSettingsOwnerFieldCandidateDTO[];
}

@ObjectType('InconnectRecordAccessSettingsRoleCandidate')
export class InconnectRecordAccessSettingsRoleCandidateDTO implements InconnectRecordAccessSettingsRoleCandidate {
  @Field(() => UUIDScalarType)
  roleId: string;

  @Field(() => UUIDScalarType)
  universalIdentifier: string;

  @Field(() => String)
  label: string;
}

@ObjectType('InconnectRecordAccessSettingsAvailableMetadata')
export class InconnectRecordAccessSettingsAvailableMetadataDTO implements InconnectRecordAccessSettingsAvailableMetadata {
  @Field(() => [InconnectRecordAccessSettingsObjectCandidateDTO])
  objects: InconnectRecordAccessSettingsObjectCandidateDTO[];

  @Field(() => [InconnectRecordAccessSettingsRoleCandidateDTO])
  roles: InconnectRecordAccessSettingsRoleCandidateDTO[];
}

@ObjectType('ReplaceInconnectRecordAccessConfigurationResult')
export class ReplaceInconnectRecordAccessConfigurationResultDTO {
  @Field(() => String)
  revision: string;

  @Field(() => InconnectRecordAccessCacheStatusGraphql)
  cacheStatus: 'recomputed' | 'recomputation-failed';

  @Field(() => Boolean)
  changedFromManagedToUnmanaged: boolean;
}
