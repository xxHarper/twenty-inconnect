import { type LeadPoolPreviewInput } from 'twenty-shared/types';

import { type LeadPoolItem } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-contract';

// Independent uncategorized contract. It does not invoke or amend 1B-1A.
// The caller supplies authorized rows and recipients; a plan grants no authority.
export const planExplicitLeadPool = (
  input: LeadPoolPreviewInput,
  records: { id: string; ownerId: string | null; updatedAt: string }[],
): LeadPoolItem[] => {
  const recipients = [...input.recipientIds].sort();
  const rows = [...records].sort((left, right) =>
    left.id < right.id ? -1 : 1,
  );
  const base = Math.floor(rows.length / recipients.length);
  const ownedCounts = new Map(recipients.map((id) => [id, 0]));
  for (const row of rows) {
    if (row.ownerId !== null && ownedCounts.has(row.ownerId)) {
      ownedCounts.set(row.ownerId, ownedCounts.get(row.ownerId)! + 1);
    }
  }
  const ranked = [...recipients].sort(
    (left, right) =>
      Number(ownedCounts.get(right)! > base) -
        Number(ownedCounts.get(left)! > base) || (left < right ? -1 : 1),
  );
  const quotas = new Map(
    recipients.map((id) => [
      id,
      input.mode === 'SINGLE'
        ? rows.length
        : input.mode === 'MANUAL_QUOTAS'
          ? input.quotas!.find((quota) => quota.recipientId === id)!.quantity
          : base + Number(ranked.indexOf(id) < rows.length % recipients.length),
    ]),
  );
  const assignments = new Map<string, string>();
  for (const row of rows) {
    if (row.ownerId !== null && (quotas.get(row.ownerId) ?? 0) > 0) {
      assignments.set(row.id, row.ownerId);
      quotas.set(row.ownerId, quotas.get(row.ownerId)! - 1);
    }
  }
  const pool = rows.filter((row) => !assignments.has(row.id));
  let position = 0;
  for (const recipientId of recipients) {
    for (let index = 0; index < quotas.get(recipientId)!; index++) {
      assignments.set(pool[position++].id, recipientId);
    }
  }
  return rows.map((row) => ({
    recordId: row.id,
    expectedOwnerId: row.ownerId,
    expectedUpdatedAt: row.updatedAt,
    recipientId: assignments.get(row.id) ?? null,
    status: assignments.has(row.id) ? 'PENDING' : 'REMAINING',
  }));
};
