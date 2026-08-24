import { gql } from '@apollo/client';

export const GET_INCONNECT_COMMERCIAL_TEAM_AVAILABLE_MEMBERS = gql`
  query GetInconnectCommercialTeamAvailableMembers {
    getInconnectCommercialTeamAvailableMembers {
      workspaceMemberId
      displayName
      email
      currentTeamId
      currentMembershipType
    }
  }
`;
