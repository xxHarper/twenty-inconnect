// Explicit, uncategorized CRM selection. Messaging categories are never inputs.
export type LeadPoolMode = 'SINGLE' | 'EVEN' | 'MANUAL_QUOTAS';

export type LeadPoolFilter = {
  ownerId?: string;
  search?: string;
  conditions?: {
    fieldId: string;
    operator: 'EQ' | 'NEQ' | 'BEFORE' | 'AFTER';
    value: string;
  }[];
  orderFieldId?: string;
  direction?: 'ASC' | 'DESC';
};

export type LeadPoolField = {
  id: string;
  label: string;
  type: 'TEXT' | 'SELECT' | 'BOOLEAN' | 'DATE' | 'DATE_TIME';
  options: { value: string; label: string }[];
};

export type LeadPoolCatalog = {
  objects: { id: string; label: string }[];
  storageReady: boolean;
  blockedReason: string | null;
  allMatchingReady: false;
  messagingClassification: 'NOT_READY';
};

export type LeadPoolRecord = {
  id: string;
  label: string | null;
  ownerId: string | null;
};

export type LeadPoolPage = {
  records: LeadPoolRecord[];
  total: number;
  offset: number;
  fields: LeadPoolField[];
  recipients: { id: string; label: string }[];
};

export type LeadPoolPreviewInput = {
  intentionId: string;
  objectId: string;
  recordIds: string[];
  recipientIds: string[];
  mode: LeadPoolMode;
  quotas?: { recipientId: string; quantity: number }[];
  filter: LeadPoolFilter;
  batchSize: number;
};

export type LeadPoolItemStatus =
  | 'CHANGED'
  | 'UNCHANGED'
  | 'CONFLICT'
  | 'REJECTED'
  | 'FAILED'
  | 'REMAINING'
  | 'PENDING';

export type LeadPoolOperation = {
  id: string;
  intentionId: string;
  objectId: string;
  mode: LeadPoolMode;
  status: 'PREVIEW' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
  version: number;
  found: number;
  selected: number;
  authorized: number;
  plannedChanges: number;
  plannedUnchanged: number;
  plannedRemaining: number;
  processed: number;
  lastBatchError: string | null;
  batchFailures: number;
  counts: Record<LeadPoolItemStatus, number>;
  recipients: {
    id: string;
    label: string | null;
    assignable: boolean;
    quantity: number;
  }[];
  canExecute: boolean;
  items: { recordId: string; status: LeadPoolItemStatus }[];
  hiddenItems: number;
  expiresAt: string;
};
