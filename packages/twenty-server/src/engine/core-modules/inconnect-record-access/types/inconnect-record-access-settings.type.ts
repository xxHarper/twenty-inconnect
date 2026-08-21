import {
  type InconnectRecordAccessManagedObjectInput,
  type InconnectRecordAccessPolicyInput,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
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

export type InconnectRecordAccessSettingsConfigurationStatus =
  | 'ABSENT'
  | InconnectRecordAccessEnforcementMode;

export type InconnectRecordAccessSettingsPolicy = {
  id: string;
  roleId: string;
  roleLabel: string;
  roleUniversalIdentifier: string;
  principalType: InconnectRecordAccessPrincipalType;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId: string | null;
  defaultOwnerRoleLabel: string | null;
};

export type InconnectRecordAccessSettingsManagedObject = {
  id: string;
  objectMetadataId: string;
  objectUniversalIdentifier: string;
  objectNameSingular: string;
  objectLabelSingular: string;
  ownerFieldMetadataId: string;
  ownerFieldUniversalIdentifier: string;
  ownerFieldName: string;
  ownerFieldLabel: string;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
  policies: InconnectRecordAccessSettingsPolicy[];
};

export type InconnectRecordAccessSettingsConfiguration = {
  status: InconnectRecordAccessSettingsConfigurationStatus;
  enforcementMode: InconnectRecordAccessEnforcementMode | null;
  revision: string | null;
  managedObjects: InconnectRecordAccessSettingsManagedObject[];
};

export type InconnectRecordAccessSettingsOwnerFieldCandidate = {
  fieldMetadataId: string;
  universalIdentifier: string;
  name: string;
  label: string;
  isActive: boolean;
  joinColumnName: string;
};

export type InconnectRecordAccessSettingsObjectCandidate = {
  objectMetadataId: string;
  universalIdentifier: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  isActive: boolean;
  ownerFields: InconnectRecordAccessSettingsOwnerFieldCandidate[];
};

export type InconnectRecordAccessSettingsRoleCandidate = {
  roleId: string;
  universalIdentifier: string;
  label: string;
};

export type InconnectRecordAccessSettingsAvailableMetadata = {
  objects: InconnectRecordAccessSettingsObjectCandidate[];
  roles: InconnectRecordAccessSettingsRoleCandidate[];
};

export type ReplaceInconnectRecordAccessSettingsConfigurationInput = {
  expectedRevision: string | null;
  enforcementMode: InconnectRecordAccessEnforcementMode;
  managedObjects: readonly InconnectRecordAccessManagedObjectInput[];
  policies: readonly (Omit<
    InconnectRecordAccessPolicyInput,
    'defaultOwnerRoleId'
  > & {
    principalType: InconnectRecordAccessPrincipalType;
    defaultOwnerRoleId?: string | null;
  })[];
};
