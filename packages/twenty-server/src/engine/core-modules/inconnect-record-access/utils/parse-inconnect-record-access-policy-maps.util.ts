import { isValidUuid } from 'twenty-shared/utils';

import {
  type InconnectRecordAccessPolicyMapManagedObject,
  type InconnectRecordAccessPolicyMapRule,
  type InconnectRecordAccessPolicyMaps,
  type InconnectRecordAccessPolicyMapsFailureKind,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';

const RECORD_EFFECTS = new Set([
  'ownRecords',
  'ownAndTeamRecords',
  'allRecords',
]);
const CREATE_POLICIES = new Set([
  'denied',
  'defaultOwner',
  'assignableOwners',
  'standardPermissionsOnly',
]);
const OWNER_TRANSFER_POLICIES = new Set([
  'denied',
  'assignableOwners',
  'standardPermissionsOnly',
]);
const OWNER_REQUIREMENTS = new Set(['required', 'optional']);
const MISSING_OWNER_POLICIES = new Set([
  'self',
  'requireExplicit',
  'singleActiveMemberOfRole',
  'standard',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => {
  const allowedKeySet = new Set(allowedKeys);

  return Object.keys(value).every((key) => allowedKeySet.has(key));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const POSTGRES_BIGINT_MAX = '9223372036854775807';

const isRevision = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  (value.length < POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value <= POSTGRES_BIGINT_MAX));

const isFailureKind = (
  value: unknown,
): value is InconnectRecordAccessPolicyMapsFailureKind =>
  value === 'invalid' ||
  value === 'corrupt' ||
  value === 'recomputation-failed';

const isPolicyCombinationValid = ({
  rule,
  ownerRequirement,
}: {
  rule: InconnectRecordAccessPolicyMapRule;
  ownerRequirement: string;
}): boolean => {
  const hasDefaultOwnerRole = rule.defaultOwnerRoleId !== undefined;

  if (
    (rule.missingOwnerPolicy === 'singleActiveMemberOfRole') !==
    hasDefaultOwnerRole
  ) {
    return false;
  }

  if (ownerRequirement === 'optional') {
    return rule.missingOwnerPolicy === 'standard' && !hasDefaultOwnerRole;
  }

  if (
    ownerRequirement !== 'required' ||
    rule.missingOwnerPolicy === 'standard'
  ) {
    return false;
  }

  if (rule.createPolicy === 'denied') {
    return rule.missingOwnerPolicy === 'requireExplicit';
  }

  if (
    rule.createPolicy === 'defaultOwner' ||
    rule.createPolicy === 'assignableOwners'
  ) {
    return rule.missingOwnerPolicy === 'self';
  }

  return true;
};

const parseRule = (
  value: unknown,
  ownerRequirement: string,
): InconnectRecordAccessPolicyMapRule | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'roleId',
      'recordEffect',
      'createPolicy',
      'ownerTransferPolicy',
      'missingOwnerPolicy',
      'defaultOwnerRoleId',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isValidUuid(value.id) ||
    !isNonEmptyString(value.roleId) ||
    !isValidUuid(value.roleId) ||
    !isNonEmptyString(value.recordEffect) ||
    !RECORD_EFFECTS.has(value.recordEffect) ||
    !isNonEmptyString(value.createPolicy) ||
    !CREATE_POLICIES.has(value.createPolicy) ||
    !isNonEmptyString(value.ownerTransferPolicy) ||
    !OWNER_TRANSFER_POLICIES.has(value.ownerTransferPolicy) ||
    !isNonEmptyString(value.missingOwnerPolicy) ||
    !MISSING_OWNER_POLICIES.has(value.missingOwnerPolicy) ||
    (value.defaultOwnerRoleId !== undefined &&
      (!isNonEmptyString(value.defaultOwnerRoleId) ||
        !isValidUuid(value.defaultOwnerRoleId)))
  ) {
    return undefined;
  }

  const rule = {
    id: value.id,
    roleId: value.roleId,
    recordEffect: value.recordEffect,
    createPolicy: value.createPolicy,
    ownerTransferPolicy: value.ownerTransferPolicy,
    missingOwnerPolicy: value.missingOwnerPolicy,
    ...(value.defaultOwnerRoleId
      ? { defaultOwnerRoleId: value.defaultOwnerRoleId }
      : {}),
  } as InconnectRecordAccessPolicyMapRule;

  return isPolicyCombinationValid({ rule, ownerRequirement })
    ? rule
    : undefined;
};

const parseManagedObject = (
  value: unknown,
): InconnectRecordAccessPolicyMapManagedObject | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'objectMetadataId',
      'ownerFieldMetadataId',
      'ownerFieldName',
      'ownerJoinColumnName',
      'ownerRequirement',
      'policies',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isValidUuid(value.id) ||
    !isNonEmptyString(value.objectMetadataId) ||
    !isValidUuid(value.objectMetadataId) ||
    !isNonEmptyString(value.ownerFieldMetadataId) ||
    !isValidUuid(value.ownerFieldMetadataId) ||
    !isNonEmptyString(value.ownerFieldName) ||
    !isNonEmptyString(value.ownerJoinColumnName) ||
    !isNonEmptyString(value.ownerRequirement) ||
    !OWNER_REQUIREMENTS.has(value.ownerRequirement) ||
    !Array.isArray(value.policies)
  ) {
    return undefined;
  }

  const policies = value.policies.map((policy) =>
    parseRule(policy, value.ownerRequirement as string),
  );

  if (policies.some((policy) => policy === undefined)) {
    return undefined;
  }

  return {
    id: value.id,
    objectMetadataId: value.objectMetadataId,
    ownerFieldMetadataId: value.ownerFieldMetadataId,
    ownerFieldName: value.ownerFieldName,
    ownerJoinColumnName: value.ownerJoinColumnName,
    ownerRequirement:
      value.ownerRequirement as InconnectRecordAccessPolicyMapManagedObject['ownerRequirement'],
    policies: policies as InconnectRecordAccessPolicyMapRule[],
  };
};

const areManagedObjectsConsistent = (
  managedObjects: InconnectRecordAccessPolicyMapManagedObject[],
): boolean => {
  const managedObjectIds = new Set<string>();
  const objectMetadataIds = new Set<string>();
  const policyIds = new Set<string>();

  for (const managedObject of managedObjects) {
    if (
      managedObjectIds.has(managedObject.id) ||
      objectMetadataIds.has(managedObject.objectMetadataId)
    ) {
      return false;
    }

    managedObjectIds.add(managedObject.id);
    objectMetadataIds.add(managedObject.objectMetadataId);
    const roleIds = new Set<string>();

    for (const policy of managedObject.policies) {
      if (policyIds.has(policy.id) || roleIds.has(policy.roleId)) {
        return false;
      }

      policyIds.add(policy.id);
      roleIds.add(policy.roleId);
    }
  }

  return true;
};

export const invalidInconnectRecordAccessPolicyMaps = (
  reason: string,
  failureKind: InconnectRecordAccessPolicyMapsFailureKind = 'invalid',
): InconnectRecordAccessPolicyMaps => ({
  version: 1,
  status: 'invalid',
  reason,
  failureKind,
});

export const parseInconnectRecordAccessPolicyMaps = (
  value: unknown,
): InconnectRecordAccessPolicyMaps => {
  if (!isRecord(value) || value.version !== 1) {
    return invalidInconnectRecordAccessPolicyMaps(
      'INCONNECT policy cache has an unsupported or missing version',
      'corrupt',
    );
  }

  if (value.status === 'absent') {
    return hasOnlyKeys(value, ['version', 'status'])
      ? { version: 1, status: 'absent' }
      : invalidInconnectRecordAccessPolicyMaps(
          'DATABASE ABSENT policy cache payload is contradictory',
          'corrupt',
        );
  }

  if (
    value.status === 'invalid' &&
    hasOnlyKeys(value, ['version', 'status', 'reason', 'failureKind']) &&
    isNonEmptyString(value.reason) &&
    isFailureKind(value.failureKind)
  ) {
    return {
      version: 1,
      status: 'invalid',
      reason: value.reason,
      failureKind: value.failureKind,
    };
  }

  if (
    value.status !== 'valid' ||
    !isRevision(value.revision) ||
    (value.enforcementMode !== 'MANAGED' &&
      value.enforcementMode !== 'UNMANAGED')
  ) {
    return invalidInconnectRecordAccessPolicyMaps(
      'INCONNECT policy cache payload is malformed',
      'corrupt',
    );
  }

  if (value.enforcementMode === 'UNMANAGED') {
    if (
      !hasOnlyKeys(value, ['version', 'status', 'enforcementMode', 'revision'])
    ) {
      return invalidInconnectRecordAccessPolicyMaps(
        'UNMANAGED policy cache cannot contain managed objects',
        'corrupt',
      );
    }

    return {
      version: 1,
      status: 'valid',
      enforcementMode: 'UNMANAGED',
      revision: value.revision,
    };
  }

  if (
    !hasOnlyKeys(value, [
      'version',
      'status',
      'enforcementMode',
      'revision',
      'managedObjects',
    ]) ||
    !Array.isArray(value.managedObjects) ||
    value.managedObjects.length === 0
  ) {
    return invalidInconnectRecordAccessPolicyMaps(
      'MANAGED policy cache must contain managed objects',
      'corrupt',
    );
  }

  const managedObjects = value.managedObjects.map(parseManagedObject);

  if (
    managedObjects.some((managedObject) => managedObject === undefined) ||
    !areManagedObjectsConsistent(
      managedObjects as InconnectRecordAccessPolicyMapManagedObject[],
    )
  ) {
    return invalidInconnectRecordAccessPolicyMaps(
      'INCONNECT policy cache managed objects are malformed or ambiguous',
      'corrupt',
    );
  }

  return {
    version: 1,
    status: 'valid',
    enforcementMode: 'MANAGED',
    revision: value.revision,
    managedObjects:
      managedObjects as InconnectRecordAccessPolicyMapManagedObject[],
  };
};
