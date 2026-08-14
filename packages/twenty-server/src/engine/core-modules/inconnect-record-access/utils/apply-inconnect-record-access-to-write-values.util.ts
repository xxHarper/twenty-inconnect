import { type ObjectLiteral } from 'typeorm';

import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';

type WriteValues = ObjectLiteral | ObjectLiteral[] | undefined;

type OwnerWrite = {
  isProvided: boolean;
  isConflicting: boolean;
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
          isConflicting: true,
          workspaceMemberId: undefined,
        };
      }

      if (joinColumnValue === undefined) {
        return {
          isProvided: true,
          isConflicting: false,
          workspaceMemberId: relationWorkspaceMemberId,
        };
      }
    }

    return {
      isProvided: true,
      isConflicting: false,
      workspaceMemberId: joinColumnValue,
    };
  }

  if (!hasRelationField) {
    return {
      isProvided: false,
      isConflicting: false,
      workspaceMemberId: undefined,
    };
  }

  return {
    isProvided: true,
    isConflicting: false,
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

const assertOwnerWriteIsConsistent = (ownerWrite: OwnerWrite): void => {
  if (ownerWrite.isConflicting) {
    throwAccessDenied(
      'Conflicting owner relation and join-column values are denied',
    );
  }
};

const assertRequiredOwnerIsPresent = (ownerWrite: OwnerWrite): void => {
  if (
    ownerWrite.isProvided &&
    typeof ownerWrite.workspaceMemberId !== 'string'
  ) {
    throwAccessDenied(
      'A non-null owner is required by INCONNECT Record Access',
    );
  }
};

export const doesInconnectCreateRequireDefaultOwnerResolution = ({
  decision,
  valuesSet,
}: {
  decision: InconnectRecordAccessDecision;
  valuesSet: WriteValues;
}): boolean => {
  if (
    decision.kind === 'not-managed' ||
    decision.kind === 'system-bypass' ||
    decision.kind === 'denied' ||
    decision.createPolicy === 'denied' ||
    decision.missingOwnerPolicy !== 'singleActiveMemberOfRole'
  ) {
    return false;
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];

  return valuesArray.some(
    (values) =>
      !getOwnerWrite({
        values,
        ownerFieldName: decision.ownerFieldName,
        ownerJoinColumnName: decision.ownerJoinColumnName,
      }).isProvided,
  );
};

export const applyInconnectRecordAccessToCreateValues = ({
  decision,
  valuesSet,
  resolvedDefaultOwnerWorkspaceMemberId,
}: {
  decision: InconnectRecordAccessDecision;
  valuesSet: WriteValues;
  resolvedDefaultOwnerWorkspaceMemberId?: string;
}): WriteValues => {
  if (decision.kind === 'not-managed' || decision.kind === 'system-bypass') {
    return valuesSet;
  }

  if (decision.kind === 'denied' || decision.createPolicy === 'denied') {
    return throwAccessDenied('Create denied by INCONNECT Record Access');
  }

  const valuesArray = Array.isArray(valuesSet) ? valuesSet : [valuesSet ?? {}];
  const securedValues = valuesArray.map((values) => {
    const ownerWrite = getOwnerWrite({
      values,
      ownerFieldName: decision.ownerFieldName,
      ownerJoinColumnName: decision.ownerJoinColumnName,
    });

    assertOwnerWriteIsConsistent(ownerWrite);

    if (!ownerWrite.isProvided) {
      if (decision.missingOwnerPolicy === 'self') {
        return {
          ...values,
          [decision.ownerJoinColumnName]:
            decision.authenticatedWorkspaceMemberId,
        };
      }

      if (decision.missingOwnerPolicy === 'singleActiveMemberOfRole') {
        if (typeof resolvedDefaultOwnerWorkspaceMemberId !== 'string') {
          return throwAccessDenied(
            'The configured default owner Role does not have exactly one active Workspace Member',
          );
        }

        return {
          ...values,
          [decision.ownerJoinColumnName]: resolvedDefaultOwnerWorkspaceMemberId,
        };
      }

      if (
        decision.missingOwnerPolicy === 'requireExplicit' ||
        decision.ownerRequirement === 'required'
      ) {
        return throwAccessDenied(
          'An explicit owner is required by INCONNECT Record Access',
        );
      }

      return values;
    }

    if (decision.ownerRequirement === 'required') {
      assertRequiredOwnerIsPresent(ownerWrite);
    }

    if (decision.createPolicy === 'standardPermissionsOnly') {
      return values;
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

    assertOwnerWriteIsConsistent(ownerWrite);

    if (decision.ownerRequirement === 'required') {
      assertRequiredOwnerIsPresent(ownerWrite);
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
