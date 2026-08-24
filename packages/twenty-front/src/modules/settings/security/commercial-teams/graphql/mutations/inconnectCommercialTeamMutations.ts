import { gql } from '@apollo/client';

export const INCONNECT_COMMERCIAL_TEAM_MUTATIONS = gql`
  fragment InconnectCommercialTeamMutationResultFields on InconnectCommercialTeamSettingsMutationResult {
    teamId
    membershipId
    cacheStatus
  }

  mutation CreateInconnectCommercialTeam(
    $input: CreateInconnectCommercialTeamInput!
  ) {
    createInconnectCommercialTeam(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation RenameInconnectCommercialTeam(
    $input: RenameInconnectCommercialTeamInput!
  ) {
    renameInconnectCommercialTeam(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation AssignInconnectCommercialTeamCoordinator(
    $input: InconnectCommercialTeamMembershipInput!
  ) {
    assignInconnectCommercialTeamCoordinator(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation AddInconnectCommercialTeamExecutive(
    $input: InconnectCommercialTeamMembershipInput!
  ) {
    addInconnectCommercialTeamExecutive(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation RemoveInconnectCommercialTeamExecutive(
    $input: InconnectCommercialTeamMembershipInput!
  ) {
    removeInconnectCommercialTeamExecutive(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation MoveInconnectCommercialTeamMember(
    $input: MoveInconnectCommercialTeamMemberInput!
  ) {
    moveInconnectCommercialTeamMember(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }

  mutation DeleteInconnectCommercialTeam(
    $input: DeleteInconnectCommercialTeamInput!
  ) {
    deleteInconnectCommercialTeam(input: $input) {
      ...InconnectCommercialTeamMutationResultFields
    }
  }
`;
