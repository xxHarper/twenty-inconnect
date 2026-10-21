import {
  decodeAttentionConversationColumns,
  decodeAttentionEffectRow,
  decodeAttentionEpochRow,
  decodeAttentionMessageColumns,
  decodeAttentionProviderStatusColumns,
  decodeAttentionReceiptRow,
  decodeAttentionResponseIntentRow,
  decodeAttentionTransitionAuditRow,
  decodeAttentionWebhookColumns,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence';
import {
  decodeAttentionValue,
  rowText,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import {
  aliasRows,
  apply,
  epoch,
  evidence,
  identifier,
  inbound,
  intent,
  pending,
  physicalRows,
  response,
  scope,
  timestamp,
  unwrap,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';

const inboundRows = physicalRows();
const responseRows = physicalRows(response(), pending());
const evidenceRows = physicalRows(
  evidence(),
  apply(pending(), response()).state,
);

describe('attention physical row decoders', () => {
  const cases = [
    ['epoch', decodeAttentionEpochRow, epoch],
    ['effect', decodeAttentionEffectRow, inboundRows.effect],
    ['receipt', decodeAttentionReceiptRow, inboundRows.canonicalReceipt],
    ['intent', decodeAttentionResponseIntentRow, responseRows.intent!],
    ['audit', decodeAttentionTransitionAuditRow, inboundRows.canonicalAudit],
  ] as const;
  it.each(cases)('should decode a valid %s row', (_name, decode, row) => {
    expect(decode(row)).toEqual({ ok: true, value: row });
  });
  it.each(cases)(
    'should distinguish missing, null and wrong type on %s',
    (_name, decode, row) => {
      const { id: _id, ...missing } = row;
      expect(decode(missing)).toMatchObject({
        ok: false,
        error: { code: 'MISSING_FIELD' },
      });
      expect(decode({ ...row, id: null })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_NULL' },
      });
      expect(decode({ ...row, id: 42 })).toMatchObject({
        ok: false,
        error: { code: 'WRONG_TYPE' },
      });
      expect(
        decode({ ...row, id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_UUID' } });
      expect(decode(null)).toMatchObject({ ok: false });
      expect(decode(undefined)).toMatchObject({ ok: false });
      expect(decode({ ...row, unexpected: true })).toMatchObject({ ok: false });
    },
  );
  it.each(cases)(
    'should reject every omitted field of %s',
    (_name, decode, row) => {
      for (const field of Object.keys(row)) {
        const input = { ...row } as Record<string, unknown>;
        delete input[field];
        expect(decode(input)).toMatchObject({
          ok: false,
          error: { code: 'MISSING_FIELD' },
        });
      }
    },
  );
  it.each(cases)(
    'should reject invalid null for every required field of %s',
    (_name, decode, row) => {
      for (const [field, value] of Object.entries(row)) {
        if (value !== null)
          expect(decode({ ...row, [field]: null })).toMatchObject({
            ok: false,
          });
      }
    },
  );
  it.each([
    ['identityVersion', 'attention-domain-v2'],
    ['reducerVersion', 'attention-reducer-v2'],
    ['successPolicy', 'UNDECIDED'],
  ])('should reject incompatible epoch %s', (field, value) => {
    expect(decodeAttentionEpochRow({ ...epoch, [field]: value })).toMatchObject(
      { ok: false, error: { code: 'INCOMPATIBLE_VERSION' } },
    );
  });
  it('should reject unknown enum, kind and audit version', () => {
    expect(decodeAttentionEpochRow({ ...epoch, lifecycle: 'ENABLED' }).ok).toBe(
      false,
    );
    expect(
      decodeAttentionEffectRow({ ...inboundRows.effect, eventKind: 'ACCEPTED' })
        .ok,
    ).toBe(false);
    expect(
      decodeAttentionResponseIntentRow({
        ...responseRows.intent,
        format: 'TEXT',
      }).ok,
    ).toBe(false);
    expect(
      decodeAttentionTransitionAuditRow({
        ...inboundRows.canonicalAudit,
        resultVersion: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INCOMPATIBLE_VERSION' } });
    expect(
      decodeAttentionTransitionAuditRow({
        ...inboundRows.canonicalAudit,
        resultVersion: '1',
      }),
    ).toMatchObject({ ok: false, error: { code: 'WRONG_TYPE' } });
  });
  it.each([
    '9007199254740993',
    '9223372036854775808',
    '1234567890123456789012345678901234567890',
  ])('should preserve exact unbounded decimal %s', (revision) => {
    const rows = physicalRows(
      response(intent({ coveredRevision: revision })),
      pending(revision),
    );
    expect(
      unwrap(decodeAttentionResponseIntentRow(rows.intent)).coveredRevision,
    ).toBe(revision);
    expect(
      unwrap(decodeAttentionTransitionAuditRow(rows.canonicalAudit)).result
        .audit.before.revision,
    ).toBe(revision);
    const changed = physicalRows(inbound(), pending(revision));
    expect(
      unwrap(decodeAttentionTransitionAuditRow(changed.canonicalAudit)).result
        .audit.after.revision,
    ).toBe((BigInt(revision) + BigInt(1)).toString());
  });
  it.each([
    '01',
    '-1',
    '+1',
    '1.0',
    '1e3',
    ' 1',
    '1 ',
    '',
    '١',
    '00',
    '\n0',
    '0\n',
  ])('should reject noncanonical revision %j', (revision) => {
    expect(
      decodeAttentionResponseIntentRow({
        ...responseRows.intent,
        coveredRevision: revision,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REVISION' } });
  });
  it.each([1, BigInt(1), undefined])(
    'should reject revision coercion %s',
    (revision) => {
      expect(
        decodeAttentionResponseIntentRow({
          ...responseRows.intent,
          coveredRevision: revision,
        }),
      ).toMatchObject({ ok: false, error: { code: 'WRONG_TYPE' } });
    },
  );
  it.each([128, 1024, 16384])(
    'should enforce UTF-8 byte budget %i without truncation',
    (limit) => {
      const atLimit = '😀'.repeat(limit / 4);
      expect(unwrap(decodeAttentionValue(rowText(limit), atLimit))).toBe(
        atLimit,
      );
      expect(decodeAttentionValue(rowText(limit), `${atLimit}a`)).toMatchObject(
        { ok: false, error: { code: 'CAPACITY_EXCEEDED' } },
      );
    },
  );
  it('should enforce limits on actual identity, fingerprint and reference columns', () => {
    expect(
      decodeAttentionReceiptRow({
        ...inboundRows.canonicalReceipt,
        eventKey: 'é'.repeat(512),
      }).ok,
    ).toBe(true);
    expect(
      decodeAttentionReceiptRow({
        ...inboundRows.canonicalReceipt,
        eventKey: 'é'.repeat(513),
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPACITY_EXCEEDED' } });
    expect(
      decodeAttentionResponseIntentRow({
        ...responseRows.intent,
        intentId: 'é'.repeat(64),
      }).ok,
    ).toBe(true);
    expect(
      decodeAttentionResponseIntentRow({
        ...responseRows.intent,
        intentId: 'é'.repeat(65),
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPACITY_EXCEEDED' } });
    expect(
      decodeAttentionEffectRow({
        ...inboundRows.effect,
        fingerprint: 'a'.repeat(16385),
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPACITY_EXCEEDED' } });
    expect(
      decodeAttentionEpochRow({
        ...epoch,
        bootstrapReference: 'a'.repeat(16385),
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPACITY_EXCEEDED' } });
  });
  it.each(['\u0000', '\ud800', '\udc00'])(
    'should reject PostgreSQL-unrepresentable text %j',
    (value) => {
      expect(decodeAttentionValue(rowText(128), value).ok).toBe(false);
    },
  );
  it('should preserve timestamp microseconds and reject Date or invalid calendar input', () => {
    expect(unwrap(decodeAttentionEpochRow(epoch)).createdAt).toBe(timestamp);
    for (const createdAt of [
      new Date(),
      '2026-02-30 00:00:00+00',
      '2026-10-21T00:00:00.1234567Z',
      'infinity',
      '2026-10-21',
      '2026-10-21T24:00:00Z',
    ])
      expect(decodeAttentionEpochRow({ ...epoch, createdAt }).ok).toBe(false);
  });
  it('should validate baseline and lifecycle nullability', () => {
    expect(
      decodeAttentionEpochRow({ ...epoch, bootstrapStatus: 'PENDING' }).ok,
    ).toBe(false);
    expect(
      decodeAttentionEpochRow({ ...epoch, bootstrapRevision: '1' }).ok,
    ).toBe(false);
    expect(decodeAttentionEpochRow({ ...epoch, activatedAt: null }).ok).toBe(
      false,
    );
    expect(decodeAttentionEpochRow({ ...epoch, lifecycle: 'CLOSED' }).ok).toBe(
      false,
    );
    expect(
      decodeAttentionEpochRow({
        ...epoch,
        lifecycle: 'PREPARING',
        activatedAt: null,
      }).ok,
    ).toBe(true);
    expect(
      decodeAttentionEpochRow({ ...epoch, lifecycle: 'SUSPENDED' }).ok,
    ).toBe(true);
    expect(
      decodeAttentionEpochRow({
        ...epoch,
        lifecycle: 'CLOSED',
        closedAt: timestamp,
      }).ok,
    ).toBe(true);
  });
  it.each(['HUMAN', 'AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should decode historical provenance %s',
    (kind) => {
      const actorWorkspaceMemberId = kind === 'HUMAN' ? identifier(12) : null;
      expect(
        decodeAttentionResponseIntentRow({
          ...responseRows.intent,
          provenanceKind: kind,
          actorWorkspaceMemberId,
        }).ok,
      ).toBe(true);
      expect(
        decodeAttentionResponseIntentRow({
          ...responseRows.intent,
          provenanceKind: kind,
          actorWorkspaceMemberId:
            actorWorkspaceMemberId === null ? identifier(12) : null,
        }).ok,
      ).toBe(false);
    },
  );
  it('should decode canonical, alias, IGNORED and unconsumed CONFLICT audits', () => {
    expect(
      decodeAttentionTransitionAuditRow(aliasRows().originalAudit).ok,
    ).toBe(true);
    const read: AttentionEventForRead = {
      kind: 'MESSAGES_READ',
      scope,
      eventKey: 'read',
      actorWorkspaceMemberId: identifier(12),
    };
    expect(
      unwrap(
        decodeAttentionTransitionAuditRow(physicalRows(read).canonicalAudit),
      ).result.kind,
    ).toBe('IGNORED');
    const conflict = physicalRows(evidence(), pending());
    expect(
      unwrap(decodeAttentionTransitionAuditRow(conflict.canonicalAudit)).result,
    ).toMatchObject({ kind: 'CONFLICT', reason: 'RESPONSE_INTENT_NOT_FOUND' });
    expect(
      decodeAttentionTransitionAuditRow(evidenceRows.canonicalAudit).ok,
    ).toBe(true);
  });
  it('should reject impossible results and contradictory audit identities', () => {
    const row = inboundRows.canonicalAudit;
    for (const result of [
      { ...row.result, kind: 'IGNORED' },
      { ...row.result, reason: 'HUMAN_RESPONSE_CONFIRMED' },
      {
        ...row.result,
        audit: { ...row.result.audit, attentionChanged: false },
      },
      {
        ...row.result,
        audit: {
          ...row.result.audit,
          after: { status: 'PENDING', revision: '4' },
        },
      },
      {
        ...row.result,
        audit: { ...row.result.audit, actorWorkspaceMemberId: identifier(12) },
      },
    ])
      expect(
        decodeAttentionTransitionAuditRow({ ...row, result }),
      ).toMatchObject({ ok: false, error: { code: 'IMPOSSIBLE_RESULT' } });
    expect(
      decodeAttentionTransitionAuditRow({ ...row, eventKey: 'other' }).ok,
    ).toBe(false);
    expect(
      decodeAttentionTransitionAuditRow({
        ...row,
        workspaceId: identifier(99),
      }),
    ).toMatchObject({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
    expect(
      decodeAttentionTransitionAuditRow({
        ...row,
        result: JSON.stringify(row.result),
      }),
    ).toMatchObject({ ok: false, error: { code: 'WRONG_TYPE' } });
    expect(
      decodeAttentionTransitionAuditRow({
        ...evidenceRows.canonicalAudit,
        correlationReference: null,
      }).ok,
    ).toBe(false);
  });
  it('should validate Conversation tuple and related-row projection decoders', () => {
    const conversation = {
      id: scope.conversationId,
      workspaceId: scope.workspaceId,
      providerConnectionId: scope.providerConnectionId,
      attentionTrackingEpochId: scope.trackingEpochId,
      attentionStatus: 'ATTENDED',
      attentionRevision: '0',
      pendingAt: null,
    };
    expect(decodeAttentionConversationColumns(conversation).ok).toBe(true);
    expect(
      decodeAttentionConversationColumns({
        ...conversation,
        attentionRevision: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INCOMPLETE_DATA' } });
    expect(
      decodeAttentionConversationColumns({
        ...conversation,
        attentionStatus: 'PENDING',
      }).ok,
    ).toBe(false);
    expect(decodeAttentionMessageColumns(inboundRows.message).ok).toBe(true);
    expect(
      decodeAttentionMessageColumns({
        ...inboundRows.message,
        direction: 'OUTBOUND',
      }).ok,
    ).toBe(false);
    expect(
      decodeAttentionProviderStatusColumns(evidenceRows.providerStatus).ok,
    ).toBe(true);
    expect(
      decodeAttentionProviderStatusColumns({
        ...evidenceRows.providerStatus,
        normalizedStatus: 'ACCEPTED',
      }).ok,
    ).toBe(false);
    expect(decodeAttentionWebhookColumns(evidenceRows.webhook).ok).toBe(true);
  });
});

type AttentionEventForRead = Extract<
  import('src/modules/inconnect-messaging/attention-domain').AttentionEvent,
  { kind: 'MESSAGES_READ' }
>;
