import { gql } from '@apollo/client';

export const GET_INCONNECT_RECORD_ACCESS_CONFIGURATION = gql`
  query GetInconnectRecordAccessConfiguration {
    getInconnectRecordAccessConfiguration {
      status
      enforcementMode
      revision
      managedObjects {
        id
        objectMetadataId
        objectUniversalIdentifier
        objectNameSingular
        objectLabelSingular
        ownerFieldMetadataId
        ownerFieldUniversalIdentifier
        ownerFieldName
        ownerFieldLabel
        ownerRequirement
        policies {
          id
          roleId
          roleLabel
          roleUniversalIdentifier
          principalType
          recordEffect
          createPolicy
          ownerTransferPolicy
          missingOwnerPolicy
          defaultOwnerRoleId
          defaultOwnerRoleLabel
        }
      }
    }
  }
`;
