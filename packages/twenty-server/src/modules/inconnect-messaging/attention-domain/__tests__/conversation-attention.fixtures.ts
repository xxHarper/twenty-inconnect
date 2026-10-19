import {
  type AttentionEvent,
  type AttentionProviderEvidence,
  type AttentionResponseIntent,
  type AttentionStatus,
  type AttentionSuccessPolicy,
  type ConversationAttentionState,
  createConversationAttentionState,
  transitionConversationAttention,
} from 'src/modules/inconnect-messaging/attention-domain';

export const ATTENTION_SCOPE = {
  workspaceId: 'workspace',
  conversationId: 'conversation',
  providerConnectionId: 'connection',
} as const;

export const initialState = () =>
  createConversationAttentionState(ATTENTION_SCOPE);

export const inbound = (
  messageId = 'inbound-a',
): Extract<AttentionEvent, { kind: 'INBOUND_RECEIVED' }> => ({
  scope: ATTENTION_SCOPE,
  eventKey: `inbound:${messageId}`,
  kind: 'INBOUND_RECEIVED',
  messageId,
});

export const response = (
  overrides: Partial<AttentionResponseIntent> = {},
): Extract<AttentionEvent, { kind: 'RESPONSE_INTENDED' }> => ({
  scope: ATTENTION_SCOPE,
  eventKey: `response:${overrides.intentId ?? 'response-a'}`,
  kind: 'RESPONSE_INTENDED',
  intent: {
    intentId: 'response-a',
    messageId: 'outbound-a',
    contentFingerprint: 'content-fingerprint',
    coveredRevision: '1',
    provenance: {
      kind: 'HUMAN',
      actorWorkspaceMemberId: 'human',
      authorityReference: 'authenticated-send',
    },
    format: 'FREEFORM',
    ...overrides,
  },
});

export const evidence = (
  status: AttentionProviderEvidence['status'] = 'DELIVERED',
  overrides: Partial<
    Extract<AttentionEvent, { kind: 'PROVIDER_EVIDENCE' }>
  > = {},
): Extract<AttentionEvent, { kind: 'PROVIDER_EVIDENCE' }> => ({
  scope: ATTENTION_SCOPE,
  eventKey: `callback:${status}`,
  kind: 'PROVIDER_EVIDENCE',
  intentId: 'response-a',
  messageId: 'outbound-a',
  evidence: {
    evidenceId: `provider-event:${status}`,
    providerMessageId: 'provider-message-a',
    status,
  },
  ...overrides,
});

export const manual = (
  action: AttentionStatus,
  observedRevision: string,
  intentId = 'manual-a',
): Extract<AttentionEvent, { kind: 'MANUAL_ACTION' }> => ({
  scope: ATTENTION_SCOPE,
  eventKey: `manual:${intentId}`,
  kind: 'MANUAL_ACTION',
  intentId,
  actorWorkspaceMemberId: 'human',
  action,
  observedRevision,
});

export const apply = (
  state: ConversationAttentionState,
  event: AttentionEvent,
  successPolicy: AttentionSuccessPolicy = 'PROPOSED_DELIVERED_OR_READ',
) => transitionConversationAttention({ state, event, successPolicy });

export const run = (events: readonly AttentionEvent[]) =>
  events.reduce((state, event) => apply(state, event).state, initialState());

export const waitingForResponse = () => run([inbound(), response()]);
