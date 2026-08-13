import { type ObjectLiteral } from 'typeorm';

import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';

type WriteValues = ObjectLiteral | ObjectLiteral[] | undefined;

type OwnerWrite = {
  isProvided: boolean;
  workspaceMemberId: unknown;
};

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

const getOwnerWrite = ({
  values,
  ownerFieldName,
  ownerJoinColumnName,
}: {
  values: ObjectLiteral;
  ownerFieldName: string;
  ownerJoinColumnName: string;
}): OwnerWrite => {
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

  if (hasJoinColumn) {
    if (
      hasRelationField &&
      relationValue !== null &&
      relationValue !== undefined
    ) {
      const relationWorkspaceMemberId =
        getWorkspaceMemberIdFromRelationValue(relationValue);

      if (
        joinColumnValue !== undefined &&
        relationWorkspaceMemberId !== joinColumnValue
      ) {
        return {
          isProvided: true,
          workspaceMemberId: Symbol('conflicting-owner-values'),
        };
      }

      if (joinColumnValue === undefined) {
        return {
          isProvided: true,
          workspaceMemberId: relationWorkspaceMemberId,
        };
      }
    }

    return { isProvided: true, workspaceMemberId: joinColumnValue };
  }

  if (!hasRelationField) {
    return { isProvided: false, workspaceMemberId: undefined };
  }

  return {
    isProvided: true,
    workspaceMemberId: getWorkspaceMemberIdFromRelationValue(relationValue),
  };
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

const throwAccessDenied = (message: string): never => {
  throw new InconnectRecordAccessException(
    message,
    InconnectRecordAccessExceptionCode.ACCESS_DENIED,
  );
};

export const applyInconnectRecordAccessToCreateValues = ({
  decision,
  valuesSet,
}: {
  decision: InconnectRecordAccessDecision;
  valuesSet: WriteValues;
}): WriteValues => {
  if (decision.kind === 'not-managed' || decision.kind === 'system-bypass') {
    return valuesSet;
  }

  if (decision.kind === 'denied' || decision.createPolicy === 'denied') {
    return throwAccessDenied('Create denied by INCONNECT Record Access');
  }

  if (decision.createPolicy === 'standardPermissionsOnly') {
    return valuesSet;
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];
  const securedValues = valuesArray.map((values) => {
    const ownerWrite = getOwnerWrite({
      values,
      ownerFieldName: decision.ownerFieldName,
      ownerJoinColumnName: decision.ownerJoinColumnName,
    });

    if (!ownerWrite.isProvided) {
      return {
        ...values,
        [decision.ownerJoinColumnName]: decision.authenticatedWorkspaceMemberId,
      };
    }

    if (decision.createPolicy === 'defaultOwner') {
      return throwAccessDenied(
        'Explicit owner is denied by the INCONNECT create policy',
      );
    }

    assertOwnerIsAssignable({
      ownerWorkspaceMemberId: ownerWrite.workspaceMemberId,
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
  if (decision.kind === 'not-managed' || decision.kind === 'system-bypass') {
    return;
  }

  if (decision.kind === 'denied') {
    return throwAccessDenied('Update denied by INCONNECT Record Access');
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];

  for (const values of valuesArray) {
    const ownerWrite = getOwnerWrite({
      values,
      ownerFieldName: decision.ownerFieldName,
      ownerJoinColumnName: decision.ownerJoinColumnName,
    });

    if (!ownerWrite.isProvided) {
      continue;
    }

    if (decision.ownerTransferPolicy === 'denied') {
      return throwAccessDenied(
        'Owner transfer denied by INCONNECT Record Access',
      );
    }

    if (decision.ownerTransferPolicy === 'standardPermissionsOnly') {
      continue;
    }

    assertOwnerIsAssignable({
      ownerWorkspaceMemberId: ownerWrite.workspaceMemberId,
      assignableOwnerWorkspaceMemberIds:
        decision.assignableOwnerWorkspaceMemberIds,
    });
  }
};
