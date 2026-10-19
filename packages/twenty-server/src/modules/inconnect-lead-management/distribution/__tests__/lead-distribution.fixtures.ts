import {
  type LeadCategory,
  type LeadDistributionInput,
  type LeadDistributionLimits,
  type LeadDistributionSelection,
} from 'src/modules/inconnect-lead-management/distribution/lead-distribution.types';

// Synthetic identities only; never references to configured users or objects.
export const fixtureUuid = (value: number): string =>
  `abcdef00-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

export const SCOPE = {
  workspaceId: fixtureUuid(1000),
  objectMetadataId: fixtureUuid(1001),
};
export const RECIPIENT_IDS = [
  fixtureUuid(101),
  fixtureUuid(102),
  fixtureUuid(103),
];
export const LIMITS: LeadDistributionLimits = {
  maxLeads: 100,
  maxRecipients: 10,
};

export const makeLead = (
  value: number,
  currentOwnerWorkspaceMemberId: string | null = null,
  category: LeadCategory = 'NORMAL',
): LeadDistributionSelection => ({
  recordId: fixtureUuid(value),
  currentOwnerWorkspaceMemberId,
  category,
});

export const evenInput = (
  leads: readonly LeadDistributionSelection[],
  balanceBy: 'TOTAL' | 'CATEGORY' = 'TOTAL',
): LeadDistributionInput => ({
  mode: 'EVEN',
  balanceBy,
  scope: SCOPE,
  leads,
  recipients: RECIPIENT_IDS.map((workspaceMemberId) => ({ workspaceMemberId })),
});

export const freezeRecursively = <TValue>(value: TValue): TValue => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeRecursively);
    Object.freeze(value);
  }

  return value;
};
