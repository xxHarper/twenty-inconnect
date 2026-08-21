import {
  type InconnectRecordAccessConfigurationDraft,
  type InconnectRecordAccessManagedObjectDraft,
  type InconnectRecordAccessPersistedConfiguration,
  type InconnectRecordAccessPolicyDraft,
} from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import {
  InconnectRecordAccessConfigurationStatus,
  InconnectRecordAccessCreatePolicy,
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessSettingsAvailableMetadata,
  type ReplaceInconnectRecordAccessConfigurationInput,
} from '~/generated-metadata/graphql';

export const configurationToInconnectRecordAccessDraft = (
  configuration: InconnectRecordAccessPersistedConfiguration,
): InconnectRecordAccessConfigurationDraft | null => {
  if (
    configuration.status === InconnectRecordAccessConfigurationStatus.ABSENT
  ) {
    return null;
  }

  return {
    enforcementMode:
      configuration.enforcementMode ??
      InconnectRecordAccessEnforcementMode.MANAGED,
    managedObjects: configuration.managedObjects.map((managedObject) => ({
      draftId: managedObject.id,
      objectMetadataId: managedObject.objectMetadataId,
      ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
      ownerRequirement: managedObject.ownerRequirement,
      policies: managedObject.policies.map((policy) => ({
        draftId: policy.id,
        roleId: policy.roleId,
        principalType: policy.principalType,
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId ?? null,
      })),
    })),
  };
};

const isPolicyDraftValid = (policy: InconnectRecordAccessPolicyDraft) => {
  const hasDefaultRole = policy.defaultOwnerRoleId !== null;
  const needsDefaultRole =
    policy.missingOwnerPolicy ===
    InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole;

  if (hasDefaultRole !== needsDefaultRole) {
    return false;
  }

  if (
    policy.createPolicy === InconnectRecordAccessCreatePolicy.denied &&
    policy.missingOwnerPolicy !==
      InconnectRecordAccessMissingOwnerPolicy.requireExplicit
  ) {
    return false;
  }

  if (
    (policy.createPolicy === InconnectRecordAccessCreatePolicy.defaultOwner ||
      policy.createPolicy ===
        InconnectRecordAccessCreatePolicy.assignableOwners) &&
    policy.missingOwnerPolicy !== InconnectRecordAccessMissingOwnerPolicy.self
  ) {
    return false;
  }

  return policy.roleId.length > 0;
};

const isManagedObjectDraftValid = (
  managedObject: InconnectRecordAccessManagedObjectDraft,
) => {
  const roleIds = managedObject.policies.map((policy) => policy.roleId);

  return (
    managedObject.objectMetadataId.length > 0 &&
    managedObject.ownerFieldMetadataId.length > 0 &&
    new Set(roleIds).size === roleIds.length &&
    managedObject.policies.every(isPolicyDraftValid)
  );
};

export const isInconnectRecordAccessDraftValid = (
  draft: InconnectRecordAccessConfigurationDraft,
) => {
  if (
    draft.enforcementMode === InconnectRecordAccessEnforcementMode.UNMANAGED
  ) {
    return true;
  }

  const objectIds = draft.managedObjects.map(
    (managedObject) => managedObject.objectMetadataId,
  );

  return (
    draft.managedObjects.length > 0 &&
    new Set(objectIds).size === objectIds.length &&
    draft.managedObjects.every(isManagedObjectDraftValid)
  );
};

export const inconnectRecordAccessDraftToInput = ({
  draft,
  expectedRevision,
}: {
  draft: InconnectRecordAccessConfigurationDraft;
  expectedRevision: string | null;
}): ReplaceInconnectRecordAccessConfigurationInput => {
  const managedObjects =
    draft.enforcementMode === InconnectRecordAccessEnforcementMode.MANAGED
      ? draft.managedObjects
      : [];

  return {
    expectedRevision,
    enforcementMode: draft.enforcementMode,
    managedObjects: managedObjects.map((managedObject) => ({
      objectMetadataId: managedObject.objectMetadataId,
      ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
      ownerRequirement: managedObject.ownerRequirement,
    })),
    policies: managedObjects.flatMap((managedObject) =>
      managedObject.policies.map((policy) => ({
        objectMetadataId: managedObject.objectMetadataId,
        roleId: policy.roleId,
        principalType: policy.principalType,
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId,
      })),
    ),
  };
};

export const getInconnectRecordAccessDraftSignature = (
  draft: InconnectRecordAccessConfigurationDraft | null,
) => {
  if (draft === null) {
    return 'ABSENT';
  }

  return JSON.stringify(
    inconnectRecordAccessDraftToInput({
      draft,
      expectedRevision: null,
    }),
  );
};

export const normalizePolicyAfterCreatePolicyChange = ({
  policy,
  createPolicy,
}: {
  policy: InconnectRecordAccessPolicyDraft;
  createPolicy: InconnectRecordAccessCreatePolicy;
}): InconnectRecordAccessPolicyDraft => {
  if (createPolicy === InconnectRecordAccessCreatePolicy.denied) {
    return {
      ...policy,
      createPolicy,
      missingOwnerPolicy:
        InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
      defaultOwnerRoleId: null,
    };
  }

  if (
    createPolicy === InconnectRecordAccessCreatePolicy.defaultOwner ||
    createPolicy === InconnectRecordAccessCreatePolicy.assignableOwners
  ) {
    return {
      ...policy,
      createPolicy,
      missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.self,
      defaultOwnerRoleId: null,
    };
  }

  return {
    ...policy,
    createPolicy,
  };
};

export const normalizePolicyAfterMissingOwnerPolicyChange = ({
  policy,
  missingOwnerPolicy,
}: {
  policy: InconnectRecordAccessPolicyDraft;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
}): InconnectRecordAccessPolicyDraft => ({
  ...policy,
  missingOwnerPolicy,
  defaultOwnerRoleId:
    missingOwnerPolicy ===
    InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole
      ? policy.defaultOwnerRoleId
      : null,
});

export const isInconnectRecordAccessDraftCompatibleWithMetadata = ({
  draft,
  metadata,
}: {
  draft: InconnectRecordAccessConfigurationDraft;
  metadata: InconnectRecordAccessSettingsAvailableMetadata;
}) => {
  if (
    draft.enforcementMode === InconnectRecordAccessEnforcementMode.UNMANAGED
  ) {
    return true;
  }

  const roleIds = new Set(metadata.roles.map((role) => role.roleId));

  return draft.managedObjects.every((managedObject) => {
    const objectMetadata = metadata.objects.find(
      (candidate) =>
        candidate.objectMetadataId === managedObject.objectMetadataId,
    );

    return (
      objectMetadata?.ownerFields.some(
        (field) => field.fieldMetadataId === managedObject.ownerFieldMetadataId,
      ) === true &&
      managedObject.policies.every(
        (policy) =>
          roleIds.has(policy.roleId) &&
          (policy.defaultOwnerRoleId === null ||
            roleIds.has(policy.defaultOwnerRoleId)),
      )
    );
  });
};
