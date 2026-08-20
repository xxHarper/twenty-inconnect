import { type FieldMetadataType } from 'twenty-shared/types';

import { type RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

export const INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES = [
  'MANAGED',
  'UNMANAGED',
] as const;

export type InconnectRecordAccessEnforcementMode =
  (typeof INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES)[number];

export const INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES = [
  'WORKSPACE_MEMBER',
] as const;

export type InconnectRecordAccessPrincipalType =
  (typeof INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES)[number];

export type InconnectRecordAccessPersistedConfigurationCandidate = {
  workspaceId: string;
  enforcementMode: string;
  revision: string | number | bigint;
};

export type InconnectRecordAccessPersistedManagedObjectCandidate = {
  id: string;
  workspaceId: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerRequirement: string;
};

export type InconnectRecordAccessPersistedPolicyCandidate = {
  id: string;
  workspaceId: string;
  managedObjectId: string;
  roleId: string;
  principalType: string;
  recordEffect: string;
  createPolicy: string;
  ownerTransferPolicy: string;
  missingOwnerPolicy: string;
  defaultOwnerRoleId: string | null;
};

export type InconnectRecordAccessValidationRole = {
  id: string;
  workspaceId: string;
};

export type InconnectRecordAccessValidationObject = {
  id: string;
  workspaceId: string;
  universalIdentifier: string;
  isActive: boolean;
};

export type InconnectRecordAccessValidationField = {
  id: string;
  workspaceId: string;
  objectMetadataId: string;
  name: string;
  type: FieldMetadataType | string;
  isActive: boolean;
  relationTargetObjectMetadataId: string | null;
  settings: { relationType?: RelationType | string } | null;
};

export type InconnectRecordAccessPersistedCandidate = {
  configuration: InconnectRecordAccessPersistedConfigurationCandidate;
  managedObjects: readonly InconnectRecordAccessPersistedManagedObjectCandidate[];
  policies: readonly InconnectRecordAccessPersistedPolicyCandidate[];
  roles: readonly InconnectRecordAccessValidationRole[];
  objects: readonly InconnectRecordAccessValidationObject[];
  fields: readonly InconnectRecordAccessValidationField[];
};

export type InconnectRecordAccessPersistedValidationErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_MANAGED_OBJECT'
  | 'INVALID_POLICY'
  | 'DUPLICATE_MANAGED_OBJECT'
  | 'DUPLICATE_POLICY'
  | 'WORKSPACE_MISMATCH'
  | 'MISSING_REFERENCE'
  | 'INACTIVE_REFERENCE'
  | 'INVALID_OWNER_FIELD';

export type InconnectRecordAccessPersistedValidationError = {
  code: InconnectRecordAccessPersistedValidationErrorCode;
  path: string;
  message: string;
};

export type InconnectRecordAccessPersistedValidationResult =
  | { valid: true; errors: [] }
  | {
      valid: false;
      errors: InconnectRecordAccessPersistedValidationError[];
    };
