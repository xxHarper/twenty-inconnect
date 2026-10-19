import { transitionConversationAttention } from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionAdapterResult,
  type AttentionLogicalDelta,
  type AttentionProjectionFacts,
  type AttentionProjectionPlan,
  type OriginalAttentionResult,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import {
  approvedAttentionSuccessPolicy,
  validateAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';
import {
  type ProjectedAttentionTransition,
  reconstructAttentionProjection,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-projection';

export type AttentionProjectionEvaluation = Readonly<{
  transition: ProjectedAttentionTransition;
  delta: AttentionLogicalDelta;
  recovered: Readonly<{
    eventResult: OriginalAttentionResult | null;
    effectResult: OriginalAttentionResult | null;
  }> | null;
}>;

export const evaluateAttentionProjection = (
  plan: AttentionProjectionPlan,
  facts: AttentionProjectionFacts,
): AttentionAdapterResult<AttentionProjectionEvaluation> => {
  const projection = reconstructAttentionProjection(plan, facts);

  if (!projection.ok) {
    return projection;
  }

  const transition = transitionConversationAttention({
    state: projection.value,
    event: plan.input.event,
    successPolicy: approvedAttentionSuccessPolicy(),
  });
  const snapshot = validateAttentionSnapshot({
    scope: plan.snapshot.scope,
    status: transition.state.status,
    revision: transition.state.revision,
  });

  if (!snapshot.ok) {
    return snapshot;
  }

  const consumed = transition.kind !== 'CONFLICT';
  const original: OriginalAttentionResult | null = consumed
    ? {
        kind: transition.kind,
        reason: transition.reason,
        audit: transition.audit,
      }
    : null;
  const { scope } = plan.snapshot;
  const { effectKey, fingerprint, eventKey } = plan.identity;
  const event = plan.input.event;

  return {
    ok: true,
    value: {
      transition,
      delta: {
        snapshot: snapshot.value,
        effect:
          original !== null &&
          original.kind !== 'DUPLICATE' &&
          facts.effect === null
            ? {
                scope,
                effectKey,
                fingerprint,
                canonicalEventKey: eventKey,
                original,
              }
            : null,
        receipt:
          original !== null && facts.eventReceipt === null
            ? { scope, eventKey, effectKey, fingerprint, original }
            : null,
        intent:
          event.kind === 'RESPONSE_INTENDED' && transition.kind === 'APPLIED'
            ? { scope, intent: event.intent }
            : null,
      },
      recovered:
        transition.kind === 'DUPLICATE'
          ? {
              eventResult: facts.eventReceipt?.original ?? null,
              effectResult: facts.effect?.original ?? null,
            }
          : null,
    },
  };
};
