import {
  type AttentionEvent,
  type AttentionProviderEvidence,
  type AttentionResponseIntent,
  type AttentionScope,
  type AttentionStatus,
  type AttentionTransition,
  type ResponseProvenance,
} from 'src/modules/inconnect-messaging/attention-domain';

export type ExactAttentionRevision = string & {
  readonly __exactAttentionRevision: 'ExactAttentionRevision';
};

// Epoch is mandatory here: no implicit legacy/current epoch or cross-epoch replay.
export type AttentionTrackingScope = AttentionScope &
  Readonly<{ trackingEpochId: string }>;

export type AttentionSnapshot = Readonly<{
  scope: AttentionTrackingScope;
  status: AttentionStatus;
  revision: ExactAttentionRevision;
  readonly __validatedAttentionSnapshot: 'ValidatedAttentionSnapshot';
}>;

export type AttentionAdapterError = Readonly<{
  code:
    | 'INVALID_IDENTITY'
    | 'SCOPE_MISMATCH'
    | 'AUTHORITY_REQUIRED'
    | 'IDEMPOTENCY_COLLISION'
    | 'INVALID_REVISION'
    | 'NOT_READY'
    | 'INVALID_CONFIGURATION'
    | 'INVALID_LEDGER';
  detail: string;
}>;

export type AttentionAdapterResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; error: AttentionAdapterError }>;

export type ScopedAttentionEvent = Readonly<{
  scope: AttentionTrackingScope;
  event: AttentionEvent;
}>;

export type AttentionEffectIdentity = Readonly<{
  // Versioned, scoped, ordered JSON tuples. Fingerprint retains domain v1 bytes.
  effectId: string;
  receiptId: string;
  effectKey: string;
  eventKey: string;
  fingerprint: string;
  identityVersion: 'attention-domain-v1';
}>;

// Historical response, never a replacement for the current aggregate state.
// No complete ledger arrays: storage per receipt/effect remains constant size.
export type OriginalAttentionResult = Readonly<{
  kind: Exclude<AttentionTransition['kind'], 'CONFLICT'>;
  reason: AttentionTransition['reason'];
  audit: AttentionTransition['audit'];
}>;

export type LogicalAttentionEffect = Readonly<{
  scope: AttentionTrackingScope;
  effectKey: string;
  fingerprint: string;
  canonicalEventKey: string;
  original: OriginalAttentionResult;
}>;

export type LogicalAttentionReceipt = Readonly<{
  scope: AttentionTrackingScope;
  eventKey: string;
  effectKey: string;
  fingerprint: string;
  // An alias retains its own first DUPLICATE result, not the effect's APPLIED.
  original: OriginalAttentionResult;
}>;

export type LogicalAttentionIntent = Readonly<{
  scope: AttentionTrackingScope;
  intent: AttentionResponseIntent;
}>;

export type AttentionProjectionPlan = Readonly<{
  snapshot: AttentionSnapshot;
  input: ScopedAttentionEvent;
  identity: AttentionEffectIdentity;
  intentLookup:
    | Readonly<{ kind: 'NONE' }>
    | Readonly<{ kind: 'INTENT_ID'; value: string }>
    | Readonly<{ kind: 'MESSAGE_ID'; value: string }>;
}>;

// Each slot is one completed point lookup (null is authoritative absence).
// This contract cannot prove query completeness or authorize a database read.
export type AttentionProjectionFacts = Readonly<{
  eventReceipt: LogicalAttentionReceipt | null;
  effect: LogicalAttentionEffect | null;
  intent: LogicalAttentionIntent | null;
}>;

export type AttentionLogicalDelta = Readonly<{
  snapshot: AttentionSnapshot;
  effect: LogicalAttentionEffect | null;
  receipt: LogicalAttentionReceipt | null;
  intent: LogicalAttentionIntent | null;
}>;

// Future boundary only. No constructor here authenticates these claims.
// Consumers must reauthorize and validate against backend authority in transaction.
export type AuthenticatedAttentionFact = Readonly<{
  input: ScopedAttentionEvent;
  authority:
    | Readonly<{
        kind: 'HUMAN';
        actorWorkspaceMemberId: string;
        authorizationReference: string;
      }>
    | Readonly<{
        kind: 'BACKEND';
        operationReference: string;
      }>
    | Readonly<{
        kind: 'PROVIDER';
        authenticationReference: string;
        correlation: Readonly<{
          messageId: string;
          intentId: string;
          providerMessageId: string;
          providerConnectionId: string;
        }>;
      }>;
}>;

export type UntrustedAttentionInput = Readonly<{
  source: 'CLIENT' | 'WEBHOOK';
  payload: unknown;
}>;

export type DurableResponseIntention = Readonly<{
  scope: AttentionTrackingScope;
  intentId: string;
  messageId: string;
  contentFingerprint: string;
  coveredRevision: ExactAttentionRevision;
  provenance: ResponseProvenance;
  format: 'FREEFORM' | 'TEMPLATE';
}>;

export type AuthenticatedProviderAttentionEvidence = Readonly<{
  scope: AttentionTrackingScope;
  authenticationReference: string;
  correlationReference: string;
  intentId: string;
  messageId: string;
  evidence: AttentionProviderEvidence;
  // ACCEPTED is not sufficient evidence; future normalization must retain it.
  providerStatus: AttentionProviderEvidence['status'] | 'ACCEPTED';
}>;
