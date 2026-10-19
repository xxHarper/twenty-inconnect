// This contract accepts backend-authenticated facts, never public client authority.
export type AttentionScope = Readonly<{
  workspaceId: string;
  conversationId: string;
  providerConnectionId: string;
}>;

// Canonical non-negative decimal string; arithmetic never passes through Number.
export type AttentionRevision = string;

export type AttentionStatus = 'PENDING' | 'ATTENDED';

export type ResponseProvenance =
  | Readonly<{
      kind: 'HUMAN';
      actorWorkspaceMemberId: string;
      authorityReference: string;
    }>
  | Readonly<{
      kind: 'AUTOMATION' | 'LEGACY_UNKNOWN';
      authorityReference: string;
    }>;

export type AttentionResponseIntent = Readonly<{
  intentId: string;
  messageId: string;
  contentFingerprint: string;
  coveredRevision: AttentionRevision;
  provenance: ResponseProvenance;
  format: 'FREEFORM' | 'TEMPLATE';
}>;

export type AttentionProviderEvidence = Readonly<{
  evidenceId: string;
  providerMessageId: string;
  status:
    | 'QUEUED'
    | 'SENDING'
    | 'SENT'
    | 'DELIVERED'
    | 'READ'
    | 'FAILED'
    | 'UNKNOWN';
}>;

// No default: the proposed success rule still needs a business decision.
export type AttentionSuccessPolicy = 'UNDECIDED' | 'PROPOSED_DELIVERED_OR_READ';

type AttentionFact =
  | Readonly<{ kind: 'INBOUND_RECEIVED'; messageId: string }>
  | Readonly<{ kind: 'MESSAGES_READ'; actorWorkspaceMemberId: string }>
  | Readonly<{
      kind: 'MANUAL_ACTION';
      intentId: string;
      actorWorkspaceMemberId: string;
      action: AttentionStatus;
      observedRevision: AttentionRevision;
    }>
  | Readonly<{
      kind: 'RESPONSE_INTENDED';
      intent: AttentionResponseIntent;
    }>
  | Readonly<{
      kind: 'PROVIDER_EVIDENCE';
      intentId: string;
      messageId: string;
      evidence: AttentionProviderEvidence;
    }>;

export type AttentionEvent = AttentionFact &
  Readonly<{
    scope: AttentionScope;
    eventKey: string;
  }>;

export type AttentionReceipt = Readonly<{
  eventKey: string;
  effectKey: string;
  fingerprint: string;
}>;

export type ConversationAttentionState = Readonly<{
  scope: AttentionScope;
  status: AttentionStatus;
  revision: AttentionRevision;
  responseIntents: readonly AttentionResponseIntent[];
  receipts: readonly AttentionReceipt[];
}>;

export type AttentionTransitionReason =
  | 'INBOUND_OPENED'
  | 'MANUAL_PENDING_RENEWED'
  | 'MANUAL_ATTENDED'
  | 'RESPONSE_REGISTERED'
  | 'HUMAN_RESPONSE_CONFIRMED'
  | 'READ_DOES_NOT_ATTEND'
  | 'NON_HUMAN_RESPONSE'
  | 'INSUFFICIENT_PROVIDER_EVIDENCE'
  | 'SUCCESS_POLICY_UNDECIDED'
  | 'REVISION_NOT_CURRENT'
  | 'ALREADY_ATTENDED'
  | 'SAME_EVENT'
  | 'SAME_INTENTION_OR_EVIDENCE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SCOPE_MISMATCH'
  | 'INVALID_REVISION'
  | 'FUTURE_REVISION'
  | 'STALE_MANUAL_ATTENDED'
  | 'STALE_RESPONSE_INTENT'
  | 'RESPONSE_INTENT_NOT_FOUND'
  | 'MESSAGE_IDENTITY_CONFLICT';

export type AttentionTransition = Readonly<{
  kind: 'APPLIED' | 'IGNORED' | 'DUPLICATE' | 'CONFLICT';
  reason: AttentionTransitionReason;
  state: ConversationAttentionState;
  audit: Readonly<{
    scope: AttentionScope;
    eventKey: string;
    effectKey: string;
    eventKind: AttentionEvent['kind'];
    before: Readonly<{ status: AttentionStatus; revision: AttentionRevision }>;
    after: Readonly<{ status: AttentionStatus; revision: AttentionRevision }>;
    attentionChanged: boolean;
    intentId: string | null;
    messageId: string | null;
    actorWorkspaceMemberId: string | null;
    coveredRevision: AttentionRevision | null;
    provenance: ResponseProvenance | null;
    evidence: AttentionProviderEvidence | null;
    successPolicy: AttentionSuccessPolicy;
  }>;
}>;
