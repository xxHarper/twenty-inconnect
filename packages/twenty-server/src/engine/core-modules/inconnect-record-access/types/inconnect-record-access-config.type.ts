export type InconnectRecordAccessRecordEffect =
  | 'ownRecords'
  | 'ownAndTeamRecords'
  | 'allRecords';

export type InconnectRecordAccessCreatePolicy =
  | 'denied'
  | 'defaultOwner'
  | 'assignableOwners'
  | 'standardPermissionsOnly';

export type InconnectRecordAccessOwnerTransferPolicy =
  | 'denied'
  | 'assignableOwners'
  | 'standardPermissionsOnly';

type InconnectRecordAccessRuleRecordEffect =
  | {
      recordEffect: InconnectRecordAccessRecordEffect;
      effect?:
        | 'ownerEqualsAuthenticatedWorkspaceMember'
        | InconnectRecordAccessRecordEffect;
    }
  | {
      recordEffect?: InconnectRecordAccessRecordEffect;
      effect:
        | 'ownerEqualsAuthenticatedWorkspaceMember'
        | InconnectRecordAccessRecordEffect;
    };

export type InconnectRecordAccessRuleConfig =
  InconnectRecordAccessRuleRecordEffect & {
    roleUniversalIdentifier: string;
    objectUniversalIdentifier: string;
    ownerFieldUniversalIdentifier: string;
    principal: 'workspaceMember';
    createPolicy?: InconnectRecordAccessCreatePolicy;
    ownerTransferPolicy?: InconnectRecordAccessOwnerTransferPolicy;
  };

export type InconnectRecordAccessWorkspaceConfig = {
  workspaceId: string;
  rules: InconnectRecordAccessRuleConfig[];
};

export type InconnectRecordAccessConfig = {
  workspaces: InconnectRecordAccessWorkspaceConfig[];
};
