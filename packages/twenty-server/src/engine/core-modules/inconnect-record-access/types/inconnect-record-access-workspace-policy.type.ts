import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';

export type ResolvedInconnectRecordAccessRule = {
  roleId: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerFieldName: string;
  ownerJoinColumnName: string;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId?: string;
};

export type InconnectRecordAccessWorkspacePolicy =
  | { status: 'not-configured' }
  | { status: 'invalid'; reason: string }
  | {
      status: 'configured';
      rules: ResolvedInconnectRecordAccessRule[];
    };

type InconnectManagedRecordAccessDecision = {
  ownerFieldMetadataId: string;
  ownerFieldName: string;
  ownerJoinColumnName: string;
  authenticatedWorkspaceMemberId: string;
  assignableOwnerWorkspaceMemberIds: readonly string[];
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId?: string;
};

export type InconnectRecordAccessDecision =
  | { kind: 'not-managed' }
  | { kind: 'system-bypass' }
  | { kind: 'denied'; reason?: string }
  | (InconnectManagedRecordAccessDecision & {
      kind: 'all-records';
      sourceRecordEffect: 'allRecords';
    })
  | (InconnectManagedRecordAccessDecision & {
      kind: 'owner-workspace-member-ids';
      recordScopeOwnerWorkspaceMemberIds: readonly string[];
      sourceRecordEffect: 'ownRecords' | 'ownAndTeamRecords';
    });

export const hasNoInconnectRecordAccessScope = (
  decision: InconnectRecordAccessDecision,
): decision is Extract<
  InconnectRecordAccessDecision,
  { kind: 'not-managed' | 'system-bypass' | 'all-records' }
> =>
  decision.kind === 'not-managed' ||
  decision.kind === 'system-bypass' ||
  decision.kind === 'all-records';
