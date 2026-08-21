import { gql } from '@apollo/client';

export const GET_INCONNECT_RECORD_ACCESS_AVAILABLE_METADATA = gql`
  query GetInconnectRecordAccessAvailableMetadata {
    getInconnectRecordAccessAvailableMetadata {
      objects {
        objectMetadataId
        universalIdentifier
        nameSingular
        namePlural
        labelSingular
        labelPlural
        isActive
        ownerFields {
          fieldMetadataId
          universalIdentifier
          name
          label
          isActive
          joinColumnName
        }
      }
      roles {
        roleId
        universalIdentifier
        label
      }
    }
  }
`;
