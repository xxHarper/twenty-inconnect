import { LeadDistributionError } from 'src/modules/inconnect-lead-management/distribution/lead-distribution-error';
import { type LeadDistributionSelection } from 'src/modules/inconnect-lead-management/distribution/lead-distribution.types';

export const computeEvenLeadQuotas = (
  leads: readonly LeadDistributionSelection[],
  recipientIds: readonly string[],
): Map<string, number> => {
  if (recipientIds.length === 0) {
    return new Map();
  }

  const base = Math.floor(leads.length / recipientIds.length);
  const remainder = leads.length % recipientIds.length;
  const ownedCounts = new Map<string, number>();

  for (const lead of leads) {
    if (lead.currentOwnerWorkspaceMemberId !== null) {
      ownedCounts.set(
        lead.currentOwnerWorkspaceMemberId,
        (ownedCounts.get(lead.currentOwnerWorkspaceMemberId) ?? 0) + 1,
      );
    }
  }

  // Only owners above the base quota gain a retained Lead from an extra slot.
  // Pick those first, then break equal-cost ties by canonical recipient UUID.
  const rankedRecipients = [...recipientIds].sort((left, right) => {
    const leftGain = Number((ownedCounts.get(left) ?? 0) > base);
    const rightGain = Number((ownedCounts.get(right) ?? 0) > base);

    return rightGain - leftGain || (left < right ? -1 : 1);
  });

  return new Map(
    rankedRecipients.map((recipientId, index) => [
      recipientId,
      base + Number(index < remainder),
    ]),
  );
};

export const allocateLeadQuotas = (
  leads: readonly LeadDistributionSelection[],
  recipientIds: readonly string[],
  quotas: ReadonlyMap<string, number>,
): Map<string, string> => {
  let available = leads.length;

  // Subtract before summing so even several MAX_SAFE_INTEGER quotas cannot overflow.
  for (const quota of quotas.values()) {
    if (quota > available) {
      throw new LeadDistributionError('QUOTA_EXCEEDS_AVAILABLE');
    }
    available -= quota;
  }

  const deficits = new Map(quotas);
  const assignments = new Map<string, string>();
  const pool: LeadDistributionSelection[] = [];

  // Reserve every feasible unchanged assignment before filling any other quota.
  for (const lead of leads) {
    const owner = lead.currentOwnerWorkspaceMemberId;
    const deficit = owner === null ? 0 : (deficits.get(owner) ?? 0);

    if (owner !== null && deficit > 0) {
      assignments.set(lead.recordId, owner);
      deficits.set(owner, deficit - 1);
    } else {
      pool.push(lead);
    }
  }

  let poolIndex = 0;

  for (const recipientId of recipientIds) {
    const deficit = deficits.get(recipientId) ?? 0;

    for (let index = 0; index < deficit; index++) {
      assignments.set(pool[poolIndex].recordId, recipientId);
      poolIndex++;
    }
  }

  return assignments;
};
