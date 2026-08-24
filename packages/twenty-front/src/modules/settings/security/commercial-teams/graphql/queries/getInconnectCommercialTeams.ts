import { gql } from '@apollo/client';

export const GET_INCONNECT_COMMERCIAL_TEAMS = gql`
  query GetInconnectCommercialTeams {
    getInconnectCommercialTeams {
      id
      name
      coordinator {
        membershipId
        workspaceMemberId
        displayName
        email
        isAssignable
      }
      executives {
        membershipId
        workspaceMemberId
        displayName
        email
        isAssignable
      }
    }
  }
`;
