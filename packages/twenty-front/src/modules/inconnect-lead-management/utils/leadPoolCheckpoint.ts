import {
  type LeadPoolItemStatus,
  type LeadPoolOperation,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';
import { typedObjectEntries } from 'twenty-shared/utils';

import { isTerminalLeadPoolStatus } from '@/inconnect-lead-management/utils/leadPoolOperationSchema';

export const getOperationCheckpoint = (
  {
    id,
    objectId,
    intentionId,
    mode,
    version,
    status,
    processed,
    counts,
    batchFailures,
    lastBatchError,
    found,
    expiresAt,
    selected,
    plannedChanges,
    plannedUnchanged,
    plannedRemaining,
    recipients,
  }: LeadPoolOperation,
  recordHistory: RecordHistory,
) => ({
  id,
  objectId,
  intentionId,
  mode,
  version,
  status,
  processed,
  counts: { ...counts },
  batchFailures,
  lastBatchError,
  found,
  expiresAt,
  selected,
  plannedChanges,
  plannedUnchanged,
  plannedRemaining,
  recipientQuantities: new Map(
    recipients.map(({ id, quantity }) => [id.toLowerCase(), quantity]),
  ),
  recordHistory,
});

export type OperationCheckpoint = ReturnType<typeof getOperationCheckpoint>;

type RecordHistory = Map<
  string,
  { status: LeadPoolItemStatus; version: number }
>;

export const mergeLeadPoolRecordHistory = (
  result: LeadPoolOperation,
  previous?: OperationCheckpoint,
) => {
  const history: RecordHistory = new Map(previous?.recordHistory);
  for (const { recordId, status } of result.items) {
    const known = history.get(recordId);
    if (
      known &&
      known.status !== status &&
      (known.status !== 'PENDING' ||
        result.version <= known.version ||
        (status === 'REMAINING' && result.status !== 'CANCELLED'))
    )
      return null;

    history.set(recordId, { status, version: result.version });
  }

  // A projection can hide facts but cannot introduce more IDs or resolved outcomes
  // than the immutable selection and current counters permit.
  if (history.size > result.selected) return null;
  const observed = new Map<LeadPoolItemStatus, number>();
  for (const { status, version } of history.values()) {
    if (status === 'PENDING' && version < result.version) continue;
    const count = (observed.get(status) ?? 0) + 1;
    if (count > result.counts[status]) return null;
    observed.set(status, count);
  }
  return history;
};

export const matchesOperationCheckpoint = (
  result: LeadPoolOperation,
  previous: OperationCheckpoint,
) => {
  if (
    result.id !== previous.id ||
    result.objectId !== previous.objectId ||
    result.intentionId !== previous.intentionId ||
    result.mode !== previous.mode ||
    result.found !== previous.found ||
    result.expiresAt !== previous.expiresAt ||
    result.selected !== previous.selected ||
    result.plannedChanges !== previous.plannedChanges ||
    result.plannedUnchanged !== previous.plannedUnchanged ||
    result.plannedRemaining !== previous.plannedRemaining
  )
    return false;

  const previousCounts = typedObjectEntries(previous.counts);
  const versionDelta = result.version - previous.version;
  if (versionDelta === 0)
    return (
      result.status === previous.status &&
      result.processed === previous.processed &&
      result.batchFailures === previous.batchFailures &&
      result.lastBatchError === previous.lastBatchError &&
      previousCounts.every(([status, count]) => result.counts[status] === count)
    );

  // A cancellation advances the version without recording a batch or processing a lead.
  const newBatches = versionDelta - Number(result.status === 'CANCELLED');
  const newBatchFailures = result.batchFailures - previous.batchFailures;

  return (
    versionDelta > 0 &&
    !isTerminalLeadPoolStatus(previous.status) &&
    result.processed >= previous.processed &&
    newBatchFailures >= 0 &&
    newBatchFailures <= newBatches &&
    (newBatches > 0 ||
      (result.processed === previous.processed &&
        result.lastBatchError === previous.lastBatchError)) &&
    // Only pending items can change status as new batches or a cancellation commit.
    previousCounts.every(([status, count]) =>
      status === 'PENDING'
        ? result.counts.PENDING <= count
        : result.counts[status] >= count,
    )
  );
};

export const matchesPreviewInput = (
  result: LeadPoolOperation,
  input: LeadPoolPreviewInput,
) => {
  const recipientIds = new Set(
    input.recipientIds.map((id) => id.toLowerCase()),
  );
  const recordIds = new Set(input.recordIds.map((id) => id.toLowerCase()));
  const quotas = new Map(
    input.quotas?.map(({ recipientId, quantity }) => [
      recipientId.toLowerCase(),
      quantity,
    ]),
  );

  return (
    result.intentionId === input.intentionId.toLowerCase() &&
    result.objectId === input.objectId.toLowerCase() &&
    result.mode === input.mode &&
    result.selected === input.recordIds.length &&
    result.items.every(({ recordId }) => recordIds.has(recordId)) &&
    result.recipients.length === input.recipientIds.length &&
    result.recipients.every(
      ({ id, quantity }) =>
        recipientIds.has(id.toLowerCase()) &&
        (input.mode !== 'MANUAL_QUOTAS' ||
          quotas.get(id.toLowerCase()) === quantity),
    )
  );
};
