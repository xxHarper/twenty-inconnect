export const InconnectCommercialTeamMembershipType = {
  COORDINATOR: 'COORDINATOR',
  EXECUTIVE: 'EXECUTIVE',
} as const;

export type InconnectCommercialTeamMembershipType =
  (typeof InconnectCommercialTeamMembershipType)[keyof typeof InconnectCommercialTeamMembershipType];
