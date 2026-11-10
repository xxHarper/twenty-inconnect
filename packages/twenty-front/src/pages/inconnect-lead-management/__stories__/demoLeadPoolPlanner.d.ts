declare module '#demo-a4-lead-pool-planner' {
  import type {
    LeadPoolPreviewInput,
    LeadPoolRecord,
  } from 'twenty-shared/types';

  // The A4 Vite alias resolves to the pure MVP planner without importing Nest.
  export const planExplicitLeadPool: (
    input: LeadPoolPreviewInput,
    records: (Pick<LeadPoolRecord, 'id' | 'ownerId'> & { updatedAt: string })[],
  ) => {
    recordId: string;
    expectedOwnerId: string | null;
    recipientId: string | null;
    status: 'PENDING' | 'REMAINING';
  }[];
}
