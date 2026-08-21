import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import {
  ConflictError,
  InternalServerError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

export const handleInconnectRecordAccessConfigurationGraphqlError = (
  error: unknown,
): never => {
  if (!(error instanceof InconnectRecordAccessConfigurationException)) {
    throw new InternalServerError(
      'INCONNECT Record Access configuration operation failed',
    );
  }

  switch (error.code) {
    case InconnectRecordAccessConfigurationExceptionCode.REVISION_CONFLICT:
      throw new ConflictError(
        'This configuration changed since it was loaded. Reload before saving.',
        { subCode: error.code },
      );
    case InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT:
      throw new UserInputError(
        'The INCONNECT Record Access configuration is invalid.',
        { subCode: error.code },
      );
    case InconnectRecordAccessConfigurationExceptionCode.NOT_FOUND:
      throw new NotFoundError('The requested workspace was not found.', {
        subCode: error.code,
      });
    case InconnectRecordAccessConfigurationExceptionCode.CACHE_REVOCATION_FAILED:
      throw new InternalServerError(
        'The configuration was not published because its security cache could not be revoked.',
        { subCode: error.code },
      );
  }
};
