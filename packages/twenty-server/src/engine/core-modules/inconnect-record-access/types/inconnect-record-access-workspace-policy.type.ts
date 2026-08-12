export type ResolvedInconnectRecordAccessRule = {
  roleId: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerJoinColumnName: string;
};

export type InconnectRecordAccessWorkspacePolicy =
  | { status: 'not-configured' }
  | { status: 'invalid'; reason: string }
  | {
      status: 'configured';
      rules: ResolvedInconnectRecordAccessRule[];
    };

export type InconnectRecordAccessDecision =
  | { kind: 'unrestricted' }
  | { kind: 'denied' }
  | {
      kind: 'scoped';
      ownerFieldMetadataId: string;
      ownerJoinColumnName: string;
      workspaceMemberId: string;
    };
