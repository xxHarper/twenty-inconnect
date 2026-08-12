export type InconnectRecordAccessRuleConfig = {
  roleUniversalIdentifier: string;
  objectUniversalIdentifier: string;
  ownerFieldUniversalIdentifier: string;
  principal: 'workspaceMember';
  effect: 'ownerEqualsAuthenticatedWorkspaceMember';
};

export type InconnectRecordAccessWorkspaceConfig = {
  workspaceId: string;
  rules: InconnectRecordAccessRuleConfig[];
};

export type InconnectRecordAccessConfig = {
  workspaces: InconnectRecordAccessWorkspaceConfig[];
};
