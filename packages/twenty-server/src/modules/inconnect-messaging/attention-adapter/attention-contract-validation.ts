import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import {
  type AttentionResponseIntent,
  type AttentionStatus,
  type AttentionSuccessPolicy,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionAdapterError,
  type AttentionAdapterResult,
  type AttentionEffectIdentity,
  type AttentionSnapshot,
  type AttentionTrackingScope,
  type ExactAttentionRevision,
  type ScopedAttentionEvent,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';

export const attentionFailure = (
  code: AttentionAdapterError['code'],
  detail: string,
): { ok: false; error: AttentionAdapterError } => ({
  ok: false,
  error: { code, detail },
});

export const isAttentionIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

export const parseExactAttentionRevision = (
  value: unknown,
): AttentionAdapterResult<ExactAttentionRevision> =>
  typeof value === 'string' &&
  value.trim() === value &&
  /^(0|[1-9][0-9]*)$/.test(value)
    ? { ok: true, value: value as ExactAttentionRevision }
    : attentionFailure('INVALID_REVISION', 'Expected canonical decimal string');

export const attentionScopeKey = (scope: AttentionTrackingScope): string =>
  JSON.stringify([
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
  ]);

export const isAttentionScope = (scope: AttentionTrackingScope): boolean =>
  [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
  ].every(isAttentionIdentifier);

export const validateAttentionSnapshot = (input: {
  scope: AttentionTrackingScope;
  status: AttentionStatus;
  revision: unknown;
}): AttentionAdapterResult<AttentionSnapshot> => {
  if (!isAttentionScope(input.scope)) {
    return attentionFailure('INVALID_IDENTITY', 'Invalid aggregate scope');
  }

  if (!['ATTENDED', 'PENDING'].includes(input.status)) {
    return attentionFailure(
      'INVALID_CONFIGURATION',
      'Invalid attention status',
    );
  }

  const revision = parseExactAttentionRevision(input.revision);

  if (!revision.ok) {
    return revision;
  }

  // Copy before branding: callers cannot mutate the validated scope afterwards.
  return {
    ok: true,
    value: Object.freeze({
      scope: Object.freeze({ ...input.scope }),
      status: input.status,
      revision: revision.value,
    }) as AttentionSnapshot,
  };
};

export const isAttentionIntent = (intent: AttentionResponseIntent): boolean =>
  [
    intent.intentId,
    intent.messageId,
    intent.contentFingerprint,
    intent.provenance.authorityReference,
  ].every(isAttentionIdentifier) &&
  parseExactAttentionRevision(intent.coveredRevision).ok &&
  ['FREEFORM', 'TEMPLATE'].includes(intent.format) &&
  ['HUMAN', 'AUTOMATION', 'LEGACY_UNKNOWN'].includes(intent.provenance.kind) &&
  (intent.provenance.kind !== 'HUMAN' ||
    isAttentionIdentifier(intent.provenance.actorWorkspaceMemberId));

export const identifyAttentionEffect = (
  input: ScopedAttentionEvent,
): AttentionAdapterResult<AttentionEffectIdentity> => {
  const { scope, event } = input;

  if (!isAttentionScope(scope) || !isAttentionIdentifier(event.eventKey)) {
    return attentionFailure('INVALID_IDENTITY', 'Invalid scope or event key');
  }

  if (
    scope.workspaceId !== event.scope.workspaceId ||
    scope.conversationId !== event.scope.conversationId ||
    scope.providerConnectionId !== event.scope.providerConnectionId
  ) {
    return attentionFailure(
      'SCOPE_MISMATCH',
      'Event and envelope scopes differ',
    );
  }

  const identifiers =
    event.kind === 'INBOUND_RECEIVED'
      ? [event.messageId]
      : event.kind === 'MESSAGES_READ'
        ? [event.actorWorkspaceMemberId]
        : event.kind === 'MANUAL_ACTION'
          ? [event.intentId, event.actorWorkspaceMemberId]
          : event.kind === 'PROVIDER_EVIDENCE'
            ? [
                event.intentId,
                event.messageId,
                event.evidence.evidenceId,
                event.evidence.providerMessageId,
              ]
            : [event.intent.intentId];

  if (
    event.kind === 'RESPONSE_INTENDED' &&
    !parseExactAttentionRevision(event.intent.coveredRevision).ok
  ) {
    return attentionFailure('INVALID_REVISION', 'Invalid covered revision');
  }

  if (
    !identifiers.every(isAttentionIdentifier) ||
    (event.kind === 'RESPONSE_INTENDED' && !isAttentionIntent(event.intent))
  ) {
    return attentionFailure(
      'INVALID_IDENTITY',
      'Invalid event identity or intent',
    );
  }

  if (
    event.kind === 'MANUAL_ACTION' &&
    !parseExactAttentionRevision(event.observedRevision).ok
  ) {
    return attentionFailure('INVALID_REVISION', 'Invalid observed revision');
  }

  if (
    (event.kind === 'MANUAL_ACTION' &&
      !['PENDING', 'ATTENDED'].includes(event.action)) ||
    (event.kind === 'PROVIDER_EVIDENCE' &&
      ![
        'QUEUED',
        'SENDING',
        'SENT',
        'DELIVERED',
        'READ',
        'FAILED',
        'UNKNOWN',
      ].includes(event.evidence.status))
  ) {
    return attentionFailure('INVALID_CONFIGURATION', 'Unsupported fact value');
  }

  const identity = getAttentionEventIdentity(event);
  const scopeKey = attentionScopeKey(scope);

  return {
    ok: true,
    value: {
      ...identity,
      eventKey: event.eventKey,
      effectId: JSON.stringify([
        'attention-domain-v1',
        scopeKey,
        identity.effectKey,
      ]),
      receiptId: JSON.stringify([
        'attention-domain-v1',
        scopeKey,
        event.eventKey,
      ]),
      identityVersion: 'attention-domain-v1',
    },
  };
};

// Business-approved rule; the old name belongs only to the unchanged domain API.
export const approvedAttentionSuccessPolicy = (): AttentionSuccessPolicy =>
  'PROPOSED_DELIVERED_OR_READ';
