import { type InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

export type InconnectTeamMembershipMapEntry = {
  teamId: string;
  membershipType: InconnectCommercialTeamMembershipType;
  isWorkspaceMemberAssignable: boolean;
};

export type InconnectTeamAccessMaps =
  | {
      version: 1;
      status: 'valid';
      membershipByWorkspaceMemberId: Record<
        string,
        InconnectTeamMembershipMapEntry
      >;
      memberWorkspaceMemberIdsByTeamId: Record<string, string[]>;
      assignableMemberWorkspaceMemberIdsByTeamId: Record<string, string[]>;
    }
  | {
      version: 1;
      status: 'invalid';
      reason: string;
      failureKind: InconnectTeamAccessMapsFailureKind;
    };

export type InconnectTeamAccessMapsFailureKind =
  | 'invalid'
  | 'corrupt'
  | 'recomputation-failed';

export type InconnectTeamAccessMapsAuthorizationDecision =
  | {
      kind: 'available';
      maps: Extract<InconnectTeamAccessMaps, { status: 'valid' }>;
    }
  | {
      kind: 'denied';
      reason: 'absent' | 'invalid' | 'corrupt' | 'recomputation-failed';
    };
