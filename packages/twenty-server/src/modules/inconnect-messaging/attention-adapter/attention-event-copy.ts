import { type ScopedAttentionEvent } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';

export const copyAttentionEvent = (
  input: ScopedAttentionEvent,
): ScopedAttentionEvent => {
  const event = input.event;
  const common = { ...event, scope: Object.freeze({ ...event.scope }) };
  const copy =
    event.kind === 'RESPONSE_INTENDED'
      ? {
          ...common,
          kind: event.kind,
          intent: Object.freeze({
            ...event.intent,
            provenance: Object.freeze({ ...event.intent.provenance }),
          }),
        }
      : event.kind === 'PROVIDER_EVIDENCE'
        ? {
            ...common,
            kind: event.kind,
            intentId: event.intentId,
            messageId: event.messageId,
            evidence: Object.freeze({ ...event.evidence }),
          }
        : common;

  return Object.freeze({
    scope: Object.freeze({ ...input.scope }),
    event: Object.freeze(copy),
  });
};
