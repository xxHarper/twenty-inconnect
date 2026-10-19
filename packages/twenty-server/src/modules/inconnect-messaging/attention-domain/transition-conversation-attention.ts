import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import {
  type AttentionEvent,
  type AttentionSuccessPolicy,
  type AttentionTransition,
  type AttentionTransitionReason,
  type ConversationAttentionState,
} from 'src/modules/inconnect-messaging/attention-domain/conversation-attention.types';

const isRevision = (revision: unknown): revision is string =>
  typeof revision === 'string' &&
  revision.trim() === revision &&
  /^(0|[1-9][0-9]*)$/.test(revision);

export const transitionConversationAttention = ({
  state,
  event,
  successPolicy,
}: {
  state: ConversationAttentionState;
  event: AttentionEvent;
  successPolicy: AttentionSuccessPolicy;
}): AttentionTransition => {
  const identity = getAttentionEventIdentity(event);
  const registeredIntent =
    event.kind === 'PROVIDER_EVIDENCE'
      ? state.responseIntents.find(
          (intent) => intent.intentId === event.intentId,
        )
      : event.kind === 'RESPONSE_INTENDED'
        ? event.intent
        : undefined;

  const finish = (
    kind: AttentionTransition['kind'],
    reason: AttentionTransitionReason,
    nextState = state,
  ): AttentionTransition => {
    // Ignored facts and duplicate aliases also need durable deduplication.
    const recordReceipt =
      kind !== 'CONFLICT' &&
      !state.receipts.some((receipt) => receipt.eventKey === event.eventKey);
    const resultState = recordReceipt
      ? {
          ...nextState,
          receipts: [
            ...nextState.receipts,
            { eventKey: event.eventKey, ...identity },
          ],
        }
      : nextState;

    return {
      kind,
      reason,
      state: resultState,
      audit: {
        scope: state.scope,
        eventKey: event.eventKey,
        effectKey: identity.effectKey,
        eventKind: event.kind,
        before: { status: state.status, revision: state.revision },
        after: { status: resultState.status, revision: resultState.revision },
        attentionChanged:
          state.status !== resultState.status ||
          state.revision !== resultState.revision,
        intentId:
          event.kind === 'MANUAL_ACTION' || event.kind === 'PROVIDER_EVIDENCE'
            ? event.intentId
            : (registeredIntent?.intentId ?? null),
        messageId:
          event.kind === 'INBOUND_RECEIVED' ||
          event.kind === 'PROVIDER_EVIDENCE'
            ? event.messageId
            : (registeredIntent?.messageId ?? null),
        actorWorkspaceMemberId:
          event.kind === 'MANUAL_ACTION' || event.kind === 'MESSAGES_READ'
            ? event.actorWorkspaceMemberId
            : registeredIntent?.provenance.kind === 'HUMAN'
              ? registeredIntent.provenance.actorWorkspaceMemberId
              : null,
        coveredRevision:
          event.kind === 'MANUAL_ACTION'
            ? event.observedRevision
            : (registeredIntent?.coveredRevision ?? null),
        provenance: registeredIntent?.provenance ?? null,
        evidence: event.kind === 'PROVIDER_EVIDENCE' ? event.evidence : null,
        successPolicy,
      },
    };
  };

  if (
    state.scope.workspaceId !== event.scope.workspaceId ||
    state.scope.conversationId !== event.scope.conversationId ||
    state.scope.providerConnectionId !== event.scope.providerConnectionId
  ) {
    return finish('CONFLICT', 'SCOPE_MISMATCH');
  }

  if (!isRevision(state.revision)) {
    return finish('CONFLICT', 'INVALID_REVISION');
  }

  const sameEvent = state.receipts.find(
    (receipt) => receipt.eventKey === event.eventKey,
  );
  const sameEffect = state.receipts.find(
    (receipt) => receipt.effectKey === identity.effectKey,
  );

  if (sameEvent !== undefined || sameEffect !== undefined) {
    if (
      (sameEvent !== undefined &&
        (sameEvent.effectKey !== identity.effectKey ||
          sameEvent.fingerprint !== identity.fingerprint)) ||
      (sameEffect !== undefined &&
        sameEffect.fingerprint !== identity.fingerprint)
    ) {
      return finish('CONFLICT', 'IDEMPOTENCY_CONFLICT');
    }

    return finish(
      'DUPLICATE',
      sameEvent !== undefined ? 'SAME_EVENT' : 'SAME_INTENTION_OR_EVIDENCE',
    );
  }

  const referencedRevision =
    event.kind === 'MANUAL_ACTION'
      ? event.observedRevision
      : registeredIntent?.coveredRevision;

  if (event.kind === 'MANUAL_ACTION' || registeredIntent !== undefined) {
    if (!isRevision(referencedRevision)) {
      return finish('CONFLICT', 'INVALID_REVISION');
    }

    if (BigInt(referencedRevision) > BigInt(state.revision)) {
      return finish('CONFLICT', 'FUTURE_REVISION');
    }
  }

  const changeAttention = (
    status: ConversationAttentionState['status'],
    reason: AttentionTransitionReason,
  ) =>
    finish('APPLIED', reason, {
      ...state,
      status,
      revision: (BigInt(state.revision) + BigInt(1)).toString(),
    });

  switch (event.kind) {
    case 'INBOUND_RECEIVED':
      return changeAttention('PENDING', 'INBOUND_OPENED');
    case 'MESSAGES_READ':
      return finish('IGNORED', 'READ_DOES_NOT_ATTEND');
    case 'MANUAL_ACTION':
      // Reopening is safe from an older view; closing must match exactly.
      if (event.action === 'PENDING') {
        return changeAttention('PENDING', 'MANUAL_PENDING_RENEWED');
      }

      if (event.observedRevision !== state.revision) {
        return finish('CONFLICT', 'STALE_MANUAL_ATTENDED');
      }

      return state.status === 'ATTENDED'
        ? finish('IGNORED', 'ALREADY_ATTENDED')
        : changeAttention('ATTENDED', 'MANUAL_ATTENDED');
    case 'RESPONSE_INTENDED':
      if (event.intent.coveredRevision !== state.revision) {
        return finish('CONFLICT', 'STALE_RESPONSE_INTENT');
      }

      if (
        state.responseIntents.some(
          (intent) => intent.messageId === event.intent.messageId,
        )
      ) {
        return finish('CONFLICT', 'MESSAGE_IDENTITY_CONFLICT');
      }

      return finish('APPLIED', 'RESPONSE_REGISTERED', {
        ...state,
        responseIntents: [...state.responseIntents, event.intent],
      });
    case 'PROVIDER_EVIDENCE':
      if (registeredIntent === undefined) {
        // Missing causal data is retryable; do not consume the callback key.
        return finish('CONFLICT', 'RESPONSE_INTENT_NOT_FOUND');
      }

      if (registeredIntent.messageId !== event.messageId) {
        return finish('CONFLICT', 'MESSAGE_IDENTITY_CONFLICT');
      }

      if (registeredIntent.provenance.kind !== 'HUMAN') {
        return finish('IGNORED', 'NON_HUMAN_RESPONSE');
      }

      if (!['DELIVERED', 'READ'].includes(event.evidence.status)) {
        return finish('IGNORED', 'INSUFFICIENT_PROVIDER_EVIDENCE');
      }

      if (successPolicy !== 'PROPOSED_DELIVERED_OR_READ') {
        return finish('IGNORED', 'SUCCESS_POLICY_UNDECIDED');
      }

      if (registeredIntent.coveredRevision !== state.revision) {
        return finish('IGNORED', 'REVISION_NOT_CURRENT');
      }

      return state.status === 'ATTENDED'
        ? finish('IGNORED', 'ALREADY_ATTENDED')
        : changeAttention('ATTENDED', 'HUMAN_RESPONSE_CONFIRMED');
  }
};
