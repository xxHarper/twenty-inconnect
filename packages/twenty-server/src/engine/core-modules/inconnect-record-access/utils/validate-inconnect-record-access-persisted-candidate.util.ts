import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import {
  INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES,
  INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES,
  type InconnectRecordAccessPersistedCandidate,
  type InconnectRecordAccessPersistedValidationError,
  type InconnectRecordAccessPersistedValidationErrorCode,
  type InconnectRecordAccessPersistedValidationResult,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';

const RECORD_EFFECTS = [
  'ownRecords',
  'ownAndTeamRecords',
  'allRecords',
] as const;
const CREATE_POLICIES = [
  'denied',
  'defaultOwner',
  'assignableOwners',
  'standardPermissionsOnly',
] as const;
const OWNER_TRANSFER_POLICIES = [
  'denied',
  'assignableOwners',
  'standardPermissionsOnly',
] as const;
const OWNER_REQUIREMENTS = ['required', 'optional'] as const;
const MISSING_OWNER_POLICIES = [
  'self',
  'requireExplicit',
  'singleActiveMemberOfRole',
  'standard',
] as const;

const isOneOf = <TValue extends string>(
  value: string,
  allowedValues: readonly TValue[],
): value is TValue => allowedValues.includes(value as TValue);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isValidRevision = (revision: string | number | bigint): boolean => {
  if (typeof revision === 'bigint') {
    return revision >= 0;
  }

  if (typeof revision === 'number') {
    return Number.isSafeInteger(revision) && revision >= 0;
  }

  return /^(0|[1-9][0-9]*)$/.test(revision);
};

const addError = (
  errors: InconnectRecordAccessPersistedValidationError[],
  code: InconnectRecordAccessPersistedValidationErrorCode,
  path: string,
  message: string,
): void => {
  errors.push({ code, path, message });
};

const validatePolicyCombination = ({
  createPolicy,
  missingOwnerPolicy,
  defaultOwnerRoleId,
  ownerRequirement,
}: {
  createPolicy: string;
  missingOwnerPolicy: string;
  defaultOwnerRoleId: string | null;
  ownerRequirement: string | undefined;
}): boolean => {
  if (
    (missingOwnerPolicy === 'singleActiveMemberOfRole') !==
    isNonEmptyString(defaultOwnerRoleId)
  ) {
    return false;
  }

  if (ownerRequirement === 'optional') {
    return missingOwnerPolicy === 'standard' && defaultOwnerRoleId === null;
  }

  if (ownerRequirement !== 'required' || missingOwnerPolicy === 'standard') {
    return false;
  }

  if (createPolicy === 'denied') {
    return missingOwnerPolicy === 'requireExplicit';
  }

  if (createPolicy === 'defaultOwner' || createPolicy === 'assignableOwners') {
    return missingOwnerPolicy === 'self';
  }

  return true;
};

export const validateInconnectRecordAccessPersistedCandidate = (
  candidate: InconnectRecordAccessPersistedCandidate,
): InconnectRecordAccessPersistedValidationResult => {
  const errors: InconnectRecordAccessPersistedValidationError[] = [];
  const { configuration, managedObjects, policies, roles, objects, fields } =
    candidate;
  const workspaceId = configuration.workspaceId;

  if (
    !isNonEmptyString(workspaceId) ||
    !isOneOf(
      configuration.enforcementMode,
      INCONNECT_RECORD_ACCESS_ENFORCEMENT_MODES,
    ) ||
    !isValidRevision(configuration.revision)
  ) {
    addError(
      errors,
      'INVALID_CONFIGURATION',
      'configuration',
      'Configuration workspace, enforcement mode, or revision is invalid',
    );
  }

  if (
    configuration.enforcementMode === 'MANAGED' &&
    managedObjects.length === 0
  ) {
    addError(
      errors,
      'INVALID_CONFIGURATION',
      'configuration.enforcementMode',
      'A MANAGED configuration must contain at least one managed object',
    );
  }

  if (
    configuration.enforcementMode === 'UNMANAGED' &&
    (managedObjects.length > 0 || policies.length > 0)
  ) {
    addError(
      errors,
      'INVALID_CONFIGURATION',
      'configuration.enforcementMode',
      'An UNMANAGED configuration cannot contain managed objects or policies',
    );
  }

  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const managedObjectsById = new Map(
    managedObjects.map((managedObject) => [managedObject.id, managedObject]),
  );
  const managedObjectIds = new Set<string>();
  const managedObjectKeys = new Set<string>();

  managedObjects.forEach((managedObject, index) => {
    const path = `managedObjects[${index}]`;
    const managedObjectKey = `${managedObject.workspaceId}:${managedObject.objectMetadataId}`;

    if (
      !isNonEmptyString(managedObject.id) ||
      !isNonEmptyString(managedObject.objectMetadataId) ||
      !isNonEmptyString(managedObject.ownerFieldMetadataId) ||
      !isOneOf(managedObject.ownerRequirement, OWNER_REQUIREMENTS)
    ) {
      addError(
        errors,
        'INVALID_MANAGED_OBJECT',
        path,
        'Managed object has an invalid shape',
      );
    }

    if (managedObject.workspaceId !== workspaceId) {
      addError(
        errors,
        'WORKSPACE_MISMATCH',
        `${path}.workspaceId`,
        'Managed object belongs to another workspace',
      );
    }

    if (
      managedObjectIds.has(managedObject.id) ||
      managedObjectKeys.has(managedObjectKey)
    ) {
      addError(
        errors,
        'DUPLICATE_MANAGED_OBJECT',
        path,
        'Managed object is duplicated',
      );
    }
    managedObjectIds.add(managedObject.id);
    managedObjectKeys.add(managedObjectKey);

    const objectMetadata = objectsById.get(managedObject.objectMetadataId);

    if (!objectMetadata) {
      addError(
        errors,
        'MISSING_REFERENCE',
        `${path}.objectMetadataId`,
        'Configured ObjectMetadata does not exist',
      );
    } else {
      if (objectMetadata.workspaceId !== workspaceId) {
        addError(
          errors,
          'WORKSPACE_MISMATCH',
          `${path}.objectMetadataId`,
          'Configured ObjectMetadata belongs to another workspace',
        );
      }
      if (!objectMetadata.isActive) {
        addError(
          errors,
          'INACTIVE_REFERENCE',
          `${path}.objectMetadataId`,
          'Configured ObjectMetadata is inactive',
        );
      }
    }

    const ownerField = fieldsById.get(managedObject.ownerFieldMetadataId);

    if (!ownerField) {
      addError(
        errors,
        'MISSING_REFERENCE',
        `${path}.ownerFieldMetadataId`,
        'Configured owner FieldMetadata does not exist',
      );
      return;
    }

    if (ownerField.workspaceId !== workspaceId) {
      addError(
        errors,
        'WORKSPACE_MISMATCH',
        `${path}.ownerFieldMetadataId`,
        'Configured owner FieldMetadata belongs to another workspace',
      );
    }
    if (!ownerField.isActive) {
      addError(
        errors,
        'INACTIVE_REFERENCE',
        `${path}.ownerFieldMetadataId`,
        'Configured owner FieldMetadata is inactive',
      );
    }

    const targetObject = ownerField.relationTargetObjectMetadataId
      ? objectsById.get(ownerField.relationTargetObjectMetadataId)
      : undefined;
    let isJoinColumnDerivable = false;

    if (isNonEmptyString(ownerField.name)) {
      try {
        isJoinColumnDerivable = isNonEmptyString(
          computeMorphOrRelationFieldJoinColumnName({
            name: ownerField.name,
          }),
        );
      } catch {
        isJoinColumnDerivable = false;
      }
    }

    if (
      ownerField.objectMetadataId !== managedObject.objectMetadataId ||
      ownerField.type !== FieldMetadataType.RELATION ||
      ownerField.settings?.relationType !== RelationType.MANY_TO_ONE ||
      !targetObject ||
      targetObject.workspaceId !== workspaceId ||
      !targetObject.isActive ||
      targetObject.universalIdentifier !==
        STANDARD_OBJECTS.workspaceMember.universalIdentifier ||
      !isJoinColumnDerivable
    ) {
      addError(
        errors,
        'INVALID_OWNER_FIELD',
        `${path}.ownerFieldMetadataId`,
        'Owner field must be an active MANY_TO_ONE relation to workspaceMember on the configured object',
      );
    }
  });

  const policyIds = new Set<string>();
  const policyKeys = new Set<string>();

  policies.forEach((policy, index) => {
    const path = `policies[${index}]`;
    const managedObject = managedObjectsById.get(policy.managedObjectId);
    const policyKey = `${policy.workspaceId}:${policy.managedObjectId}:${policy.roleId}`;
    const hasValidEnums =
      isOneOf(policy.principalType, INCONNECT_RECORD_ACCESS_PRINCIPAL_TYPES) &&
      isOneOf(policy.recordEffect, RECORD_EFFECTS) &&
      isOneOf(policy.createPolicy, CREATE_POLICIES) &&
      isOneOf(policy.ownerTransferPolicy, OWNER_TRANSFER_POLICIES) &&
      isOneOf(policy.missingOwnerPolicy, MISSING_OWNER_POLICIES);

    if (
      !isNonEmptyString(policy.id) ||
      !isNonEmptyString(policy.managedObjectId) ||
      !isNonEmptyString(policy.roleId) ||
      !hasValidEnums
    ) {
      addError(
        errors,
        'INVALID_POLICY',
        path,
        'Policy has an invalid shape or enum value',
      );
    }

    if (policy.workspaceId !== workspaceId) {
      addError(
        errors,
        'WORKSPACE_MISMATCH',
        `${path}.workspaceId`,
        'Policy belongs to another workspace',
      );
    }

    if (policyIds.has(policy.id) || policyKeys.has(policyKey)) {
      addError(
        errors,
        'DUPLICATE_POLICY',
        path,
        'Policy is duplicated for this Role and managed object',
      );
    }
    policyIds.add(policy.id);
    policyKeys.add(policyKey);

    if (!managedObject) {
      addError(
        errors,
        'MISSING_REFERENCE',
        `${path}.managedObjectId`,
        'Policy references a missing managed object',
      );
    } else if (managedObject.workspaceId !== policy.workspaceId) {
      addError(
        errors,
        'WORKSPACE_MISMATCH',
        `${path}.managedObjectId`,
        'Policy and managed object belong to different workspaces',
      );
    }

    const role = rolesById.get(policy.roleId);

    if (!role) {
      addError(
        errors,
        'MISSING_REFERENCE',
        `${path}.roleId`,
        'Configured Role does not exist',
      );
    } else if (role.workspaceId !== workspaceId) {
      addError(
        errors,
        'WORKSPACE_MISMATCH',
        `${path}.roleId`,
        'Configured Role belongs to another workspace',
      );
    }

    if (policy.defaultOwnerRoleId) {
      const defaultOwnerRole = rolesById.get(policy.defaultOwnerRoleId);

      if (!defaultOwnerRole) {
        addError(
          errors,
          'MISSING_REFERENCE',
          `${path}.defaultOwnerRoleId`,
          'Configured default owner Role does not exist',
        );
      } else if (defaultOwnerRole.workspaceId !== workspaceId) {
        addError(
          errors,
          'WORKSPACE_MISMATCH',
          `${path}.defaultOwnerRoleId`,
          'Configured default owner Role belongs to another workspace',
        );
      }
    }

    if (
      !hasValidEnums ||
      !validatePolicyCombination({
        createPolicy: policy.createPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId,
        ownerRequirement: managedObject?.ownerRequirement,
      })
    ) {
      addError(
        errors,
        'INVALID_POLICY',
        path,
        'Policy operation and owner-integrity combination is invalid',
      );
    }
  });

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
};
