import { QueryFailedError } from 'typeorm';

import { AttentionReadFailure } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { type AttentionWriterError } from './attention-writer.types';

// Internal identity-bound diagnostic: public III-A results retain their exact
// shape. No driver object, cause, SQL, parameters or message crosses admission.
const diagnostics = new WeakMap<AttentionWriterError, string>();

export const admissionFailure = (error: unknown): AttentionWriterError => {
  const failure: AttentionWriterError = {
    code: 'ADMISSION_FAILED',
    path: '$.admission',
  };
  let code: unknown;
  if (
    error instanceof AttentionReadFailure &&
    error.failure.code === 'QUERY_FAILED'
  )
    code = error.failure.sqlState;
  else if (error instanceof QueryFailedError)
    code = Object.getOwnPropertyDescriptor(error.driverError, 'code')?.value;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
    diagnostics.set(failure, code);
  return failure;
};

export const readAdmissionSqlState = (failure: AttentionWriterError) =>
  diagnostics.get(failure);
