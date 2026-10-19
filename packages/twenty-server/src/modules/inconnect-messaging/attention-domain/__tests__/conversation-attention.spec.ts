import {
  type AttentionEvent,
  type AttentionProviderEvidence,
  type AttentionResponseIntent,
  type ConversationAttentionState,
  type ResponseProvenance,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  apply,
  ATTENTION_SCOPE,
  evidence,
  inbound,
  initialState,
  manual,
  response,
  run,
  waitingForResponse,
} from 'src/modules/inconnect-messaging/attention-domain/__tests__/conversation-attention.fixtures';

describe('pure conversation attention', () => {
  it('should open and renew pending for each unique inbound', () => {
    expect(initialState()).toMatchObject({ status: 'ATTENDED', revision: '0' });
    expect(run([inbound(), inbound('inbound-b')])).toMatchObject({
      status: 'PENDING',
      revision: '2',
    });
  });

  it('should keep attention unchanged when messages are read', () => {
    const result = apply(run([inbound()]), {
      scope: ATTENTION_SCOPE,
      eventKey: 'read',
      kind: 'MESSAGES_READ',
      actorWorkspaceMemberId: 'human',
    });

    expect(result).toMatchObject({
      kind: 'IGNORED',
      reason: 'READ_DOES_NOT_ATTEND',
      state: { status: 'PENDING', revision: '1' },
      audit: { attentionChanged: false },
    });
  });

  it.each(['FREEFORM', 'TEMPLATE'] as const)(
    'should attend a covered pending after confirmed HUMAN %s',
    (format) => {
      const intended = apply(run([inbound()]), response({ format }));
      const confirmed = apply(intended.state, evidence());

      expect(intended).toMatchObject({
        kind: 'APPLIED',
        reason: 'RESPONSE_REGISTERED',
        state: { status: 'PENDING', revision: '1' },
        audit: { attentionChanged: false },
      });
      expect(confirmed).toMatchObject({
        kind: 'APPLIED',
        reason: 'HUMAN_RESPONSE_CONFIRMED',
        state: { status: 'ATTENDED', revision: '2' },
        audit: {
          scope: ATTENTION_SCOPE,
          eventKey: 'callback:DELIVERED',
          before: { status: 'PENDING', revision: '1' },
          after: { status: 'ATTENDED', revision: '2' },
          attentionChanged: true,
          intentId: 'response-a',
          messageId: 'outbound-a',
          actorWorkspaceMemberId: 'human',
          coveredRevision: '1',
          provenance: { kind: 'HUMAN' },
          evidence: { status: 'DELIVERED' },
          successPolicy: 'PROPOSED_DELIVERED_OR_READ',
        },
      });
    },
  );

  it.each(['AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should preserve pending for %s with either message format',
    (kind) => {
      for (const format of ['FREEFORM', 'TEMPLATE'] as const) {
        const state = run([
          inbound(),
          response({
            format,
            provenance: { kind, authorityReference: 'backend-fact' },
          }),
        ]);

        expect(apply(state, evidence())).toMatchObject({
          kind: 'IGNORED',
          reason: 'NON_HUMAN_RESPONSE',
          state: { status: 'PENDING', revision: '1' },
        });
      }
    },
  );

  it.each(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'] as const)(
    'should preserve pending for provider %s',
    (status) => {
      expect(apply(waitingForResponse(), evidence(status))).toMatchObject({
        kind: 'IGNORED',
        reason: 'INSUFFICIENT_PROVIDER_EVIDENCE',
        state: { status: 'PENDING', revision: '1' },
      });
    },
  );

  it.each(['DELIVERED', 'READ'] as const)(
    'should require an explicit proposed success policy for %s',
    (status) => {
      const state = waitingForResponse();
      const undecided = apply(state, evidence(status), 'UNDECIDED');

      expect(undecided).toMatchObject({
        kind: 'IGNORED',
        reason: 'SUCCESS_POLICY_UNDECIDED',
        state: { status: 'PENDING', revision: '1' },
      });
      expect(apply(state, evidence(status)).state.status).toBe('ATTENDED');
      // A policy change cannot silently repurpose an already consumed fact.
      expect(apply(undecided.state, evidence(status)).kind).toBe('DUPLICATE');
    },
  );

  it('should close only the exact manually observed revision', () => {
    const state = run([inbound()]);

    expect(apply(state, manual('ATTENDED', '1'))).toMatchObject({
      kind: 'APPLIED',
      state: { status: 'ATTENDED', revision: '2' },
    });
    expect(apply(state, manual('ATTENDED', '0'))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'STALE_MANUAL_ATTENDED',
      state,
    });
    expect(apply(initialState(), manual('ATTENDED', '0'))).toMatchObject({
      kind: 'IGNORED',
      reason: 'ALREADY_ATTENDED',
      state: { revision: '0' },
    });
  });

  it('should renew manual pending even from a stale observed view', () => {
    const result = apply(waitingForResponse(), manual('PENDING', '0'));

    expect(result).toMatchObject({
      kind: 'APPLIED',
      reason: 'MANUAL_PENDING_RENEWED',
      state: { status: 'PENDING', revision: '2' },
    });
    expect(apply(result.state, evidence()).state.status).toBe('PENDING');
  });

  it('should never let an unsolicited human send cover a later inbound', () => {
    const state = run([response({ coveredRevision: '0' }), inbound()]);

    expect(apply(state, evidence())).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { status: 'PENDING', revision: '1' },
    });
    expect(
      apply(run([response({ coveredRevision: '0' })]), evidence()),
    ).toMatchObject({ kind: 'IGNORED', reason: 'ALREADY_ATTENDED' });
  });

  it('should preserve exact arithmetic beyond Number.MAX_SAFE_INTEGER', () => {
    const state: ConversationAttentionState = {
      ...initialState(),
      revision: '9007199254740993',
    };
    const opened = apply(state, inbound()).state;
    const intended = apply(
      opened,
      response({ coveredRevision: '9007199254740994' }),
    ).state;
    const confirmed = apply(intended, evidence());

    expect(opened.revision).toBe('9007199254740994');
    expect(confirmed.state.revision).toBe('9007199254740995');
    expect(apply(opened, manual('ATTENDED', '9007199254740993')).kind).toBe(
      'CONFLICT',
    );
    expect(JSON.parse(JSON.stringify(confirmed.state))).toEqual(
      confirmed.state,
    );
  });

  it.each(['-1', '01', '1.0', '1e2', '', ' 1', 'NaN', '1\n', '1\r', '1\r\n'])(
    'should reject noncanonical revision %s',
    (revision) => {
      expect(apply({ ...initialState(), revision }, inbound())).toMatchObject({
        kind: 'CONFLICT',
        reason: 'INVALID_REVISION',
      });
      expect(
        apply(waitingForResponse(), manual('ATTENDED', revision)),
      ).toMatchObject({
        kind: 'CONFLICT',
        reason: 'INVALID_REVISION',
      });
      expect(
        apply(run([inbound()]), response({ coveredRevision: revision })),
      ).toMatchObject({ kind: 'CONFLICT', reason: 'INVALID_REVISION' });
    },
  );

  it('should reject future and stale response coverage', () => {
    const state = run([inbound()]);

    expect(apply(state, response({ coveredRevision: '2' }))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'FUTURE_REVISION',
    });
    expect(apply(state, response({ coveredRevision: '0' }))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'STALE_RESPONSE_INTENT',
    });
    expect(apply(state, manual('PENDING', '2'))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'FUTURE_REVISION',
    });
  });

  it.each([9007199254740992, BigInt('9007199254740993'), null, undefined])(
    'should reject a revision supplied without its exact string representation (%s)',
    (invalidRevision) => {
      const revision = invalidRevision as unknown as string;

      expect(apply({ ...initialState(), revision }, inbound())).toMatchObject({
        kind: 'CONFLICT',
        reason: 'INVALID_REVISION',
      });
      expect(
        apply(waitingForResponse(), manual('ATTENDED', revision)),
      ).toMatchObject({
        kind: 'CONFLICT',
        reason: 'INVALID_REVISION',
      });
    },
  );

  it.each(['workspaceId', 'conversationId', 'providerConnectionId'] as const)(
    'should reject a different %s before consuming any key',
    (field) => {
      const state = waitingForResponse();
      const event = {
        ...evidence(),
        scope: { ...ATTENTION_SCOPE, [field]: 'another' },
      };
      const result = apply(state, event);

      expect(result.kind).toBe('CONFLICT');
      expect(result.reason).toBe('SCOPE_MISMATCH');
      expect(result.state).toBe(state);
    },
  );

  it('should reject unknown intentions and mismatched message correlations', () => {
    const missing = apply(run([inbound()]), evidence());

    expect(missing).toMatchObject({
      kind: 'CONFLICT',
      reason: 'RESPONSE_INTENT_NOT_FOUND',
    });
    expect(apply(apply(missing.state, response()).state, evidence()).kind).toBe(
      'APPLIED',
    );
    expect(
      apply(waitingForResponse(), evidence('READ', { messageId: 'other' })),
    ).toMatchObject({ kind: 'CONFLICT', reason: 'MESSAGE_IDENTITY_CONFLICT' });
    expect(
      apply(waitingForResponse(), response({ intentId: 'other' })),
    ).toMatchObject({ kind: 'CONFLICT', reason: 'MESSAGE_IDENTITY_CONFLICT' });
  });

  it('should deduplicate inbound effects across distinct transport event keys', () => {
    const state = run([inbound()]);
    const alias = { ...inbound(), eventKey: 'transport-redelivery' };
    const result = apply(state, alias);

    expect(result).toMatchObject({
      kind: 'DUPLICATE',
      reason: 'SAME_INTENTION_OR_EVIDENCE',
      state: { status: 'PENDING', revision: '1' },
    });
    expect(apply(result.state, alias).state).toBe(result.state);
    expect(
      apply(result.state, { ...inbound('other'), eventKey: alias.eventKey }),
    ).toMatchObject({ kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' });
  });

  it('should deduplicate retries before checking now-stale observed revisions', () => {
    for (const event of [
      manual('PENDING', '1'),
      manual('ATTENDED', '1'),
      response(),
    ]) {
      const first = apply(run([inbound()]), event);
      const later = apply(first.state, inbound('later')).state;
      const retry = apply(later, { ...event, eventKey: 'retry' });

      expect(first.kind).toBe('APPLIED');
      expect(retry.kind).toBe('DUPLICATE');
      expect(retry.state.revision).toBe(later.revision);
      expect(retry.state.status).toBe(later.status);
    }
  });

  it('should reject changed immutable response facts under the same intention', () => {
    const changes: Partial<AttentionResponseIntent>[] = [
      { coveredRevision: '0' },
      { messageId: 'other' },
      { contentFingerprint: 'changed-content' },
      { format: 'TEMPLATE' },
      { provenance: { kind: 'AUTOMATION', authorityReference: 'other' } },
      {
        provenance: {
          kind: 'HUMAN',
          actorWorkspaceMemberId: 'other-human',
          authorityReference: 'authenticated-send',
        },
      },
    ];

    for (const change of changes) {
      expect(
        apply(waitingForResponse(), { ...response(change), eventKey: 'retry' }),
      ).toMatchObject({ kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' });
    }
  });

  it('should reject changed manual actions under the same intention', () => {
    const state = run([inbound(), manual('PENDING', '1')]);

    expect(apply(state, manual('ATTENDED', '1'))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'IDEMPOTENCY_CONFLICT',
    });
    expect(apply(state, manual('PENDING', '2'))).toMatchObject({
      kind: 'CONFLICT',
      reason: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('should keep manual intention identity scoped to the authenticated actor', () => {
    const state = run([manual('PENDING', '0')]);
    const event: AttentionEvent = {
      ...manual('PENDING', '0'),
      actorWorkspaceMemberId: 'other-human',
      eventKey: 'other-actor-same-client-intention',
    };

    expect(apply(state, event)).toMatchObject({
      kind: 'APPLIED',
      state: { status: 'PENDING', revision: '2' },
    });
  });

  it('should deduplicate identical provider evidence and reject its reuse', () => {
    const first = apply(waitingForResponse(), evidence());
    const alias = { ...evidence(), eventKey: 'duplicate-callback' };
    const duplicate = apply(first.state, alias);

    expect(duplicate.kind).toBe('DUPLICATE');
    expect(duplicate.state.revision).toBe('2');
    expect(
      apply(duplicate.state, {
        ...evidence('FAILED'),
        eventKey: alias.eventKey,
      }),
    ).toMatchObject({ kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' });
    expect(
      apply(
        first.state,
        evidence('FAILED', {
          evidence: {
            evidenceId: 'provider-event:DELIVERED',
            providerMessageId: 'provider-message-a',
            status: 'FAILED',
          },
        }),
      ),
    ).toMatchObject({ kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' });
  });

  it('should be deterministic and leave frozen inputs unchanged', () => {
    const state = waitingForResponse();
    const event = evidence();
    const freeze = <TData>(value: TData): TData => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }

      return value;
    };
    const before = JSON.stringify({ state, event });

    freeze(state);
    freeze(event);
    expect(apply(state, event)).toEqual(apply(state, event));
    expect(JSON.stringify({ state, event })).toBe(before);
    expect(apply(state, event).state).not.toBe(state);
  });

  it('should ignore nondefinitive facts across every provenance', () => {
    const provenances: ResponseProvenance[] = [
      {
        kind: 'HUMAN',
        actorWorkspaceMemberId: 'human',
        authorityReference: 'auth',
      },
      { kind: 'AUTOMATION', authorityReference: 'job' },
      { kind: 'LEGACY_UNKNOWN', authorityReference: 'historical-message' },
    ];
    const statuses: AttentionProviderEvidence['status'][] = [
      'QUEUED',
      'SENDING',
      'SENT',
      'UNKNOWN',
      'FAILED',
    ];

    for (const provenance of provenances) {
      for (const status of statuses) {
        const state: ConversationAttentionState = run([
          inbound(),
          response({ provenance }),
        ]);

        expect(apply(state, evidence(status)).state).toMatchObject({
          status: 'PENDING',
          revision: '1',
        });
      }
    }
  });
});
