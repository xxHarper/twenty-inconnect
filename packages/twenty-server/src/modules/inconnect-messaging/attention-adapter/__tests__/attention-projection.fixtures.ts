import {
  type AttentionEvent,
  type ConversationAttentionState,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionAdapterResult,
  type AttentionProjectionFacts,
  type AttentionProjectionPlan,
  type AttentionTrackingScope,
  type LogicalAttentionEffect,
  type LogicalAttentionIntent,
  type LogicalAttentionReceipt,
  evaluateAttentionProjection,
  planAttentionProjection,
  validateAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter';
import {
  apply,
  initialState,
} from 'src/modules/inconnect-messaging/attention-domain/__tests__/conversation-attention.fixtures';

export const unwrap = <TValue>(
  result: AttentionAdapterResult<TValue>,
): TValue => {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  return result.value;
};

export const trackingScope: AttentionTrackingScope = {
  ...initialState().scope,
  trackingEpochId: 'epoch-1',
};

// Test-only durable-store model. No production array scan/query implementation.
export const storageKey = (scope: AttentionTrackingScope, key: string) =>
  JSON.stringify([
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
    key,
  ]);

export const createStore = () => ({
  effects: new Map<string, LogicalAttentionEffect>(),
  receipts: new Map<string, LogicalAttentionReceipt>(),
  intents: new Map<string, LogicalAttentionIntent>(),
  messages: new Map<string, LogicalAttentionIntent>(),
});

export const readFacts = (
  store: ReturnType<typeof createStore>,
  plan: AttentionProjectionPlan,
): AttentionProjectionFacts => ({
  eventReceipt:
    store.receipts.get(
      storageKey(plan.snapshot.scope, plan.identity.eventKey),
    ) ?? null,
  effect:
    store.effects.get(
      storageKey(plan.snapshot.scope, plan.identity.effectKey),
    ) ?? null,
  intent:
    plan.intentLookup.kind === 'NONE'
      ? null
      : ((plan.intentLookup.kind === 'INTENT_ID'
          ? store.intents
          : store.messages
        ).get(storageKey(plan.snapshot.scope, plan.intentLookup.value)) ??
        null),
});

// Independent key oracle, deliberately not using getAttentionEventIdentity.
export const expectedEffectKey = (event: AttentionEvent): string => {
  switch (event.kind) {
    case 'INBOUND_RECEIVED':
      return JSON.stringify(['INBOUND', event.messageId]);
    case 'MESSAGES_READ':
      return JSON.stringify(['READ', event.eventKey]);
    case 'MANUAL_ACTION':
      return JSON.stringify([
        'MANUAL',
        event.actorWorkspaceMemberId,
        event.intentId,
      ]);
    case 'RESPONSE_INTENDED':
      return JSON.stringify(['RESPONSE', event.intent.intentId]);
    case 'PROVIDER_EVIDENCE':
      return JSON.stringify([
        'EVIDENCE',
        event.evidence.providerMessageId,
        event.evidence.evidenceId,
      ]);
  }
};

export const createHarness = (
  initial = initialState(),
  scope = trackingScope,
  store = createStore(),
) => {
  let reference: ConversationAttentionState = initial;
  let snapshot = unwrap(validateAttentionSnapshot({ ...initial, scope }));

  const step = (event: AttentionEvent) => {
    const plan = unwrap(planAttentionProjection(snapshot, { scope, event }));
    const facts = readFacts(store, plan);
    const result = unwrap(evaluateAttentionProjection(plan, facts));
    const full = apply(reference, event);
    const { state: projectedState, ...projectedOutcome } = result.transition;
    const { state: fullState, ...fullOutcome } = full;

    expect(projectedOutcome).toEqual(fullOutcome);
    expect(projectedState.status).toEqual(fullState.status);
    expect(projectedState.revision).toEqual(fullState.revision);
    expect(projectedState.scope).toEqual(fullState.scope);
    expect(plan.identity.effectKey).toBe(expectedEffectKey(event));
    expect(projectedState.receipts.length).toBeLessThanOrEqual(3);
    expect(projectedState.responseIntents.length).toBeLessThanOrEqual(2);

    const { delta } = result;
    const newReceipt =
      delta.receipt === null
        ? []
        : [
            {
              eventKey: delta.receipt.eventKey,
              effectKey: delta.receipt.effectKey,
              fingerprint: delta.receipt.fingerprint,
            },
          ];
    const newIntent = delta.intent === null ? [] : [delta.intent.intent];

    // Reinsert the delta into the complete logical state: exact order and facts.
    expect({
      ...reference,
      status: delta.snapshot.status,
      revision: delta.snapshot.revision,
      receipts: [...reference.receipts, ...newReceipt],
      responseIntents: [...reference.responseIntents, ...newIntent],
    }).toEqual(fullState);

    // Independent invariants, not another call to the production projection.
    expect(delta.snapshot.revision).toBe(
      full.audit.attentionChanged
        ? (BigInt(reference.revision) + BigInt(1)).toString()
        : reference.revision,
    );
    if (full.kind === 'CONFLICT') {
      expect(delta).toMatchObject({
        effect: null,
        receipt: null,
        intent: null,
      });
    } else if (
      !reference.receipts.some((receipt) => receipt.eventKey === event.eventKey)
    ) {
      expect(delta.receipt?.eventKey).toBe(event.eventKey);
    }
    if (full.kind === 'DUPLICATE') {
      expect(delta.effect).toBeNull();
      expect(delta.intent).toBeNull();
      expect(full.audit.attentionChanged).toBe(false);
    }
    if (delta.effect !== null) {
      const key = storageKey(scope, delta.effect.effectKey);

      expect(store.effects.has(key)).toBe(false);
      store.effects.set(key, delta.effect);
    }
    if (delta.receipt !== null) {
      const key = storageKey(scope, delta.receipt.eventKey);

      expect(store.receipts.has(key)).toBe(false);
      store.receipts.set(key, delta.receipt);
    }
    if (delta.intent !== null) {
      store.intents.set(
        storageKey(scope, delta.intent.intent.intentId),
        delta.intent,
      );
      store.messages.set(
        storageKey(scope, delta.intent.intent.messageId),
        delta.intent,
      );
    }
    snapshot = delta.snapshot;
    reference = fullState;

    return result;
  };

  return { step, store, state: () => reference, snapshot: () => snapshot };
};

export const permutations = <TValue>(items: readonly TValue[]): TValue[][] =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, other) => other !== index)).map(
          (tail) => [item, ...tail],
        ),
      );
