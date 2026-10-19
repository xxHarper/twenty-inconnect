import {
  allocateLeadQuotas,
  computeEvenLeadQuotas,
} from 'src/modules/inconnect-lead-management/distribution/allocate-lead-quotas';
import {
  type LeadCategory,
  type LeadDistributionCounts,
  type LeadDistributionInput,
  type LeadDistributionLimits,
  type LeadDistributionPlan,
  type PlannedLead,
  type PlannedLeadAssignment,
} from 'src/modules/inconnect-lead-management/distribution/lead-distribution.types';
import { normalizeLeadDistributionInput } from 'src/modules/inconnect-lead-management/distribution/normalize-lead-distribution-input';

const CATEGORIES: readonly LeadCategory[] = ['NORMAL', 'MESSAGE_PENDING'];

type MutableCounts = {
  -readonly [TKey in keyof LeadDistributionCounts]: number;
};

const emptyCounts = (): MutableCounts => ({
  selected: 0,
  distributed: 0,
  changed: 0,
  unchanged: 0,
  remaining: 0,
});

const emptyCategoryCounts = () => ({
  NORMAL: emptyCounts(),
  MESSAGE_PENDING: emptyCounts(),
});

export const buildLeadDistributionPlan = (
  input: LeadDistributionInput,
  limits: LeadDistributionLimits,
): LeadDistributionPlan => {
  const normalized = normalizeLeadDistributionInput(input, limits);
  const recipientIds = normalized.recipients.map(
    (recipient) => recipient.workspaceMemberId,
  );
  const changes: PlannedLeadAssignment[] = [];
  const unchanged: PlannedLeadAssignment[] = [];
  const remaining: PlannedLead[] = [];
  const assignments = new Map<string, string>();
  const separateCategories =
    normalized.mode === 'MANUAL_QUOTAS' ||
    (normalized.mode === 'EVEN' && normalized.balanceBy === 'CATEGORY');
  const groups = separateCategories
    ? CATEGORIES.map((category) => ({
        category,
        leads: normalized.leads.filter((lead) => lead.category === category),
      }))
    : [{ category: null, leads: normalized.leads }];

  for (const group of groups) {
    let quotas: Map<string, number>;

    switch (normalized.mode) {
      case 'SINGLE':
        quotas = new Map([[recipientIds[0], group.leads.length]]);
        break;
      case 'EVEN':
        quotas = computeEvenLeadQuotas(group.leads, recipientIds);
        break;
      case 'MANUAL_QUOTAS':
        quotas = new Map(
          normalized.quotas.map((quota) => [
            quota.recipientWorkspaceMemberId,
            group.category === null ? 0 : quota.quantities[group.category],
          ]),
        );
        break;
    }

    const allocation = allocateLeadQuotas(group.leads, recipientIds, quotas);

    for (const [recordId, recipientId] of allocation) {
      assignments.set(recordId, recipientId);
    }
  }

  const totals = emptyCounts();
  const totalsByCategory = emptyCategoryCounts();
  const recipients = normalized.recipients.map((recipient) => ({
    workspaceMemberId: recipient.workspaceMemberId,
    quantities: { NORMAL: 0, MESSAGE_PENDING: 0 },
    totals: emptyCounts(),
    totalsByCategory: emptyCategoryCounts(),
  }));
  const recipientSummaries = new Map(
    recipients.map((recipient) => [recipient.workspaceMemberId, recipient]),
  );

  for (const lead of normalized.leads) {
    const plannedLead: PlannedLead = {
      identity: { ...normalized.scope, recordId: lead.recordId },
      category: lead.category,
      expectedOwnerWorkspaceMemberId: lead.currentOwnerWorkspaceMemberId,
    };
    const recipientId = assignments.get(lead.recordId);
    const recipient =
      recipientId === undefined
        ? undefined
        : recipientSummaries.get(recipientId);
    const counters = [totals, totalsByCategory[lead.category]];

    if (recipientId !== undefined && recipient !== undefined) {
      const isUnchanged = recipientId === lead.currentOwnerWorkspaceMemberId;
      const assignment = {
        ...plannedLead,
        recipientWorkspaceMemberId: recipientId,
      };

      (isUnchanged ? unchanged : changes).push(assignment);
      recipient.quantities[lead.category]++;
      counters.push(
        recipient.totals,
        recipient.totalsByCategory[lead.category],
      );

      for (const counter of counters) {
        counter.distributed++;
        counter[isUnchanged ? 'unchanged' : 'changed']++;
      }
    } else {
      remaining.push(plannedLead);
      for (const counter of counters) {
        counter.remaining++;
      }
    }

    for (const counter of counters) {
      counter.selected++;
    }
  }

  return {
    algorithmVersion: '1.0.0',
    deterministicOrder: 'CANONICAL_UUID_ASC',
    scope: { ...normalized.scope },
    mode: normalized.mode,
    balanceBy: normalized.mode === 'EVEN' ? normalized.balanceBy : null,
    changes,
    unchanged,
    remaining,
    totals,
    totalsByCategory,
    recipients,
  };
};
