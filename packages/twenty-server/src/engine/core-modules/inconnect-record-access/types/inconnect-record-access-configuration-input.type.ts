import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { type InconnectRecordAccessEnforcementMode } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';

export type InconnectRecordAccessManagedObjectInput = {
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
};

export type InconnectRecordAccessPolicyInput = {
  objectMetadataId: string;
  roleId: string;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId?: string;
};

export type InconnectRecordAccessConfigurationSetInput = {
  enforcementMode: InconnectRecordAccessEnforcementMode;
  managedObjects: readonly InconnectRecordAccessManagedObjectInput[];
  policies: readonly InconnectRecordAccessPolicyInput[];
};

export type ReplaceInconnectRecordAccessConfigurationArgs =
  InconnectRecordAccessConfigurationSetInput & {
    workspaceId: string;
    expectedRevision: string | null;
  };

export type ReplaceInconnectRecordAccessConfigurationResult = {
  revision: string;
  cacheStatus: 'recomputed' | 'recomputation-failed';
  changedFromManagedToUnmanaged: boolean;
};
