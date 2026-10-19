import { type AttentionEvent } from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionProjectionFacts,
  evaluateAttentionProjection,
  planAttentionProjection,
  reconstructAttentionProjection,
} from 'src/modules/inconnect-messaging/attention-adapter';
import {
  ATTENTION_SCOPE,
  evidence,
  inbound,
  initialState,
  manual,
  response,
} from 'src/modules/inconnect-messaging/attention-domain/__tests__/conversation-attention.fixtures';
import {
  createHarness,
  createStore,
  permutations,
  readFacts,
  storageKey,
  trackingScope,
  unwrap,
} from 'src/modules/inconnect-messaging/attention-adapter/__tests__/attention-projection.fixtures';

const alias = (
  event: AttentionEvent,
  eventKey = `alias:${event.eventKey}`,
): AttentionEvent => ({ ...event, eventKey });

describe('bounded ledger equivalence with the accepted complete ledger reducer', () => {
  it('should recover the effect result and each alias original separately after later work', () => {
    const harness = createHarness();
    const first = harness.step(inbound());
    const duplicate = harness.step(alias(inbound()));

    harness.step(inbound('later'));
    const exact = harness.step(inbound());
    const repeatedAlias = harness.step(alias(inbound()));

    expect(first.transition.kind).toBe('APPLIED');
    expect(duplicate.transition.reason).toBe('SAME_INTENTION_OR_EVIDENCE');
    expect(duplicate.recovered?.eventResult).toBeNull();
    expect(duplicate.recovered?.effectResult).toMatchObject({
      kind: 'APPLIED',
      audit: { after: { revision: '1' } },
    });
    expect(exact.recovered?.eventResult).toEqual(
      duplicate.recovered?.effectResult,
    );
    expect(repeatedAlias.recovered?.eventResult).toMatchObject({
      kind: 'DUPLICATE',
      reason: 'SAME_INTENTION_OR_EVIDENCE',
      audit: { after: { revision: '1' } },
    });
    expect(repeatedAlias.transition.state.revision).toBe('2');
    expect(
      harness.step({
        ...inbound('contradiction'),
        eventKey: alias(inbound()).eventKey,
      }).transition.reason,
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('should leave missing-cause conflicts unconsumed and allow a later retry', () => {
    const harness = createHarness();

    harness.step(inbound());
    expect(harness.step(evidence()).transition.reason).toBe(
      'RESPONSE_INTENT_NOT_FOUND',
    );
    expect(harness.store.receipts.size).toBe(1);
    harness.step(response());
    expect(harness.step(evidence()).transition.reason).toBe(
      'HUMAN_RESPONSE_CONFIRMED',
    );
    expect(harness.step(evidence()).transition.kind).toBe('DUPLICATE');
  });

  it('should retain ignored evidence and reject contradictions before coverage checks', () => {
    const harness = createHarness();

    harness.step(inbound());
    harness.step(response());
    const ignored = harness.step(evidence('SENT'));

    harness.step(inbound('later'));
    expect(
      harness.step(alias(evidence('SENT'))).recovered?.effectResult?.kind,
    ).toBe('IGNORED');
    expect(harness.step(evidence('READ')).transition.reason).toBe(
      'REVISION_NOT_CURRENT',
    );
    expect(harness.step(alias(response())).transition.kind).toBe('DUPLICATE');
    expect(
      harness.step(alias(response({ coveredRevision: '2' }))).transition.reason,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(ignored.transition.state.revision).toBe('1');
  });

  it('should resolve both event and effect lookups when they name different histories', () => {
    const harness = createHarness();

    harness.step(inbound('a'));
    harness.step(inbound('b'));
    const event = { ...inbound('b'), eventKey: inbound('a').eventKey };
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event,
      }),
    );
    const projection = unwrap(
      reconstructAttentionProjection(plan, readFacts(harness.store, plan)),
    );

    expect(projection.receipts).toHaveLength(2);
    expect(harness.step(event).transition.reason).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('should detect response Message reuse without loading unrelated intentions', () => {
    const harness = createHarness();

    harness.step(inbound());
    harness.step(response());
    expect(
      harness.step(response({ intentId: 'second' })).transition.reason,
    ).toBe('MESSAGE_IDENTITY_CONFLICT');
    expect(
      harness.step(response({ intentId: 'second', messageId: 'outbound-b' }))
        .transition.kind,
    ).toBe('APPLIED');
    expect(
      harness.step(evidence('READ', { messageId: 'outbound-b' })).transition
        .reason,
    ).toBe('MESSAGE_IDENTITY_CONFLICT');
    expect(harness.step(evidence('READ')).transition.reason).toBe(
      'HUMAN_RESPONSE_CONFIRMED',
    );
  });

  it.each(['FREEFORM', 'TEMPLATE'] as const)(
    'should close only a HUMAN %s with approved correlated success',
    (format) => {
      for (const status of ['DELIVERED', 'READ'] as const) {
        const harness = createHarness();

        harness.step(inbound());
        harness.step(response({ format }));
        expect(harness.step(evidence(status)).transition).toMatchObject({
          kind: 'APPLIED',
          state: { status: 'ATTENDED', revision: '2' },
        });
      }
    },
  );

  it.each(['AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should never close %s TEMPLATE',
    (kind) => {
      const harness = createHarness();

      harness.step(inbound());
      harness.step(
        response({
          format: 'TEMPLATE',
          provenance: { kind, authorityReference: 'backend' },
        }),
      );
      expect(harness.step(evidence()).transition).toMatchObject({
        kind: 'IGNORED',
        reason: 'NON_HUMAN_RESPONSE',
        state: { status: 'PENDING' },
      });
    },
  );

  it.each(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'] as const)(
    'should never close from %s',
    (status) => {
      const harness = createHarness();

      harness.step(inbound());
      harness.step(response());
      expect(harness.step(evidence(status)).transition.state.status).toBe(
        'PENDING',
      );
      expect(harness.step(alias(evidence(status))).transition.kind).toBe(
        'DUPLICATE',
      );
    },
  );

  it('should keep provider READ separate from personal reading', () => {
    const harness = createHarness();
    const read: AttentionEvent = {
      scope: ATTENTION_SCOPE,
      eventKey: 'read-personal',
      kind: 'MESSAGES_READ',
      actorWorkspaceMemberId: 'human',
    };

    harness.step(inbound());
    expect(harness.step(read).transition.reason).toBe('READ_DOES_NOT_ATTEND');
    expect(harness.step(alias(read)).transition.kind).toBe('IGNORED');
    expect(harness.step(read).transition.kind).toBe('DUPLICATE');
  });

  it('should preserve exact large revisions and retry unconsumed future keys', () => {
    const harness = createHarness({
      ...initialState(),
      revision: '900719925474099300000',
    });

    expect(
      harness.step(manual('PENDING', '900719925474099300001')).transition
        .reason,
    ).toBe('FUTURE_REVISION');
    harness.step(inbound());
    expect(
      harness.step(manual('PENDING', '900719925474099300001')).transition.kind,
    ).toBe('APPLIED');
    harness.step(response({ coveredRevision: '900719925474099300002' }));
    expect(harness.step(evidence()).transition.state.revision).toBe(
      '900719925474099300003',
    );
  });

  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ] as const)('should isolate identical logical keys across %s', (field) => {
    const store = createStore();
    const otherScope = { ...trackingScope, [field]: 'other' };
    const otherDomainScope = {
      workspaceId: otherScope.workspaceId,
      conversationId: otherScope.conversationId,
      providerConnectionId: otherScope.providerConnectionId,
    };
    const first = createHarness(initialState(), trackingScope, store);
    const second = createHarness(
      { ...initialState(), scope: otherDomainScope },
      otherScope,
      store,
    );

    first.step(inbound());
    expect(
      second.step({ ...inbound(), scope: otherDomainScope }).transition.kind,
    ).toBe('APPLIED');
    expect(store.effects.size).toBe(2);
    const plan = unwrap(
      planAttentionProjection(first.snapshot(), {
        scope: trackingScope,
        event: inbound(),
      }),
    );
    const foreign = store.effects.get(
      storageKey(otherScope, plan.identity.effectKey),
    )!;

    expect(
      evaluateAttentionProjection(plan, {
        ...readFacts(store, plan),
        effect: foreign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCOPE_MISMATCH' },
    });
  });

  it('should preserve later inbound work through all 120 callback orders and alias retries', () => {
    let histories = 0;

    for (const events of permutations([
      inbound('b'),
      evidence('DELIVERED'),
      evidence('READ'),
      evidence('SENT'),
      evidence('UNKNOWN'),
    ])) {
      const harness = createHarness();
      let laterSeen = false;

      harness.step(inbound());
      harness.step(response());
      for (const event of events) {
        harness.step(event);
        harness.step(alias(event));
        laterSeen ||= event.kind === 'INBOUND_RECEIVED';
        if (laterSeen) {
          expect(harness.state().status).toBe('PENDING');
        }
      }
      histories += 1;
    }
    expect(histories).toBe(120);
  });

  it('should match through every short adversarial history including collisions and repeats', () => {
    const events = [
      inbound(),
      inbound('b'),
      alias(inbound()),
      { ...inbound('b'), eventKey: inbound().eventKey },
      response(),
      response({ intentId: 'second' }),
      evidence(),
      evidence('FAILED'),
      manual('PENDING', '0'),
      manual('ATTENDED', '1'),
    ];
    let transitions = 0;

    for (const first of events) {
      for (const second of events) {
        for (const third of events) {
          const harness = createHarness();

          harness.step(first);
          harness.step(second);
          const original = harness.step(third);

          transitions += 3;
          const last = harness.step(third);

          expect(last.transition.kind).toBe(
            original.transition.kind === 'CONFLICT' ? 'CONFLICT' : 'DUPLICATE',
          );
          if (original.transition.kind === 'CONFLICT') {
            expect(last.transition.reason).toBe(original.transition.reason);
          } else {
            expect(last.transition.reason).toBe('SAME_EVENT');
          }
        }
      }
    }
    expect(transitions).toBe(3000);
  });

  it('should keep point reads and reducer input bounded after a long ledger history', () => {
    const harness = createHarness();

    for (let index = 0; index < 200; index += 1) {
      harness.step(inbound(`inbound-${index}`));
      harness.step(
        response({
          intentId: `intent-${index}`,
          messageId: `message-${index}`,
          coveredRevision: String(index + 1),
        }),
      );
    }
    const event = alias(inbound('inbound-0'));
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event,
      }),
    );
    const facts = readFacts(harness.store, plan);
    const projection = unwrap(reconstructAttentionProjection(plan, facts));

    expect(harness.state().receipts).toHaveLength(400);
    expect(harness.state().responseIntents).toHaveLength(200);
    expect(Object.values(facts).filter((fact) => fact !== null)).toHaveLength(
      1,
    );
    expect(projection.receipts).toHaveLength(1);
    expect(projection.responseIntents).toHaveLength(0);
    expect(harness.step(event).transition.kind).toBe('DUPLICATE');
  });

  it('should leave frozen inputs untouched', () => {
    const harness = createHarness();

    harness.step(inbound());
    harness.step(response());
    const event = evidence();
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event,
      }),
    );
    const facts = readFacts(harness.store, plan);
    const freeze = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    const before = JSON.stringify({ plan, facts });

    freeze(plan);
    freeze(facts);
    expect(evaluateAttentionProjection(plan, facts)).toEqual(
      evaluateAttentionProjection(plan, facts),
    );
    expect(JSON.stringify({ plan, facts })).toBe(before);
  });

  it('should reject a missing effect, wrong intent index, or wrong receipt lookup', () => {
    const harness = createHarness();

    harness.step(inbound());
    harness.step(response());
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event: response(),
      }),
    );
    const facts = readFacts(harness.store, plan);
    const corruptions: AttentionProjectionFacts[] = [
      { ...facts, effect: null },
      {
        ...facts,
        intent: {
          scope: trackingScope,
          intent: response({ messageId: 'unrelated' }).intent,
        },
      },
      {
        ...facts,
        eventReceipt: { ...facts.eventReceipt!, eventKey: 'unrelated' },
      },
    ];

    for (const corrupted of corruptions) {
      expect(evaluateAttentionProjection(plan, corrupted)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_LEDGER' },
      });
    }
  });
});
