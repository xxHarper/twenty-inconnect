export type LeadCategory = 'NORMAL' | 'MESSAGE_PENDING';

export type LeadDistributionScope = Readonly<{
  workspaceId: string;
  objectMetadataId: string;
}>;

export type LeadIdentity = LeadDistributionScope &
  Readonly<{ recordId: string }>;

export type LeadDistributionSelection = Readonly<{
  recordId: string;
  currentOwnerWorkspaceMemberId: string | null;
  category: LeadCategory;
}>;

export type LeadDistributionRecipient = Readonly<{ workspaceMemberId: string }>;

export type LeadCategoryQuantities = Readonly<Record<LeadCategory, number>>;

export type LeadRecipientQuota = Readonly<{
  recipientWorkspaceMemberId: string;
  quantities: LeadCategoryQuantities;
}>;

type LeadDistributionBaseInput = Readonly<{
  scope: LeadDistributionScope;
  leads: readonly LeadDistributionSelection[];
  recipients: readonly LeadDistributionRecipient[];
}>;

export type LeadDistributionInput = LeadDistributionBaseInput &
  (
    | Readonly<{ mode: 'SINGLE' }>
    | Readonly<{ mode: 'EVEN'; balanceBy: 'TOTAL' | 'CATEGORY' }>
    | Readonly<{
        mode: 'MANUAL_QUOTAS';
        quotas: readonly LeadRecipientQuota[];
      }>
  );

// Callers must choose their own limits; these are not product-approved maxima.
export type LeadDistributionLimits = Readonly<{
  maxLeads: number;
  maxRecipients: number;
}>;

export type PlannedLead = Readonly<{
  identity: LeadIdentity;
  category: LeadCategory;
  expectedOwnerWorkspaceMemberId: string | null;
}>;

export type PlannedLeadAssignment = PlannedLead &
  Readonly<{ recipientWorkspaceMemberId: string }>;

export type LeadDistributionCounts = Readonly<{
  selected: number;
  distributed: number;
  changed: number;
  unchanged: number;
  remaining: number;
}>;

export type LeadDistributionPlan = Readonly<{
  algorithmVersion: '1.0.0';
  deterministicOrder: 'CANONICAL_UUID_ASC';
  scope: LeadDistributionScope;
  mode: LeadDistributionInput['mode'];
  balanceBy: 'TOTAL' | 'CATEGORY' | null;
  changes: readonly PlannedLeadAssignment[];
  unchanged: readonly PlannedLeadAssignment[];
  remaining: readonly PlannedLead[];
  totals: LeadDistributionCounts;
  totalsByCategory: Readonly<Record<LeadCategory, LeadDistributionCounts>>;
  recipients: readonly Readonly<{
    workspaceMemberId: string;
    quantities: LeadCategoryQuantities;
    totals: LeadDistributionCounts;
    totalsByCategory: Readonly<Record<LeadCategory, LeadDistributionCounts>>;
  }>[];
}>;
