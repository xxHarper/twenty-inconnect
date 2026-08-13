import { msg } from '@lingui/core/macro';

import { CustomException } from 'src/utils/custom-exception';

export const InconnectCommercialTeamExceptionCode = {
  INVALID_INPUT: 'INCONNECT_COMMERCIAL_TEAM_INVALID_INPUT',
  NOT_FOUND: 'INCONNECT_COMMERCIAL_TEAM_NOT_FOUND',
  MEMBERSHIP_CONFLICT: 'INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_CONFLICT',
  WORKSPACE_MEMBER_INVALID:
    'INCONNECT_COMMERCIAL_TEAM_WORKSPACE_MEMBER_INVALID',
} as const;

type InconnectCommercialTeamExceptionCode =
  (typeof InconnectCommercialTeamExceptionCode)[keyof typeof InconnectCommercialTeamExceptionCode];

export class InconnectCommercialTeamException extends CustomException<InconnectCommercialTeamExceptionCode> {
  constructor(message: string, code: InconnectCommercialTeamExceptionCode) {
    super(message, code, {
      userFriendlyMessage: msg`The commercial team operation could not be completed.`,
    });
  }
}
