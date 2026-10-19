import {
  type ConversationAttentionState,
  transitionConversationAttention,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionAdapterResult,
  type AttentionProjectionFacts,
  type AttentionProjectionPlan,
  type AttentionSnapshot,
  type ScopedAttentionEvent,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { copyAttentionEvent } from 'src/modules/inconnect-messaging/attention-adapter/attention-event-copy';
import { originalAttentionResultKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-original-result';
import {
  attentionFailure,
  attentionScopeKey,
  identifyAttentionEffect,
  isAttentionIntent,
  parseExactAttentionRevision,
  validateAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';

export const planAttentionProjection = (
  snapshot: AttentionSnapshot,
  input: ScopedAttentionEvent,
): AttentionAdapterResult<AttentionProjectionPlan> => {
  const checkedSnapshot = validateAttentionSnapshot(snapshot);

  if (!checkedSnapshot.ok) {
    return checkedSnapshot;
  }

  const identity = identifyAttentionEffect(input);

  if (!identity.ok) {
    return identity;
  }

  if (attentionScopeKey(snapshot.scope) !== attentionScopeKey(input.scope)) {
    return attentionFailure(
      'SCOPE_MISMATCH',
      'Snapshot and event scopes differ',
    );
  }

  const event = input.event;

  return {
    ok: true,
    value: {
      snapshot: checkedSnapshot.value,
      input: copyAttentionEvent(input),
      identity: Object.freeze(identity.value),
      intentLookup:
        event.kind === 'PROVIDER_EVIDENCE'
          ? { kind: 'INTENT_ID', value: event.intentId }
          : event.kind === 'RESPONSE_INTENDED'
            ? { kind: 'MESSAGE_ID', value: event.intent.messageId }
            : { kind: 'NONE' },
    },
  };
};

export const reconstructAttentionProjection = (
  plan: AttentionProjectionPlan,
  facts: AttentionProjectionFacts,
): AttentionAdapterResult<ConversationAttentionState> => {
  const { snapshot, identity, intentLookup } = plan;
  const { effect, eventReceipt, intent } = facts;

  for (const fact of [effect, eventReceipt, intent]) {
    if (
      fact !== null &&
      attentionScopeKey(fact.scope) !== attentionScopeKey(snapshot.scope)
    ) {
      return attentionFailure(
        'SCOPE_MISMATCH',
        'Lookup returned another scope',
      );
    }
  }

  if (
    (effect !== null && effect.effectKey !== identity.effectKey) ||
    (eventReceipt !== null && eventReceipt.eventKey !== identity.eventKey) ||
    (intent !== null &&
      (!isAttentionIntent(intent.intent) ||
        BigInt(intent.intent.coveredRevision) > BigInt(snapshot.revision) ||
        intentLookup.kind === 'NONE' ||
        (intentLookup.kind === 'INTENT_ID' &&
          intent.intent.intentId !== intentLookup.value) ||
        (intentLookup.kind === 'MESSAGE_ID' &&
          intent.intent.messageId !== intentLookup.value)))
  ) {
    return attentionFailure(
      'INVALID_LEDGER',
      'Lookup returned unrelated facts',
    );
  }

  for (const record of [effect, eventReceipt]) {
    if (record === null) {
      continue;
    }

    const { original } = record;
    const eventKey =
      'canonicalEventKey' in record
        ? record.canonicalEventKey
        : record.eventKey;
    const audit = original.audit;

    if (
      audit.eventKey !== eventKey ||
      audit.effectKey !== record.effectKey ||
      audit.scope.workspaceId !== snapshot.scope.workspaceId ||
      audit.scope.conversationId !== snapshot.scope.conversationId ||
      audit.scope.providerConnectionId !==
        snapshot.scope.providerConnectionId ||
      !parseExactAttentionRevision(audit.before.revision).ok ||
      !parseExactAttentionRevision(audit.after.revision).ok ||
      BigInt(audit.after.revision) > BigInt(snapshot.revision) ||
      !['APPLIED', 'IGNORED', 'DUPLICATE'].includes(original.kind) ||
      !['PENDING', 'ATTENDED'].includes(audit.before.status) ||
      !['PENDING', 'ATTENDED'].includes(audit.after.status) ||
      audit.attentionChanged !==
        (audit.before.status !== audit.after.status ||
          audit.before.revision !== audit.after.revision) ||
      BigInt(audit.after.revision) !==
        BigInt(audit.before.revision) +
          BigInt(audit.attentionChanged ? 1 : 0) ||
      (original.kind !== 'APPLIED' && audit.attentionChanged) ||
      ('canonicalEventKey' in record && original.kind === 'DUPLICATE')
    ) {
      return attentionFailure('INVALID_LEDGER', 'Invalid original result');
    }
  }

  if (
    eventReceipt !== null &&
    eventReceipt.effectKey === identity.effectKey &&
    (effect === null || eventReceipt.fingerprint !== effect.fingerprint)
  ) {
    return attentionFailure(
      'INVALID_LEDGER',
      'Receipt has no consistent effect',
    );
  }

  if (
    effect !== null &&
    eventReceipt !== null &&
    effect.canonicalEventKey === eventReceipt.eventKey &&
    (effect.effectKey !== eventReceipt.effectKey ||
      originalAttentionResultKey(effect.original) !==
        originalAttentionResultKey(eventReceipt.original))
  ) {
    return attentionFailure('INVALID_LEDGER', 'Canonical receipt differs');
  }

  const receipts =
    effect === null
      ? []
      : [
          {
            eventKey: effect.canonicalEventKey,
            effectKey: effect.effectKey,
            fingerprint: effect.fingerprint,
          },
        ];

  if (
    eventReceipt !== null &&
    !receipts.some((receipt) => receipt.eventKey === eventReceipt.eventKey)
  ) {
    receipts.push({
      eventKey: eventReceipt.eventKey,
      effectKey: eventReceipt.effectKey,
      fingerprint: eventReceipt.fingerprint,
    });
  }

  const { workspaceId, conversationId, providerConnectionId } = snapshot.scope;

  return {
    ok: true,
    value: {
      scope: { workspaceId, conversationId, providerConnectionId },
      status: snapshot.status,
      revision: snapshot.revision,
      responseIntents: intent === null ? [] : [intent.intent],
      receipts,
    },
  };
};

// Type alias keeps consumers tied to the accepted reducer, not a second reducer.
export type ProjectedAttentionTransition = ReturnType<
  typeof transitionConversationAttention
>;
