import {
  type LeadPoolItemStatus,
  type LeadPoolOperation,
} from 'twenty-shared/types';
import { z } from 'zod';

const count = z.int().nonnegative();
const canonicalUuid = z.uuid().transform((id) => id.toLowerCase());
const recipientSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  assignable: z.boolean(),
  quantity: count,
});
const hasUniqueRecipientIds = (recipients: { id: string }[]) =>
  new Set(recipients.map(({ id }) => id.toLowerCase())).size ===
  recipients.length;

export const leadPoolRecipientPlanSchema = z
  .array(recipientSchema.pick({ id: true, quantity: true }))
  .refine(hasUniqueRecipientIds);

const itemStatus = z.enum([
  'CHANGED',
  'UNCHANGED',
  'CONFLICT',
  'REJECTED',
  'FAILED',
  'REMAINING',
  'PENDING',
]);

export const isTerminalLeadPoolStatus = (status: LeadPoolOperation['status']) =>
  status === 'COMPLETED' || status === 'CANCELLED';

const hasConsistentVisibleItems = ({ items, counts }: LeadPoolOperation) => {
  const recordIds = new Set<string>();
  const visibleCounts = new Map<LeadPoolItemStatus, number>();

  // The backend counts every stored item and only returns currently readable IDs.
  return items.every(({ recordId, status }) => {
    const visibleCount = (visibleCounts.get(status) ?? 0) + 1;
    if (recordIds.has(recordId) || visibleCount > counts[status]) return false;

    recordIds.add(recordId);
    visibleCounts.set(status, visibleCount);
    return true;
  });
};

// JSONObject is opaque to GraphQL. Validate the result before it can resolve a write.
export const leadPoolOperationSchema = z
  .object({
    id: canonicalUuid,
    intentionId: canonicalUuid,
    objectId: canonicalUuid,
    mode: z.enum(['SINGLE', 'EVEN', 'MANUAL_QUOTAS']),
    status: z.enum(['PREVIEW', 'RUNNING', 'COMPLETED', 'CANCELLED']),
    version: count.max(5000),
    found: count,
    selected: count.max(1000),
    authorized: count,
    plannedChanges: count,
    plannedUnchanged: count,
    plannedRemaining: count,
    processed: count,
    lastBatchError: z.string().nullable(),
    batchFailures: count,
    counts: z.record(itemStatus, count),
    recipients: z
      .array(recipientSchema)
      .min(1)
      .max(50)
      .refine(hasUniqueRecipientIds),
    canExecute: z.boolean(),
    items: z
      .array(z.object({ recordId: canonicalUuid, status: itemStatus }))
      .max(1000),
    hiddenItems: count,
    expiresAt: z.iso.datetime(),
  })
  .refine(
    ({ status, version, counts, selected, processed, items, hiddenItems }) => {
      const { PENDING, REMAINING } = counts;

      return (
        (status === 'PREVIEW') === (version === 0) &&
        (status !== 'PREVIEW' || processed === 0) &&
        (status !== 'RUNNING' || PENDING > 0) &&
        (!isTerminalLeadPoolStatus(status) || PENDING === 0) &&
        Object.values(counts).reduce(
          (total, quantity) => total + quantity,
          0,
        ) === selected &&
        processed === selected - PENDING - REMAINING &&
        items.length + hiddenItems === selected
      );
    },
  )
  .refine((operation) => {
    const {
      authorized,
      batchFailures,
      counts,
      found,
      mode,
      plannedChanges,
      plannedUnchanged,
      plannedRemaining,
      recipients,
      selected,
      status,
      version,
    } = operation;
    const assigned = plannedChanges + plannedUnchanged;
    const cancelled = status === 'CANCELLED';

    return (
      found >= selected &&
      authorized === selected &&
      assigned + plannedRemaining === selected &&
      (mode === 'MANUAL_QUOTAS' || plannedRemaining === 0) &&
      (mode !== 'SINGLE' || recipients.length === 1) &&
      recipients.reduce((total, { quantity }) => total + quantity, 0) ===
        assigned &&
      counts.CHANGED <= plannedChanges &&
      counts.UNCHANGED <= plannedUnchanged &&
      (cancelled
        ? counts.REMAINING >= plannedRemaining
        : counts.REMAINING === plannedRemaining) &&
      batchFailures <= version - Number(cancelled)
    );
  })
  .refine(hasConsistentVisibleItems) satisfies z.ZodType<LeadPoolOperation>;
