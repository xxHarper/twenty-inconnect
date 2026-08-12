import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';

export type InconnectUnsupportedWriteOperation =
  | 'merge'
  | 'recover'
  | 'remove'
  | 'save'
  | 'softRemove'
  | 'upsert';

export const assertInconnectRecordAccessOperationSupported = ({
  decision,
  operation,
}: {
  decision: InconnectRecordAccessDecision;
  operation: InconnectUnsupportedWriteOperation;
}): void => {
  if (decision.kind === 'unrestricted') {
    return;
  }

  throw new InconnectRecordAccessException(
    `${operation} is not supported for an INCONNECT-scoped object`,
    InconnectRecordAccessExceptionCode.UNSUPPORTED_OPERATION,
  );
};
