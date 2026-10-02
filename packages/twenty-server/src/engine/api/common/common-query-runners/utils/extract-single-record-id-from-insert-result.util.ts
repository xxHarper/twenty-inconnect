import { isValidUuid } from 'twenty-shared/utils';
import { type InsertResult } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { STANDARD_ERROR_MESSAGE } from 'src/engine/api/common/common-query-runners/errors/standard-error-message.constant';

const throwInvalidInsertResult = (): never => {
  throw new CommonQueryRunnerException(
    'The create insert did not return exactly one trustworthy record identifier',
    CommonQueryRunnerExceptionCode.INTERNAL_SERVER_ERROR,
    { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
  );
};

export const extractSingleRecordIdFromInsertResult = (
  insertResult: InsertResult,
): string => {
  if (insertResult.identifiers.length !== 1) {
    return throwInvalidInsertResult();
  }

  const identifierId: unknown = insertResult.identifiers[0]?.id;

  if (typeof identifierId !== 'string' || !isValidUuid(identifierId)) {
    return throwInvalidInsertResult();
  }

  if (insertResult.generatedMaps.length !== 1) {
    return throwInvalidInsertResult();
  }

  const generatedMapId: unknown = insertResult.generatedMaps[0]?.id;

  if (generatedMapId !== identifierId) {
    return throwInvalidInsertResult();
  }

  const rawResult: unknown = insertResult.raw;

  if (rawResult !== undefined && rawResult !== null) {
    if (!Array.isArray(rawResult) || rawResult.length > 1) {
      return throwInvalidInsertResult();
    }

    if (rawResult.length === 1) {
      const rawRecord: unknown = rawResult[0];

      if (
        typeof rawRecord !== 'object' ||
        rawRecord === null ||
        !('id' in rawRecord) ||
        rawRecord.id !== identifierId
      ) {
        return throwInvalidInsertResult();
      }
    }
  }

  return identifierId;
};
