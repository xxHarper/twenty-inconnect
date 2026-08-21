import { type InconnectRecordAccessConfigurationSetInput } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';

export type InconnectRecordAccessEnvironmentImportManagedObjectSummary = {
  objectLabel: string;
  objectMetadataId: string;
  ownerFieldLabel: string;
  ownerFieldMetadataId: string;
  ownerRequirement: string;
};

export type InconnectRecordAccessEnvironmentImportPolicySummary = {
  objectLabel: string;
  roleLabel: string;
  roleId: string;
  recordEffect: string;
  createPolicy: string;
  ownerTransferPolicy: string;
  missingOwnerPolicy: string;
  defaultOwnerRoleLabel?: string;
  defaultOwnerRoleId?: string;
};

export type InconnectRecordAccessEnvironmentImportPlan = {
  workspaceId: string;
  workspaceDisplayName: string | null;
  enforcementMode: 'MANAGED';
  currentRevision: string | null;
  publishRevision: string;
  managedObjectCount: number;
  policyCount: number;
  validationStatus: 'valid';
  managedObjects: InconnectRecordAccessEnvironmentImportManagedObjectSummary[];
  policies: InconnectRecordAccessEnvironmentImportPolicySummary[];
  input: InconnectRecordAccessConfigurationSetInput;
};

export type InconnectRecordAccessEnvironmentImportResult = {
  plan: InconnectRecordAccessEnvironmentImportPlan;
  published:
    | false
    | {
        revision: string;
        cacheStatus: 'recomputed' | 'recomputation-failed';
      };
};
