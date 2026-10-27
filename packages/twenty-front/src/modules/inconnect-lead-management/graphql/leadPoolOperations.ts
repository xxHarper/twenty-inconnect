import { gql, type TypedDocumentNode } from '@apollo/client';
import {
  type LeadPoolCatalog,
  type LeadPoolFilter,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

// JSON scalar payloads use the same source contracts as the strict backend decoder.
export const LEAD_POOL_CATALOG: TypedDocumentNode<{
  inconnectLeadPoolCatalog: LeadPoolCatalog;
}> = gql`
  query InconnectLeadPoolCatalog {
    inconnectLeadPoolCatalog
  }
`;
export const LEAD_POOL_RECORDS: TypedDocumentNode<
  { inconnectLeadPoolRecords: LeadPoolPage },
  {
    input: {
      objectId: string;
      filter: LeadPoolFilter;
      offset: number;
      first: number;
    };
  }
> = gql`
  query InconnectLeadPoolRecords($input: JSONObject!) {
    inconnectLeadPoolRecords(input: $input)
  }
`;
export const LEAD_POOL_PREVIEW: TypedDocumentNode<
  { previewInconnectLeadPool: LeadPoolOperation },
  { input: LeadPoolPreviewInput }
> = gql`
  mutation PreviewInconnectLeadPool($input: JSONObject!) {
    previewInconnectLeadPool(input: $input)
  }
`;
export const LEAD_POOL_EXECUTE: TypedDocumentNode<
  { executeInconnectLeadPool: LeadPoolOperation },
  { input: { operationId: string; expectedVersion: number } }
> = gql`
  mutation ExecuteInconnectLeadPool($input: JSONObject!) {
    executeInconnectLeadPool(input: $input)
  }
`;
export const LEAD_POOL_CANCEL: TypedDocumentNode<
  { cancelInconnectLeadPool: LeadPoolOperation },
  { input: { operationId: string; expectedVersion: number } }
> = gql`
  mutation CancelInconnectLeadPool($input: JSONObject!) {
    cancelInconnectLeadPool(input: $input)
  }
`;
export const LEAD_POOL_OPERATION: TypedDocumentNode<
  { inconnectLeadPoolOperation: LeadPoolOperation },
  { input: { operationId: string } }
> = gql`
  query InconnectLeadPoolOperation($input: JSONObject!) {
    inconnectLeadPoolOperation(input: $input)
  }
`;
