import { gql } from '@apollo/client';

export const REPLACE_INCONNECT_RECORD_ACCESS_CONFIGURATION = gql`
  mutation ReplaceInconnectRecordAccessConfiguration(
    $input: ReplaceInconnectRecordAccessConfigurationInput!
  ) {
    replaceInconnectRecordAccessConfiguration(input: $input) {
      revision
      cacheStatus
      changedFromManagedToUnmanaged
    }
  }
`;
