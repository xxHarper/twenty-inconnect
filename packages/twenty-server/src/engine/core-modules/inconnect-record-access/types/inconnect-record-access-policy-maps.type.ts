import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';

export type InconnectRecordAccessPolicyMapRule = {
  id: string;
  roleId: string;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId?: string;
};

export type InconnectRecordAccessPolicyMapManagedObject = {
  id: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerFieldName: string;
  ownerJoinColumnName: string;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
  policies: InconnectRecordAccessPolicyMapRule[];
};

export type InconnectRecordAccessPolicyMapsFailureKind =
  | 'invalid'
  | 'corrupt'
  | 'recomputation-failed';

export type InconnectRecordAccessPolicyMaps =
  | { version: 1; status: 'absent' }
  | {
      version: 1;
      status: 'valid';
      enforcementMode: 'UNMANAGED';
      revision: string;
    }
  | {
      version: 1;
      status: 'valid';
      enforcementMode: 'MANAGED';
      revision: string;
      managedObjects: InconnectRecordAccessPolicyMapManagedObject[];
    }
  | {
      version: 1;
      status: 'invalid';
      reason: string;
      failureKind: InconnectRecordAccessPolicyMapsFailureKind;
    };
