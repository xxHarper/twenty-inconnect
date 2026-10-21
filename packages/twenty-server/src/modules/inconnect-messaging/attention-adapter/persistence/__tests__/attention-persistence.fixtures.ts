import {
  type AttentionEvent,
  type AttentionResponseIntent,
  type ConversationAttentionState,
  createConversationAttentionState,
  transitionConversationAttention,
} from 'src/modules/inconnect-messaging/attention-domain';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import {
  type AttentionEffectRow,
  type AttentionEpochRow,
  type AttentionMessageColumns,
  type AttentionPersistenceResult,
  type AttentionProviderStatusColumns,
  type AttentionReceiptRow,
  type AttentionResponseIntentRow,
  type AttentionTransitionAuditRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence';

export const identifier = (value: number) =>
  `00000000-0000-0000-0000-${value.toString().padStart(12, '0')}`;
export const scope = {
  workspaceId: identifier(1),
  conversationId: identifier(2),
  providerConnectionId: identifier(3),
  trackingEpochId: identifier(4),
};
export const timestamp = '2026-10-21 12:34:56.123456+00';
export const epoch: AttentionEpochRow = {
  id: scope.trackingEpochId,
  workspaceId: scope.workspaceId,
  conversationId: scope.conversationId,
  providerConnectionId: scope.providerConnectionId,
  identityVersion: 'attention-domain-v1',
  reducerVersion: 'attention-reducer-v1',
  successPolicy: 'PROPOSED_DELIVERED_OR_READ',
  lifecycle: 'READY',
  bootstrapStatus: 'ATTENDED',
  bootstrapRevision: '0',
  bootstrapPendingAt: null,
  bootstrapReference: 'authorized-bootstrap',
  createdAt: timestamp,
  activatedAt: timestamp,
  closedAt: null,
};
export const initial = () =>
  createConversationAttentionState({
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId,
    providerConnectionId: scope.providerConnectionId,
  });
export const pending = (revision = '1'): ConversationAttentionState => ({
  ...initial(),
  status: 'PENDING',
  revision,
});
export const inbound = (): AttentionEvent => ({
  kind: 'INBOUND_RECEIVED',
  scope,
  eventKey: 'inbound-event',
  messageId: identifier(10),
});
export const intent = (
  overrides: Partial<AttentionResponseIntent> = {},
): AttentionResponseIntent => ({
  intentId: 'response-intent',
  messageId: identifier(11),
  coveredRevision: '1',
  contentFingerprint: 'content-hash',
  provenance: {
    kind: 'HUMAN',
    actorWorkspaceMemberId: identifier(12),
    authorityReference: 'authorized-send',
  },
  format: 'TEMPLATE',
  ...overrides,
});
export const response = (responseIntent = intent()): AttentionEvent => ({
  kind: 'RESPONSE_INTENDED',
  scope,
  eventKey: 'response-event',
  intent: responseIntent,
});
export const evidence = (
  status: 'DELIVERED' | 'READ' | 'SENT' | 'FAILED' | 'UNKNOWN' = 'DELIVERED',
): AttentionEvent => ({
  kind: 'PROVIDER_EVIDENCE',
  scope,
  eventKey: `evidence:${status}`,
  intentId: 'response-intent',
  messageId: identifier(11),
  evidence: {
    evidenceId: 'provider-evidence',
    providerMessageId: 'provider-message',
    status,
  },
});
export const apply = (
  state: ConversationAttentionState,
  event: AttentionEvent,
) =>
  transitionConversationAttention({
    state,
    event,
    successPolicy: 'PROPOSED_DELIVERED_OR_READ',
  });
export const unwrap = <TValue>(
  result: AttentionPersistenceResult<TValue>,
): TValue => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

// Fixture builder only: materializes a single real reducer result as C2 rows.
// It implements no SQL, durable store, transaction or constraint simulation.
export const physicalRows = (
  event: AttentionEvent = inbound(),
  before = initial(),
) => {
  const transition = apply(before, event);
  const identity = getAttentionEventIdentity(event);
  const { state: _state, ...result } = transition;
  const registeredIntent =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent
      : before.responseIntents[0];
  const audit: AttentionTransitionAuditRow = {
    ...scope,
    id: identifier(30),
    eventKey: event.eventKey,
    ...identity,
    result,
    resultVersion: 1,
    authorityKind:
      event.kind === 'PROVIDER_EVIDENCE'
        ? 'PROVIDER'
        : ['MESSAGES_READ', 'MANUAL_ACTION'].includes(event.kind) ||
            (event.kind === 'RESPONSE_INTENDED' &&
              registeredIntent?.provenance.kind === 'HUMAN')
          ? 'HUMAN'
          : 'BACKEND',
    authenticationReference: 'verified-entry',
    correlationReference:
      event.kind === 'PROVIDER_EVIDENCE' ? 'verified-correlation' : null,
    recordedAt: timestamp,
  };
  const effect: AttentionEffectRow = {
    ...scope,
    id: identifier(20),
    ...identity,
    canonicalReceiptId: identifier(21),
    eventKind: event.kind,
    messageId: transition.audit.messageId,
    responseIntentId: ['RESPONSE_INTENDED', 'PROVIDER_EVIDENCE'].includes(
      event.kind,
    )
      ? transition.audit.intentId
      : null,
    providerStatusEventId:
      event.kind === 'PROVIDER_EVIDENCE' ? identifier(25) : null,
    createdAt: timestamp,
  };
  const canonicalReceipt: AttentionReceiptRow = {
    ...scope,
    id: identifier(21),
    eventKey: event.eventKey,
    effectId: effect.id,
    originalAuditId: audit.id,
    createdAt: timestamp,
  };
  const intentRow: AttentionResponseIntentRow | undefined =
    registeredIntent === undefined
      ? undefined
      : {
          ...scope,
          id: identifier(22),
          intentId: registeredIntent.intentId,
          messageId: registeredIntent.messageId,
          coveredRevision: registeredIntent.coveredRevision,
          contentFingerprint: registeredIntent.contentFingerprint,
          provenanceKind: registeredIntent.provenance.kind,
          authorityReference: registeredIntent.provenance.authorityReference,
          actorWorkspaceMemberId:
            registeredIntent.provenance.kind === 'HUMAN'
              ? registeredIntent.provenance.actorWorkspaceMemberId
              : null,
          format: registeredIntent.format,
          registeredEffectId:
            event.kind === 'RESPONSE_INTENDED' ? effect.id : identifier(26),
          createdAt: timestamp,
        };
  const message: AttentionMessageColumns | undefined =
    effect.messageId === null
      ? undefined
      : {
          id: effect.messageId,
          workspaceId: scope.workspaceId,
          conversationId: scope.conversationId,
          providerConnectionId: scope.providerConnectionId,
          attentionTrackingEpochId: scope.trackingEpochId,
          direction: event.kind === 'INBOUND_RECEIVED' ? 'INBOUND' : 'OUTBOUND',
          sendMode:
            event.kind === 'INBOUND_RECEIVED'
              ? null
              : (registeredIntent?.format ?? 'FREEFORM'),
          providerMessageId: 'provider-message',
        };
  const providerStatus: AttentionProviderStatusColumns | undefined =
    event.kind !== 'PROVIDER_EVIDENCE'
      ? undefined
      : {
          id: identifier(25),
          workspaceId: scope.workspaceId,
          messageId: event.messageId,
          webhookReceiptId: identifier(27),
          providerEventKey: 'transport-idempotency',
          originalStatus: event.evidence.status,
          normalizedStatus: event.evidence.status,
          appliedToProjection: true,
        };
  return {
    epoch,
    effect,
    canonicalReceipt,
    canonicalAudit: audit,
    message,
    intent: intentRow,
    providerStatus,
    webhook: {
      id: identifier(27),
      workspaceId: scope.workspaceId,
      providerConnectionId: scope.providerConnectionId,
      eventKind: 'STATUS_CALLBACK',
    },
    transition,
  };
};

export const aliasRows = () => {
  const rows = physicalRows();
  const aliasEvent = { ...inbound(), eventKey: 'alias-event' };
  const duplicate = apply(rows.transition.state, aliasEvent);
  const { state: _state, ...result } = duplicate;
  const originalAudit = {
    ...rows.canonicalAudit,
    id: identifier(32),
    eventKey: aliasEvent.eventKey,
    result,
  };
  const receipt = {
    ...rows.canonicalReceipt,
    id: identifier(31),
    eventKey: aliasEvent.eventKey,
    originalAuditId: originalAudit.id,
  };
  return { ...rows, receipt, originalAudit, aliasEvent };
};
