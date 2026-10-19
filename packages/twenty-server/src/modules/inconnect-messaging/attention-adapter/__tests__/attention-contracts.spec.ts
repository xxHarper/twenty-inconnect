import {
  type AttentionAdapterResult,
  type AttentionSnapshot,
  type AttentionTrackingScope,
  identifyAttentionEffect,
  parseExactAttentionRevision,
  planAttentionProjection,
  evaluateAttentionProjection,
  validateAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter';
import {
  evidence,
  inbound,
  initialState,
  manual,
  response,
} from 'src/modules/inconnect-messaging/attention-domain/__tests__/conversation-attention.fixtures';
import {
  createHarness,
  readFacts,
  trackingScope,
  unwrap,
} from 'src/modules/inconnect-messaging/attention-adapter/__tests__/attention-projection.fixtures';

const snapshot = () =>
  unwrap(
    validateAttentionSnapshot({ ...initialState(), scope: trackingScope }),
  );
const expectError = <TValue>(
  result: AttentionAdapterResult<TValue>,
  code: string,
) => {
  expect(result).toMatchObject({ ok: false, error: { code } });
};

describe('source-only attention adapter contracts', () => {
  it.each(['0', '1', '9007199254740993', '123456789012345678901234567890'])(
    'should preserve exact canonical revision %s',
    (revision) => {
      expect(unwrap(parseExactAttentionRevision(revision))).toBe(revision);
    },
  );

  it.each([
    '',
    '00',
    '01',
    '-1',
    '+1',
    '1.0',
    '1e2',
    ' 1',
    '1 ',
    '1\n',
    '1\r\n',
    1,
    Number.MAX_SAFE_INTEGER,
    BigInt(1),
    null,
    undefined,
  ])('should reject noncanonical revision %s', (revision) => {
    expectError(parseExactAttentionRevision(revision), 'INVALID_REVISION');
    expectError(
      validateAttentionSnapshot({
        scope: trackingScope,
        status: 'PENDING',
        revision,
      }),
      'INVALID_REVISION',
    );
  });

  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ] as const)('should reject empty or mismatched %s', (field) => {
    for (const value of ['', ' ', ' value', 'value\n']) {
      const scope = { ...trackingScope, [field]: value };

      expectError(
        validateAttentionSnapshot({ scope, status: 'ATTENDED', revision: '0' }),
        'INVALID_IDENTITY',
      );
      expectError(
        identifyAttentionEffect({ scope, event: inbound() }),
        'INVALID_IDENTITY',
      );
    }
    const scope = { ...trackingScope, [field]: 'other' };
    const domainScope = {
      workspaceId: scope.workspaceId,
      conversationId: scope.conversationId,
      providerConnectionId: scope.providerConnectionId,
    };

    expectError(
      planAttentionProjection(snapshot(), {
        scope,
        event: { ...inbound(), scope: domainScope },
      }),
      'SCOPE_MISMATCH',
    );
  });

  it('should reject contradictory envelope and domain scopes', () => {
    expectError(
      identifyAttentionEffect({
        scope: trackingScope,
        event: {
          ...inbound(),
          scope: { ...inbound().scope, providerConnectionId: 'other' },
        },
      }),
      'SCOPE_MISMATCH',
    );
  });

  it('should use ordered tuples for scoped identities without delimiter collisions', () => {
    const left: AttentionTrackingScope = {
      ...trackingScope,
      workspaceId: 'a:b',
      conversationId: 'c',
    };
    const right: AttentionTrackingScope = {
      ...trackingScope,
      workspaceId: 'a',
      conversationId: 'b:c',
    };
    const leftIdentity = unwrap(
      identifyAttentionEffect({
        scope: left,
        event: { ...inbound('m:x'), scope: left },
      }),
    );
    const rightIdentity = unwrap(
      identifyAttentionEffect({
        scope: right,
        event: { ...inbound('m:x'), scope: right },
      }),
    );
    const alias = unwrap(
      identifyAttentionEffect({
        scope: left,
        event: { ...inbound('m:x'), eventKey: 'alias', scope: left },
      }),
    );

    expect(leftIdentity.effectId).not.toBe(rightIdentity.effectId);
    expect(leftIdentity.receiptId).not.toBe(rightIdentity.receiptId);
    expect(alias.effectId).toBe(leftIdentity.effectId);
    expect(alias.fingerprint).toBe(leftIdentity.fingerprint);
    expect(alias.receiptId).not.toBe(leftIdentity.receiptId);
  });

  it('should preserve fingerprint despite property ordering and freeze planned immutable provenance', () => {
    const event = response();
    const reordered = {
      ...event,
      intent: {
        format: event.intent.format,
        provenance: { ...event.intent.provenance },
        coveredRevision: event.intent.coveredRevision,
        contentFingerprint: event.intent.contentFingerprint,
        messageId: event.intent.messageId,
        intentId: event.intent.intentId,
      },
    };
    const identity = unwrap(
      identifyAttentionEffect({ scope: trackingScope, event }),
    );

    expect(
      unwrap(
        identifyAttentionEffect({ scope: trackingScope, event: reordered }),
      ),
    ).toEqual(identity);
    const plan = unwrap(
      planAttentionProjection(snapshot(), { scope: trackingScope, event }),
    );

    // Simulate a caller keeping a mutable reference despite the readonly API.
    Object.assign(event.intent.provenance, { authorityReference: 'changed' });
    Object.assign(event.intent, { contentFingerprint: 'changed' });
    Object.assign(event, { eventKey: 'changed' });
    expect(unwrap(identifyAttentionEffect(plan.input))).toEqual(identity);
    expect(Object.isFrozen(plan.input.event)).toBe(true);
    expect(plan.input.event.kind).toBe('RESPONSE_INTENDED');
    if (plan.input.event.kind === 'RESPONSE_INTENDED') {
      expect(Object.isFrozen(plan.input.event.intent.provenance)).toBe(true);
    }
  });

  it('should make a validated snapshot independent of later scope mutation', () => {
    const scope = { ...trackingScope };
    const validated = unwrap(
      validateAttentionSnapshot({
        scope,
        status: 'PENDING',
        revision: '9007199254740993',
      }),
    );

    scope.workspaceId = 'changed';
    expect(validated.scope.workspaceId).toBe(trackingScope.workspaceId);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.scope)).toBe(true);
  });

  it.each(['', ' ', ' key', 'key\n'])(
    'should reject ambiguous event identity %s',
    (eventKey) => {
      expectError(
        identifyAttentionEffect({
          scope: trackingScope,
          event: { ...inbound(), eventKey },
        }),
        'INVALID_IDENTITY',
      );
    },
  );

  it('should reject malformed revision, identity, provenance and unsupported ACCEPTED before reducer entry', () => {
    expectError(
      identifyAttentionEffect({
        scope: trackingScope,
        event: manual('ATTENDED', '01'),
      }),
      'INVALID_REVISION',
    );
    expectError(
      identifyAttentionEffect({
        scope: trackingScope,
        event: response({ coveredRevision: '01' }),
      }),
      'INVALID_REVISION',
    );
    expectError(
      identifyAttentionEffect({
        scope: trackingScope,
        event: response({
          provenance: {
            kind: 'HUMAN',
            actorWorkspaceMemberId: '',
            authorityReference: 'backend',
          },
        }),
      }),
      'INVALID_IDENTITY',
    );
    expectError(
      identifyAttentionEffect({
        scope: trackingScope,
        event: response({ contentFingerprint: '' }),
      }),
      'INVALID_IDENTITY',
    );
    const accepted = evidence();

    // Typed contracts are backend-only; this is deliberate runtime corruption.
    Object.assign(accepted.evidence, { status: 'ACCEPTED' });
    expectError(
      identifyAttentionEffect({ scope: trackingScope, event: accepted }),
      'INVALID_CONFIGURATION',
    );
    expectError(
      validateAttentionSnapshot({
        ...snapshot(),
        status: 'CORRUPT' as AttentionSnapshot['status'],
      }),
      'INVALID_CONFIGURATION',
    );
  });

  it('should select the exact point lookup required by each reducer branch', () => {
    for (const [event, expected] of [
      [inbound(), { kind: 'NONE' }],
      [manual('PENDING', '0'), { kind: 'NONE' }],
      [response(), { kind: 'MESSAGE_ID', value: 'outbound-a' }],
      [evidence(), { kind: 'INTENT_ID', value: 'response-a' }],
    ] as const) {
      expect(
        unwrap(
          planAttentionProjection(snapshot(), { scope: trackingScope, event }),
        ).intentLookup,
      ).toEqual(expected);
    }
  });

  it('should recover original results even if storage reorders object properties', () => {
    const harness = createHarness();

    harness.step(inbound());
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event: inbound(),
      }),
    );
    const facts = readFacts(harness.store, plan);
    const original = facts.eventReceipt!.original;
    const reordered = {
      audit: {
        ...original.audit,
        before: {
          revision: original.audit.before.revision,
          status: original.audit.before.status,
        },
      },
      reason: original.reason,
      kind: original.kind,
    };

    expect(
      unwrap(
        evaluateAttentionProjection(plan, {
          ...facts,
          eventReceipt: { ...facts.eventReceipt!, original: reordered },
        }),
      ).transition.kind,
    ).toBe('DUPLICATE');
  });

  it('should reject corrupt historical results without treating them as a retry', () => {
    const harness = createHarness();

    harness.step(inbound());
    const plan = unwrap(
      planAttentionProjection(harness.snapshot(), {
        scope: trackingScope,
        event: inbound(),
      }),
    );
    const facts = readFacts(harness.store, plan);
    const effect = facts.effect!;
    const audit = effect.original.audit;

    for (const invalidAudit of [
      { ...audit, after: { ...audit.after, revision: '100' } },
      { ...audit, before: { ...audit.before, revision: '01' } },
      { ...audit, attentionChanged: false },
      { ...audit, eventKey: 'other' },
    ]) {
      expectError(
        evaluateAttentionProjection(plan, {
          ...facts,
          effect: {
            ...effect,
            original: { ...effect.original, audit: invalidAudit },
          },
        }),
        'INVALID_LEDGER',
      );
    }
  });

  it('should change every immutable response fingerprint field under the same effect identity', () => {
    const event = response();
    const original = unwrap(
      identifyAttentionEffect({ scope: trackingScope, event }),
    );
    const changes = [
      response({ messageId: 'other' }),
      response({ contentFingerprint: 'changed' }),
      response({ coveredRevision: '2' }),
      response({ format: 'TEMPLATE' }),
      response({
        provenance: { kind: 'AUTOMATION', authorityReference: 'backend' },
      }),
      response({
        provenance: {
          kind: 'HUMAN',
          actorWorkspaceMemberId: 'other',
          authorityReference: 'authenticated-send',
        },
      }),
      response({
        provenance: { ...event.intent.provenance, authorityReference: 'other' },
      }),
    ];
    const harness = createHarness();

    harness.step(inbound());
    harness.step(event);
    for (const changed of changes) {
      const identity = unwrap(
        identifyAttentionEffect({ scope: trackingScope, event: changed }),
      );

      expect(identity.effectId).toBe(original.effectId);
      expect(identity.fingerprint).not.toBe(original.fingerprint);
      expect(
        harness.step({ ...changed, eventKey: 'new-alias' }).transition.reason,
      ).toBe('IDEMPOTENCY_CONFLICT');
      expect(harness.store.receipts.size).toBe(2);
    }
  });

  it('should never reinterpret changed evidence under a consumed logical key', () => {
    const harness = createHarness();

    harness.step(inbound());
    harness.step(response());
    harness.step(evidence());
    const changed = evidence('DELIVERED');

    Object.assign(changed.evidence, { status: 'FAILED' });
    expect(
      harness.step({ ...changed, eventKey: 'new-alias' }).transition.reason,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(harness.state().status).toBe('ATTENDED');
  });
});
