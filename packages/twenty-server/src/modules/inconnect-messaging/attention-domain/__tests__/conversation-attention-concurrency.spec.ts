import {
  type AttentionEvent,
  type AttentionProviderEvidence,
  type ConversationAttentionState,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  apply,
  evidence,
  inbound,
  initialState,
  manual,
  response,
  run,
  waitingForResponse,
} from 'src/modules/inconnect-messaging/attention-domain/__tests__/conversation-attention.fixtures';

const permutations = <TData>(items: readonly TData[]): TData[][] =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, otherIndex) => index !== otherIndex)).map(
          (rest) => [item, ...rest],
        ),
      );

describe('conversation attention logical concurrency', () => {
  it('should preserve inbound B when confirmation of response to A arrives late', () => {
    const state = run([inbound(), response(), inbound('inbound-b')]);
    const confirmation = apply(state, evidence());

    expect(confirmation).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { status: 'PENDING', revision: '2' },
    });
  });

  it('should reopen when inbound B follows a confirmed response to A', () => {
    const state = run([inbound(), response(), evidence()]);

    expect(state).toMatchObject({ status: 'ATTENDED', revision: '2' });
    expect(apply(state, inbound('inbound-b')).state).toMatchObject({
      status: 'PENDING',
      revision: '3',
    });
  });

  it.each(permutations([evidence(), manual('PENDING', '1')]))(
    'should preserve a new manual pending intent in either serialization %#',
    (...events) => {
      const state = events.reduce(
        (current, event) => apply(current, event).state,
        waitingForResponse(),
      );

      expect(state.status).toBe('PENDING');
      expect(apply(state, evidence('READ')).state.status).toBe('PENDING');
    },
  );

  it('should reject a stale manual close after another operator renews pending', () => {
    const state = run([inbound(), manual('PENDING', '1', 'operator-b')]);

    expect(apply(state, manual('ATTENDED', '1', 'operator-a'))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'STALE_MANUAL_ATTENDED',
      state: { status: 'PENDING', revision: '2' },
    });
  });

  it('should serialize competing manual closes with one effect', () => {
    const first = apply(run([inbound()]), manual('ATTENDED', '1', 'first'));
    const second = apply(first.state, manual('ATTENDED', '1', 'second'));

    expect(first.kind).toBe('APPLIED');
    expect(second).toMatchObject({
      kind: 'CONFLICT',
      reason: 'STALE_MANUAL_ATTENDED',
      state: { status: 'ATTENDED', revision: '2' },
    });
  });

  it('should let at most one of two human responses close the same revision', () => {
    const state = run([
      inbound(),
      response(),
      response({ intentId: 'response-b', messageId: 'outbound-b' }),
    ]);
    const first = apply(state, evidence());
    const second = apply(
      first.state,
      evidence('READ', {
        intentId: 'response-b',
        messageId: 'outbound-b',
        evidence: {
          providerMessageId: 'provider-message-b',
          evidenceId: 'provider-read-b',
          status: 'READ',
        },
      }),
    );

    expect(first.kind).toBe('APPLIED');
    expect(second).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { status: 'ATTENDED', revision: '2' },
    });
  });

  it('should never resurrect an old response after repeated reopenings', () => {
    const state = run([
      inbound(),
      response(),
      evidence(),
      manual('PENDING', '2', 'reopen-1'),
      manual('ATTENDED', '3', 'close-1'),
      manual('PENDING', '4', 'reopen-2'),
    ]);

    expect(apply(state, evidence('READ'))).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { status: 'PENDING', revision: '5' },
    });
    expect(apply(state, evidence())).toMatchObject({
      kind: 'DUPLICATE',
      state: { status: 'PENDING', revision: '5' },
    });
  });

  const callbackOrders = permutations<AttentionProviderEvidence['status']>([
    'SENT',
    'UNKNOWN',
    'DELIVERED',
    'READ',
  ]);

  it.each(callbackOrders)(
    'should converge after callbacks %s / %s / %s / %s and their duplicates',
    (...statuses) => {
      let state = waitingForResponse();
      let closes = 0;

      for (const status of statuses) {
        const event = evidence(status);
        const result = apply(state, event);

        closes += result.audit.attentionChanged ? 1 : 0;
        state = result.state;
        const duplicate = apply(state, {
          ...event,
          eventKey: `retry:${status}`,
        });

        expect(duplicate.kind).toBe('DUPLICATE');
        expect(duplicate.audit.attentionChanged).toBe(false);
        state = duplicate.state;
      }

      expect(closes).toBe(1);
      expect(state).toMatchObject({ status: 'ATTENDED', revision: '2' });
    },
  );

  it('should preserve B through every ordering of B and response callbacks', () => {
    for (const events of permutations([
      inbound('inbound-b'),
      evidence('DELIVERED'),
      evidence('READ'),
      evidence('SENT'),
      evidence('UNKNOWN'),
    ])) {
      let state = waitingForResponse();
      let inboundBSeen = false;

      for (const event of events) {
        const result = apply(state, event);

        inboundBSeen ||= event.kind === 'INBOUND_RECEIVED';
        state = result.state;
        if (inboundBSeen) {
          expect(state.status).toBe('PENDING');
        }
      }

      expect(state.status).toBe('PENDING');
    }
  });

  it('should preserve revision and replay invariants through adversarial histories', () => {
    const events: AttentionEvent[] = [
      inbound(),
      inbound('inbound-b'),
      response(),
      evidence(),
      evidence('FAILED'),
      manual('PENDING', '0'),
      manual('ATTENDED', '1', 'close'),
    ];
    let explored = 0;
    const explore = (state: ConversationAttentionState, depth: number) => {
      if (depth === 0) {
        return;
      }

      for (const event of events) {
        const before = JSON.stringify(state);
        const result = apply(state, event);
        const { revision } = result.state;

        explored += 1;
        expect(JSON.stringify(state)).toBe(before);
        expect(BigInt(revision)).toBeGreaterThanOrEqual(BigInt(state.revision));
        if (result.audit.attentionChanged) {
          expect(BigInt(revision)).toBe(BigInt(state.revision) + BigInt(1));
        } else {
          expect(revision).toBe(state.revision);
        }

        if (result.state.status === 'ATTENDED' && state.status === 'PENDING') {
          expect(result.kind).toBe('APPLIED');
          expect(['MANUAL_ATTENDED', 'HUMAN_RESPONSE_CONFIRMED']).toContain(
            result.reason,
          );
          expect(result.audit.coveredRevision).toBe(state.revision);
        }

        if (result.kind === 'CONFLICT') {
          expect(result.state).toBe(state);
        } else {
          const replay = apply(result.state, event);

          expect(replay.kind).toBe('DUPLICATE');
          expect(replay.state).toBe(result.state);
        }

        explore(result.state, depth - 1);
      }
    };

    explore(initialState(), 4);
    expect(explored).toBe(2800);
  });
});
