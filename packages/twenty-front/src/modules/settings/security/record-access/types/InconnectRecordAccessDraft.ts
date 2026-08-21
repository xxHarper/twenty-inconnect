import {
  type GetInconnectRecordAccessConfigurationQuery,
  InconnectRecordAccessCreatePolicy,
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  InconnectRecordAccessOwnerTransferPolicy,
  InconnectRecordAccessPrincipalType,
  InconnectRecordAccessRecordEffect,
} from '~/generated-metadata/graphql';

export type InconnectRecordAccessPolicyDraft = {
  draftId: string;
  roleId: string;
  principalType: InconnectRecordAccessPrincipalType;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  defaultOwnerRoleId: string | null;
};

export type InconnectRecordAccessManagedObjectDraft = {
  draftId: string;
  objectMetadataId: string;
  ownerFieldMetadataId: string;
  ownerRequirement: InconnectRecordAccessOwnerRequirement;
  policies: InconnectRecordAccessPolicyDraft[];
};

export type InconnectRecordAccessConfigurationDraft = {
  enforcementMode: InconnectRecordAccessEnforcementMode;
  managedObjects: InconnectRecordAccessManagedObjectDraft[];
};

export type InconnectRecordAccessPersistedConfiguration =
  GetInconnectRecordAccessConfigurationQuery['getInconnectRecordAccessConfiguration'];

export const createEmptyInconnectRecordAccessDraft =
  (): InconnectRecordAccessConfigurationDraft => ({
    enforcementMode: InconnectRecordAccessEnforcementMode.MANAGED,
    managedObjects: [],
  });

export const createDefaultInconnectRecordAccessPolicyDraft = ({
  objectMetadataId,
  roleId,
}: {
  objectMetadataId: string;
  roleId: string;
}): InconnectRecordAccessPolicyDraft => ({
  draftId: `policy-${objectMetadataId}-${roleId}`,
  roleId,
  principalType: InconnectRecordAccessPrincipalType.WORKSPACE_MEMBER,
  recordEffect: InconnectRecordAccessRecordEffect.ownRecords,
  createPolicy: InconnectRecordAccessCreatePolicy.denied,
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy.denied,
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
  defaultOwnerRoleId: null,
});
