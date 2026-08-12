import { msg } from '@lingui/core/macro';

import { CustomException } from 'src/utils/custom-exception';

export const InconnectRecordAccessExceptionCode = {
  ACCESS_DENIED: 'INCONNECT_RECORD_ACCESS_DENIED',
  UNSUPPORTED_OPERATION: 'INCONNECT_RECORD_ACCESS_UNSUPPORTED_OPERATION',
} as const;

type InconnectRecordAccessExceptionCode =
  (typeof InconnectRecordAccessExceptionCode)[keyof typeof InconnectRecordAccessExceptionCode];

export class InconnectRecordAccessException extends CustomException<InconnectRecordAccessExceptionCode> {
  constructor(message: string, code: InconnectRecordAccessExceptionCode) {
    super(message, code, {
      userFriendlyMessage: msg`This operation is not allowed.`,
    });
  }
}
