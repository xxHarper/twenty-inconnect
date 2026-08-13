export type ResolvedInconnectRecordAccessRule = {
  roleId: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerFieldName: string;
  ownerJoinColumnName: string;
  effect: 'ownRecords' | 'ownAndTeamRecords' | 'allRecords';
};

export type InconnectRecordAccessWorkspacePolicy =
  | { status: 'not-configured' }
  | { status: 'invalid'; reason: string }
  | {
      status: 'configured';
      rules: ResolvedInconnectRecordAccessRule[];
    };

export type InconnectRecordAccessDecision =
  | { kind: 'not-managed' }
  | { kind: 'system-bypass' }
  | { kind: 'all-records' }
  | { kind: 'denied'; reason?: string }
  | {
      kind: 'owner-workspace-member-ids';
      ownerFieldMetadataId: string;
      ownerFieldName: string;
      ownerJoinColumnName: string;
      authenticatedWorkspaceMemberId: string;
      recordScopeOwnerWorkspaceMemberIds: readonly string[];
      assignableOwnerWorkspaceMemberIds: readonly string[];
      sourceEffect: 'ownRecords' | 'ownAndTeamRecords';
    };

export const hasNoInconnectRecordAccessScope = (
  decision: InconnectRecordAccessDecision,
): decision is Extract<
  InconnectRecordAccessDecision,
  { kind: 'not-managed' | 'system-bypass' | 'all-records' }
> =>
  decision.kind === 'not-managed' ||
  decision.kind === 'system-bypass' ||
  decision.kind === 'all-records';
