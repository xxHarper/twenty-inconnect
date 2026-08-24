import { type InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

export type InconnectCommercialTeamCacheStatus =
  | 'recomputed'
  | 'recomputation-failed';

export type InconnectCommercialTeamOperationResult<TResult> = {
  result: TResult;
  cacheStatus: InconnectCommercialTeamCacheStatus;
};

export type InconnectCommercialTeamSettingsMember = {
  membershipId: string;
  workspaceMemberId: string;
  displayName: string;
  email: string | null;
  isAssignable: boolean;
};

export type InconnectCommercialTeamSettingsTeam = {
  id: string;
  name: string;
  coordinator: InconnectCommercialTeamSettingsMember | null;
  executives: InconnectCommercialTeamSettingsMember[];
};

export type InconnectCommercialTeamSettingsAvailableMember = {
  workspaceMemberId: string;
  displayName: string;
  email: string | null;
  currentTeamId: string | null;
  currentMembershipType: InconnectCommercialTeamMembershipType | null;
};

export type InconnectCommercialTeamSettingsMutationResult = {
  teamId: string;
  membershipId: string | null;
  cacheStatus: InconnectCommercialTeamCacheStatus;
};
