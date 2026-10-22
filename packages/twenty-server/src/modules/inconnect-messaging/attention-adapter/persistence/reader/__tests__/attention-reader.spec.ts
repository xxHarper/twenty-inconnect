import { evaluateAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter';
import { type AttentionReaderResult } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';
import {
  aliasRows,
  apply,
  evidence,
  identifier,
  inbound,
  initial,
  intent,
  pending,
  physicalRows,
  response,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { type AttentionEvent } from 'src/modules/inconnect-messaging/attention-domain';
import {
  bundle,
  conversation,
  runScript,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';

const value = (result: AttentionReaderResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const evaluate = (result: AttentionReaderResult) => {
  const { plan, facts } = value(result);
  const evaluation = evaluateAttentionProjection(plan, facts);
  if (!evaluation.ok) throw new Error(JSON.stringify(evaluation.error));
  return evaluation.value;
};

// These tests execute the real C1 evaluator separately from the reader. Reading
// never invokes transitionConversationAttention except accepted decoder checks.
describe('transactional attention reader with real C1 projection', () => {
  it('should prove both Receipt and Effect absent before allowing a new inbound', async () => {
    const result = await runScript();
    expect(value(result).facts).toEqual({
      eventReceipt: null,
      effect: null,
      intent: null,
    });
    expect(evaluate(result).transition).toEqual(apply(initial(), inbound()));
    expect(value(result).unresolved).toContain('CURRENT_AUTHORITY');
  });
  it('should read an Effect independently when Receipt is absent and produce a new alias', async () => {
    const rows = physicalRows();
    const event = { ...inbound(), eventKey: 'new-alias' };
    const result = await runScript({
      event,
      current: conversation('PENDING', '1'),
      effect: rows.effect,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(value(result).facts.eventReceipt).toBeNull();
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'DUPLICATE', reason: 'SAME_INTENTION_OR_EVIDENCE' },
      delta: { effect: null, intent: null, receipt: { eventKey: 'new-alias' } },
      recovered: {
        eventResult: null,
        effectResult: rows.canonicalAudit.result,
      },
    });
  });
  it('should recover an exact canonical Receipt and Effect', async () => {
    const rows = physicalRows();
    const result = await runScript({
      current: conversation('PENDING', '1'),
      receipt: rows.canonicalReceipt,
      effect: rows.effect,
      originalAudit: rows.canonicalAudit,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'DUPLICATE', reason: 'SAME_EVENT' },
      recovered: {
        eventResult: rows.canonicalAudit.result,
        effectResult: rows.canonicalAudit.result,
      },
      delta: { effect: null, receipt: null, intent: null },
    });
  });
  it('should keep a historical alias DUPLICATE distinct from canonical APPLIED', async () => {
    const rows = aliasRows();
    const result = await runScript({
      event: rows.aliasEvent,
      current: conversation('PENDING', '2'),
      receipt: rows.receipt,
      effect: rows.effect,
      originalAudit: rows.originalAudit,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'DUPLICATE', state: { revision: '2' } },
      recovered: {
        eventResult: {
          kind: 'DUPLICATE',
          audit: { before: { revision: '1' } },
        },
        effectResult: { kind: 'APPLIED' },
      },
    });
  });
  it('should preserve an IGNORED Effect and its own alias original after later changes', async () => {
    const event: AttentionEvent = {
      kind: 'MANUAL_ACTION',
      scope,
      eventKey: 'attended',
      intentId: 'attended-intent',
      actorWorkspaceMemberId: identifier(12),
      action: 'ATTENDED',
      observedRevision: '0',
    };
    const rows = physicalRows(event);
    const later = apply(rows.transition.state, inbound()).state;
    const alias = { ...event, eventKey: 'ignored-alias' };
    const { state: _state, ...result } = apply(later, alias);
    const originalAudit = {
      ...rows.canonicalAudit,
      id: identifier(32),
      eventKey: alias.eventKey,
      result,
    };
    const receipt = {
      ...rows.canonicalReceipt,
      id: identifier(31),
      originalAuditId: originalAudit.id,
      eventKey: alias.eventKey,
    };
    const read = await runScript({
      event: alias,
      current: conversation('PENDING', '1'),
      receipt,
      effect: rows.effect,
      originalAudit,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(evaluate(read).recovered).toMatchObject({
      eventResult: { kind: 'DUPLICATE' },
      effectResult: { kind: 'IGNORED', reason: 'ALREADY_ATTENDED' },
    });
  });
  it('should preserve an eventKey collision with another effect even when the requested Effect is absent', async () => {
    const rows = physicalRows();
    const event = { ...inbound(), messageId: identifier(99) } as AttentionEvent;
    const result = await runScript({
      event,
      current: conversation('PENDING', '1'),
      receipt: rows.canonicalReceipt,
      originalAudit: rows.canonicalAudit,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(value(result).facts.effect).toBeNull();
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' },
      delta: { effect: null, receipt: null, intent: null },
    });
  });
  it('should leave a changed fingerprint as a semantic collision without rewriting frozen data', async () => {
    const rows = physicalRows(response(), pending());
    const result = await runScript({
      event: {
        ...response(intent({ contentFingerprint: 'changed' })),
        eventKey: 'changed-response',
      },
      current: conversation('PENDING', '1'),
      effect: rows.effect,
      intent: rows.intent!,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' },
      delta: { effect: null, receipt: null, intent: null },
    });
    expect(value(result).facts.intent?.intent.contentFingerprint).toBe(
      'content-hash',
    );
  });
  it('should query ResponseIntent by Message and retain a previously consumed intention', async () => {
    const rows = physicalRows(response(), pending());
    const result = await runScript({
      event: {
        ...response(intent({ intentId: 'new-intent' })),
        eventKey: 'other-response',
      },
      current: conversation('PENDING', '1'),
      intent: rows.intent!,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(value(result).plan.intentLookup).toEqual({
      kind: 'MESSAGE_ID',
      value: intent().messageId,
    });
    expect(evaluate(result).transition).toMatchObject({
      kind: 'CONFLICT',
      reason: 'MESSAGE_IDENTITY_CONFLICT',
    });
  });
  it.each(['HUMAN', 'AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should preserve %s TEMPLATE provenance from the registration',
    async (kind) => {
      const provenance =
        kind === 'HUMAN'
          ? intent().provenance
          : { kind, authorityReference: 'historical-source' };
      const rows = physicalRows(response(intent({ provenance })), pending());
      const result = await runScript({
        event: evidence(),
        current: conversation('PENDING', '1'),
        intent: rows.intent!,
        bundles: { [rows.effect.id]: bundle(rows) },
      });
      expect(value(result).facts.intent?.intent.provenance).toEqual(provenance);
      const full = apply(rows.transition.state, evidence());
      const projected = evaluate(result).transition;
      expect({
        ...projected,
        state: {
          ...projected.state,
          receipts: [
            ...rows.transition.state.receipts,
            ...projected.state.receipts,
          ],
        },
      }).toEqual(full);
      expect(projected.state.status).toBe(
        kind === 'HUMAN' ? 'ATTENDED' : 'PENDING',
      );
    },
  );
  it('should preserve huge frozen coverage and reject an old callback logically after another inbound', async () => {
    const revision = '922337203685477580812345678901234567890';
    const rows = physicalRows(
      response(intent({ coveredRevision: revision })),
      pending(revision),
    );
    const result = await runScript({
      event: evidence(),
      current: conversation(
        'PENDING',
        (BigInt(revision) + BigInt(1)).toString(),
      ),
      intent: rows.intent!,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(value(result).facts.intent?.intent.coveredRevision).toBe(revision);
    expect(value(result).plan.snapshot.revision).toBe(
      '922337203685477580812345678901234567891',
    );
    expect(evaluate(result).transition).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { status: 'PENDING' },
    });
  });
  it('should permit a missing ResponseIntent to produce CONFLICT without reserving keys', async () => {
    const result = await runScript({
      event: evidence(),
      current: conversation('PENDING', '1'),
    });
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'CONFLICT', reason: 'RESPONSE_INTENT_NOT_FOUND' },
      delta: { effect: null, receipt: null, intent: null },
    });
    const rows = physicalRows(response(), pending());
    const retry = await runScript({
      event: evidence(),
      current: conversation('PENDING', '1'),
      intent: rows.intent!,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    expect(value(retry).plan.identity).toEqual(value(result).plan.identity);
    expect(evaluate(retry).transition.reason).toBe('HUMAN_RESPONSE_CONFIRMED');
  });
  it('should reconstruct consumed provider evidence and its full registration pair', async () => {
    const registration = physicalRows(response(), pending());
    const stored = physicalRows(evidence(), registration.transition.state);
    const effect = {
      ...stored.effect,
      id: identifier(40),
      canonicalReceiptId: identifier(41),
    };
    const canonicalAudit = { ...stored.canonicalAudit, id: identifier(50) };
    const canonicalReceipt = {
      ...stored.canonicalReceipt,
      id: identifier(41),
      effectId: effect.id,
      originalAuditId: canonicalAudit.id,
    };
    const rows = {
      ...stored,
      effect,
      canonicalReceipt,
      canonicalAudit,
      intent: registration.intent,
    };
    const result = await runScript({
      event: evidence(),
      current: conversation('ATTENDED', '2'),
      effect,
      receipt: canonicalReceipt,
      originalAudit: canonicalAudit,
      intent: registration.intent!,
      bundles: {
        [effect.id]: bundle(rows, registration),
        [registration.effect.id]: bundle(registration),
      },
    });
    expect(evaluate(result)).toMatchObject({
      transition: { kind: 'DUPLICATE' },
      recovered: {
        effectResult: { kind: 'APPLIED', reason: 'HUMAN_RESPONSE_CONFIRMED' },
      },
    });
  });
});
