import { type ObjectLiteral } from 'typeorm';

import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import {
  hasNoInconnectRecordAccessScope,
  type InconnectRecordAccessDecision,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';

type WriteValues = ObjectLiteral | ObjectLiteral[] | undefined;

const getWorkspaceMemberIdFromRelationValue = (
  relationValue: unknown,
): unknown => {
  if (
    typeof relationValue === 'object' &&
    relationValue !== null &&
    'id' in relationValue
  ) {
    return (relationValue as { id?: unknown }).id;
  }

  return relationValue;
};

const getOwnerWorkspaceMemberId = ({
  values,
  ownerFieldName,
  ownerJoinColumnName,
}: {
  values: ObjectLiteral;
  ownerFieldName: string;
  ownerJoinColumnName: string;
}): unknown => {
  const hasJoinColumn = Object.prototype.hasOwnProperty.call(
    values,
    ownerJoinColumnName,
  );
  const hasRelationField = Object.prototype.hasOwnProperty.call(
    values,
    ownerFieldName,
  );
  const joinColumnValue = values[ownerJoinColumnName];
  const relationValue = values[ownerFieldName];

  if (hasJoinColumn && joinColumnValue !== undefined) {
    if (
      hasRelationField &&
      relationValue !== null &&
      relationValue !== undefined
    ) {
      const relationWorkspaceMemberId =
        getWorkspaceMemberIdFromRelationValue(relationValue);

      if (relationWorkspaceMemberId !== joinColumnValue) {
        return Symbol('conflicting-owner-values');
      }
    }

    return joinColumnValue;
  }

  if (!hasRelationField) {
    return undefined;
  }

  return getWorkspaceMemberIdFromRelationValue(relationValue);
};

const assertOwnerIsAssignable = ({
  ownerWorkspaceMemberId,
  assignableOwnerWorkspaceMemberIds,
}: {
  ownerWorkspaceMemberId: unknown;
  assignableOwnerWorkspaceMemberIds: readonly string[];
}): void => {
  if (
    typeof ownerWorkspaceMemberId !== 'string' ||
    !assignableOwnerWorkspaceMemberIds.includes(ownerWorkspaceMemberId)
  ) {
    throw new InconnectRecordAccessException(
      'Owner is outside the INCONNECT assignable-owner scope',
      InconnectRecordAccessExceptionCode.ACCESS_DENIED,
    );
  }
};

export const applyInconnectRecordAccessToCreateValues = ({
  decision,
  valuesSet,
}: {
  decision: InconnectRecordAccessDecision;
  valuesSet: WriteValues;
}): WriteValues => {
  if (hasNoInconnectRecordAccessScope(decision)) {
    return valuesSet;
  }

  if (decision.kind === 'denied') {
    throw new InconnectRecordAccessException(
      'Create denied by INCONNECT Record Access',
      InconnectRecordAccessExceptionCode.ACCESS_DENIED,
    );
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];
  const securedValues = valuesArray.map((values) => {
    const ownerWorkspaceMemberId = getOwnerWorkspaceMemberId({
      values,
      ownerFieldName: decision.ownerFieldName,
      ownerJoinColumnName: decision.ownerJoinColumnName,
    });

    if (ownerWorkspaceMemberId === undefined) {
      return {
        ...values,
        [decision.ownerJoinColumnName]: decision.authenticatedWorkspaceMemberId,
      };
    }

    assertOwnerIsAssignable({
      ownerWorkspaceMemberId,
      assignableOwnerWorkspaceMemberIds:
        decision.assignableOwnerWorkspaceMemberIds,
    });

    return values;
  });

  return Array.isArray(valuesSet) ? securedValues : securedValues[0];
};

export const validateInconnectRecordAccessUpdateValues = ({
  decision,
  valuesSet,
}: {
  decision: InconnectRecordAccessDecision;
  valuesSet: WriteValues;
}): void => {
  if (hasNoInconnectRecordAccessScope(decision)) {
    return;
  }

  if (decision.kind === 'denied') {
    throw new InconnectRecordAccessException(
      'Update denied by INCONNECT Record Access',
      InconnectRecordAccessExceptionCode.ACCESS_DENIED,
    );
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];

  for (const values of valuesArray) {
    const ownerWorkspaceMemberId = getOwnerWorkspaceMemberId({
      values,
      ownerFieldName: decision.ownerFieldName,
      ownerJoinColumnName: decision.ownerJoinColumnName,
    });

    if (ownerWorkspaceMemberId === undefined) {
      continue;
    }

    assertOwnerIsAssignable({
      ownerWorkspaceMemberId,
      assignableOwnerWorkspaceMemberIds:
        decision.assignableOwnerWorkspaceMemberIds,
    });
  }
};
