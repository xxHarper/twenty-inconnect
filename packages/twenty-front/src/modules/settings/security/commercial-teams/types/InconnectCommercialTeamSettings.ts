import type {
  GetInconnectCommercialTeamAvailableMembersQuery,
  GetInconnectCommercialTeamsQuery,
} from '~/generated-metadata/graphql';

export type InconnectCommercialTeamSettingsTeam =
  GetInconnectCommercialTeamsQuery['getInconnectCommercialTeams'][number];

export type InconnectCommercialTeamSettingsMember = NonNullable<
  InconnectCommercialTeamSettingsTeam['coordinator']
>;

export type InconnectCommercialTeamSettingsAvailableMember =
  GetInconnectCommercialTeamAvailableMembersQuery['getInconnectCommercialTeamAvailableMembers'][number];
