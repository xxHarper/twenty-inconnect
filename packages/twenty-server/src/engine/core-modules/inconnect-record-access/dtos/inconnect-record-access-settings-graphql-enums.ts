import { registerEnumType } from '@nestjs/graphql';

export const InconnectRecordAccessConfigurationStatusGraphql = {
  ABSENT: 'ABSENT',
  MANAGED: 'MANAGED',
  UNMANAGED: 'UNMANAGED',
} as const;

export const InconnectRecordAccessEnforcementModeGraphql = {
  MANAGED: 'MANAGED',
  UNMANAGED: 'UNMANAGED',
} as const;

export const InconnectRecordAccessPrincipalTypeGraphql = {
  WORKSPACE_MEMBER: 'WORKSPACE_MEMBER',
} as const;

export const InconnectRecordAccessRecordEffectGraphql = {
  ownRecords: 'ownRecords',
  ownAndTeamRecords: 'ownAndTeamRecords',
  allRecords: 'allRecords',
} as const;

export const InconnectRecordAccessCreatePolicyGraphql = {
  denied: 'denied',
  defaultOwner: 'defaultOwner',
  assignableOwners: 'assignableOwners',
  standardPermissionsOnly: 'standardPermissionsOnly',
} as const;

export const InconnectRecordAccessOwnerTransferPolicyGraphql = {
  denied: 'denied',
  assignableOwners: 'assignableOwners',
  standardPermissionsOnly: 'standardPermissionsOnly',
} as const;

export const InconnectRecordAccessOwnerRequirementGraphql = {
  required: 'required',
  optional: 'optional',
} as const;

export const InconnectRecordAccessMissingOwnerPolicyGraphql = {
  self: 'self',
  requireExplicit: 'requireExplicit',
  singleActiveMemberOfRole: 'singleActiveMemberOfRole',
  standard: 'standard',
} as const;

export const InconnectRecordAccessCacheStatusGraphql = {
  recomputed: 'recomputed',
  recomputationFailed: 'recomputation-failed',
} as const;

registerEnumType(InconnectRecordAccessConfigurationStatusGraphql, {
  name: 'InconnectRecordAccessConfigurationStatus',
});
registerEnumType(InconnectRecordAccessEnforcementModeGraphql, {
  name: 'InconnectRecordAccessEnforcementMode',
});
registerEnumType(InconnectRecordAccessPrincipalTypeGraphql, {
  name: 'InconnectRecordAccessPrincipalType',
});
registerEnumType(InconnectRecordAccessRecordEffectGraphql, {
  name: 'InconnectRecordAccessRecordEffect',
});
registerEnumType(InconnectRecordAccessCreatePolicyGraphql, {
  name: 'InconnectRecordAccessCreatePolicy',
});
registerEnumType(InconnectRecordAccessOwnerTransferPolicyGraphql, {
  name: 'InconnectRecordAccessOwnerTransferPolicy',
});
registerEnumType(InconnectRecordAccessOwnerRequirementGraphql, {
  name: 'InconnectRecordAccessOwnerRequirement',
});
registerEnumType(InconnectRecordAccessMissingOwnerPolicyGraphql, {
  name: 'InconnectRecordAccessMissingOwnerPolicy',
});
registerEnumType(InconnectRecordAccessCacheStatusGraphql, {
  name: 'InconnectRecordAccessCacheStatus',
});
