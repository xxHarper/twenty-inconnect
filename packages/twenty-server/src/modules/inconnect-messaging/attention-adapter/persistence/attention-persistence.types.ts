import { type AttentionTrackingScope } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import {
  type AttentionEvent,
  type AttentionStatus,
  type AttentionTransition,
} from 'src/modules/inconnect-messaging/attention-domain';

// Driver boundary: text, never a JavaScript Date that has already lost precision.
export type AttentionTimestamp = string;

export type AttentionEpochRow = Readonly<{
  id: string;
  workspaceId: string;
  conversationId: string;
  providerConnectionId: string;
  identityVersion: 'attention-domain-v1';
  reducerVersion: 'attention-reducer-v1';
  successPolicy: 'PROPOSED_DELIVERED_OR_READ';
  lifecycle: 'PREPARING' | 'READY' | 'SUSPENDED' | 'CLOSED';
  bootstrapStatus: AttentionStatus;
  bootstrapRevision: string;
  bootstrapPendingAt: AttentionTimestamp | null;
  bootstrapReference: string;
  createdAt: AttentionTimestamp;
  activatedAt: AttentionTimestamp | null;
  closedAt: AttentionTimestamp | null;
}>;

export type AttentionEffectRow = AttentionTrackingScope &
  Readonly<{
    id: string;
    effectKey: string;
    fingerprint: string;
    canonicalReceiptId: string;
    eventKind: AttentionEvent['kind'];
    messageId: string | null;
    responseIntentId: string | null;
    providerStatusEventId: string | null;
    createdAt: AttentionTimestamp;
  }>;

export type AttentionReceiptRow = AttentionTrackingScope &
  Readonly<{
    id: string;
    eventKey: string;
    effectId: string;
    originalAuditId: string;
    createdAt: AttentionTimestamp;
  }>;

export type AttentionResponseIntentRow = AttentionTrackingScope &
  Readonly<{
    id: string;
    intentId: string;
    messageId: string;
    contentFingerprint: string;
    coveredRevision: string;
    provenanceKind: 'HUMAN' | 'AUTOMATION' | 'LEGACY_UNKNOWN';
    actorWorkspaceMemberId: string | null;
    authorityReference: string;
    format: 'FREEFORM' | 'TEMPLATE';
    registeredEffectId: string;
    createdAt: AttentionTimestamp;
  }>;

export type AttentionStoredResult = Readonly<{
  kind: AttentionTransition['kind'];
  reason: AttentionTransition['reason'];
  audit: AttentionTransition['audit'];
}>;

export type AttentionTransitionAuditRow = AttentionTrackingScope &
  Readonly<{
    id: string;
    eventKey: string;
    effectKey: string;
    fingerprint: string;
    result: AttentionStoredResult;
    resultVersion: 1;
    authorityKind: 'HUMAN' | 'BACKEND' | 'PROVIDER';
    authenticationReference: string;
    correlationReference: string | null;
    recordedAt: AttentionTimestamp;
  }>;

// Explicit projections of future/existing columns, not replacement ORM entities.
export type AttentionConversationColumns = Readonly<{
  id: string;
  workspaceId: string;
  providerConnectionId: string;
  attentionTrackingEpochId: string | null;
  attentionStatus: AttentionStatus | null;
  attentionRevision: string | null;
  pendingAt: AttentionTimestamp | null;
}>;

export type AttentionMessageColumns = Readonly<{
  id: string;
  workspaceId: string;
  conversationId: string;
  providerConnectionId: string;
  attentionTrackingEpochId: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  sendMode: 'FREEFORM' | 'TEMPLATE' | null;
  providerMessageId: string | null;
}>;

export type AttentionProviderStatusColumns = Readonly<{
  id: string;
  workspaceId: string;
  messageId: string;
  webhookReceiptId: string | null;
  providerEventKey: string | null;
  originalStatus: string;
  normalizedStatus: NonNullable<
    AttentionTransition['audit']['evidence']
  >['status'];
  appliedToProjection: boolean;
}>;

export type AttentionWebhookColumns = Readonly<{
  id: string;
  workspaceId: string;
  providerConnectionId: string;
  eventKind: string;
}>;

export type AttentionPersistenceError = Readonly<{
  code:
    | 'MISSING_FIELD'
    | 'INVALID_NULL'
    | 'WRONG_TYPE'
    | 'INVALID_UUID'
    | 'INVALID_VALUE'
    | 'INCOMPATIBLE_VERSION'
    | 'INVALID_REVISION'
    | 'SCOPE_MISMATCH'
    | 'INVALID_CAUSAL_REFERENCE'
    | 'INCOMPLETE_DATA'
    | 'IMPOSSIBLE_RESULT'
    | 'CAPACITY_EXCEEDED';
  path: string;
}>;

export type AttentionPersistenceResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; error: AttentionPersistenceError }>;
