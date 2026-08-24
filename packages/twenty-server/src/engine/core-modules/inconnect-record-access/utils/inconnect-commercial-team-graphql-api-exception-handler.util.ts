import { QueryFailedError } from 'typeorm';

import {
  InconnectCommercialTeamException,
  InconnectCommercialTeamExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team.exception';
import {
  ConflictError,
  InternalServerError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

const isUniqueConstraintViolation = (error: QueryFailedError): boolean =>
  (error.driverError as { code?: string }).code === '23505';

export const handleInconnectCommercialTeamGraphqlError = (
  error: unknown,
): never => {
  if (error instanceof QueryFailedError && isUniqueConstraintViolation(error)) {
    throw new ConflictError(
      'The commercial team change conflicts with the current workspace state.',
      { subCode: 'INCONNECT_COMMERCIAL_TEAM_CONFLICT' },
    );
  }

  if (!(error instanceof InconnectCommercialTeamException)) {
    throw new InternalServerError('INCONNECT Commercial Team operation failed');
  }

  switch (error.code) {
    case InconnectCommercialTeamExceptionCode.INVALID_INPUT:
      throw new UserInputError('The commercial team input is invalid.', {
        subCode: error.code,
      });
    case InconnectCommercialTeamExceptionCode.NOT_FOUND:
      throw new NotFoundError(
        'The requested commercial team or membership was not found.',
        { subCode: error.code },
      );
    case InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT:
      throw new ConflictError(
        'The commercial team membership conflicts with the current team state.',
        { subCode: error.code },
      );
    case InconnectCommercialTeamExceptionCode.WORKSPACE_MEMBER_INVALID:
      throw new NotFoundError(
        'The requested Workspace Member is not available in this workspace.',
        { subCode: error.code },
      );
  }
};
