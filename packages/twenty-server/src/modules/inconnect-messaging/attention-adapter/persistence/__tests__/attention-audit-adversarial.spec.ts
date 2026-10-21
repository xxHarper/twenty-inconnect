import { type AttentionEvent } from 'src/modules/inconnect-messaging/attention-domain';
import {
  decodeAttentionEpochRow,
  decodeAttentionTransitionAuditRow,
  mapAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence';
import {
  apply,
  epoch,
  evidence,
  identifier,
  inbound,
  initial,
  intent,
  pending,
  physicalRows,
  response,
  scope,
  timestamp,
  unwrap,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';

const manual = (
  action: 'PENDING' | 'ATTENDED',
  observedRevision: string,
): AttentionEvent => ({
  kind: 'MANUAL_ACTION',
  scope,
  eventKey: 'manual-event',
  actorWorkspaceMemberId: identifier(12),
  intentId: 'manual-intent',
  action,
  observedRevision,
});

describe('strict attention audit compatibility and adversarial boundaries', () => {
  const registered = apply(pending(), response()).state;
  const cases = [
    ['inbound', inbound(), initial()],
    ['manual pending', manual('PENDING', '0'), initial()],
    ['manual attended', manual('ATTENDED', '1'), pending()],
    ['manual already attended', manual('ATTENDED', '0'), initial()],
    ['stale manual', manual('ATTENDED', '0'), pending()],
    ['future manual', manual('PENDING', '2'), pending()],
    ['stale response', response(intent({ coveredRevision: '0' })), pending()],
    ['future response', response(intent({ coveredRevision: '2' })), pending()],
    [
      'same message conflict',
      response(intent({ intentId: 'other-intent' })),
      registered,
    ],
    ['missing intent', evidence(), pending()],
    [
      'wrong message',
      { ...evidence(), messageId: identifier(98) } as AttentionEvent,
      registered,
    ],
    ['delivered', evidence(), registered],
    ['read', evidence('READ'), registered],
    ['sent', evidence('SENT'), registered],
    ['old coverage', evidence(), { ...registered, revision: '2' }],
    ['exact replay', inbound(), apply(initial(), inbound()).state],
    [
      'alias replay',
      { ...inbound(), eventKey: 'new-alias' },
      apply(initial(), inbound()).state,
    ],
    [
      'collision',
      { ...inbound(), messageId: identifier(99) } as AttentionEvent,
      apply(initial(), inbound()).state,
    ],
  ] as const;
  it.each(cases)(
    'should decode the real reducer outcome for %s',
    (_name, event, state) => {
      const rows = physicalRows(event, state);
      expect(
        unwrap(decodeAttentionTransitionAuditRow(rows.canonicalAudit)).result,
      ).toEqual(rows.canonicalAudit.result);
    },
  );
  it('should reject extra or missing audit/provenance/evidence data', () => {
    const row = physicalRows(evidence(), registered).canonicalAudit;
    const { audit } = row.result;
    for (const field of Object.keys(audit)) {
      const missing = { ...audit } as Record<string, unknown>;
      delete missing[field];
      expect(
        decodeAttentionTransitionAuditRow({
          ...row,
          result: { ...row.result, audit: missing },
        }),
      ).toMatchObject({ ok: false, error: { code: 'MISSING_FIELD' } });
    }
    for (const changed of [
      { ...audit, provenance: { ...audit.provenance, extra: 'forbidden' } },
      { ...audit, evidence: { ...audit.evidence, status: 'ACCEPTED' } },
      { ...audit, coveredRevision: null },
      { ...audit, provenance: null },
      { ...audit, before: { ...audit.before, revision: '01' } },
      { ...audit, successPolicy: 'UNDECIDED' },
      {
        ...audit,
        evidence: { ...audit.evidence, providerMessageId: 'different' },
      },
    ])
      expect(
        decodeAttentionTransitionAuditRow({
          ...row,
          result: { ...row.result, audit: changed },
        }).ok,
      ).toBe(false);
  });
  it('should apply the 64 KiB budget to a valid but oversized original result', () => {
    const row = physicalRows(
      inbound(),
      pending('9'.repeat(34000)),
    ).canonicalAudit;
    expect(
      Buffer.byteLength(JSON.stringify(row.result), 'utf8'),
    ).toBeGreaterThan(65536);
    expect(decodeAttentionTransitionAuditRow(row)).toMatchObject({
      ok: false,
      error: { code: 'CAPACITY_EXCEEDED' },
    });
  });
  it('should accept exact timestamp equivalents and reject lifecycle time reversal', () => {
    const equivalent = '2026-10-21T06:34:56.123456-06:00';
    const pendingEpoch = {
      ...epoch,
      bootstrapStatus: 'PENDING',
      bootstrapPendingAt: timestamp,
    };
    const conversation = {
      id: scope.conversationId,
      workspaceId: scope.workspaceId,
      providerConnectionId: scope.providerConnectionId,
      attentionTrackingEpochId: scope.trackingEpochId,
      attentionStatus: 'PENDING',
      attentionRevision: '0',
      pendingAt: equivalent,
    };
    expect(mapAttentionSnapshot(conversation, pendingEpoch).ok).toBe(true);
    expect(
      mapAttentionSnapshot(
        { ...conversation, pendingAt: '2026-10-21T06:34:56.123455-06:00' },
        pendingEpoch,
      ).ok,
    ).toBe(false);
    expect(
      decodeAttentionEpochRow({ ...epoch, activatedAt: '2026-10-20T00:00:00Z' })
        .ok,
    ).toBe(false);
    expect(
      decodeAttentionEpochRow({
        ...epoch,
        lifecycle: 'CLOSED',
        closedAt: '2026-10-21T12:34:56.123455Z',
      }).ok,
    ).toBe(false);
    expect(
      decodeAttentionEpochRow({
        ...epoch,
        lifecycle: 'SUSPENDED',
        activatedAt: null,
      }).ok,
    ).toBe(true);
  });
  it('should preserve immutable input and reject malformed fingerprint tuples', () => {
    const rows = physicalRows(response(), pending());
    const serialized = JSON.stringify(rows);
    Object.freeze(rows.canonicalAudit.result.audit);
    Object.freeze(rows.canonicalAudit.result);
    Object.freeze(rows.canonicalAudit);
    expect(decodeAttentionTransitionAuditRow(rows.canonicalAudit).ok).toBe(
      true,
    );
    expect(JSON.stringify(rows)).toBe(serialized);
    for (const fingerprint of [
      '{',
      '{}',
      '[]',
      '["NEW_KIND"]',
      '["INBOUND_RECEIVED",null]',
      `${rows.effect.fingerprint.slice(0, -1)},"extra"]`,
    ])
      expect(
        decodeAttentionTransitionAuditRow({
          ...rows.canonicalAudit,
          fingerprint,
        }).ok,
      ).toBe(false);
  });
  it('should reject accessors without executing them', () => {
    const row = physicalRows().canonicalAudit;
    const getter = jest.fn(() => {
      throw new Error('must not execute');
    });
    const malformed = Object.defineProperty({ ...row }, 'result', {
      get: getter,
      enumerable: true,
    });
    expect(decodeAttentionTransitionAuditRow(malformed)).toMatchObject({
      ok: false,
      error: { code: 'WRONG_TYPE' },
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it('should reject impossible READ aliases and duplicates with missing causal history', () => {
    const read: AttentionEvent = {
      kind: 'MESSAGES_READ',
      scope,
      eventKey: 'read',
      actorWorkspaceMemberId: identifier(12),
    };
    const readRow = physicalRows(read).canonicalAudit;
    expect(
      decodeAttentionTransitionAuditRow({
        ...readRow,
        result: {
          ...readRow.result,
          kind: 'DUPLICATE',
          reason: 'SAME_INTENTION_OR_EVIDENCE',
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'IMPOSSIBLE_RESULT' } });
    const missing = physicalRows(evidence(), pending()).canonicalAudit;
    expect(
      decodeAttentionTransitionAuditRow({
        ...missing,
        result: { ...missing.result, kind: 'DUPLICATE', reason: 'SAME_EVENT' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'IMPOSSIBLE_RESULT' } });
    const future = physicalRows(
      response(intent({ coveredRevision: '2' })),
      pending(),
    ).canonicalAudit;
    expect(
      decodeAttentionTransitionAuditRow({
        ...future,
        result: { ...future.result, kind: 'DUPLICATE', reason: 'SAME_EVENT' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'IMPOSSIBLE_RESULT' } });
  });
});
