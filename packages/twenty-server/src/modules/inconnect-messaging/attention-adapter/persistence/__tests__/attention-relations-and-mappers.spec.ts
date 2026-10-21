import {
  evaluateAttentionProjection,
  planAttentionProjection,
  reconstructAttentionProjection,
} from 'src/modules/inconnect-messaging/attention-adapter';
import {
  mapAttentionEffect,
  mapAttentionIntent,
  mapAttentionReceipt,
  mapAttentionSnapshot,
  validateAttentionEffectRelations,
  validateAttentionReceiptRelations,
  validateAttentionIntentRelations,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence';
import {
  type AttentionEvent,
  type AttentionStatus,
  type ConversationAttentionState,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  aliasRows,
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

const conversation = (status: 'PENDING' | 'ATTENDED', revision: string) => ({
  id: scope.conversationId,
  workspaceId: scope.workspaceId,
  providerConnectionId: scope.providerConnectionId,
  attentionTrackingEpochId: scope.trackingEpochId,
  attentionStatus: status,
  attentionRevision: revision,
  pendingAt: status === 'PENDING' ? timestamp : null,
});
const value = <TValue>(
  result: { ok: true; value: TValue } | { ok: false; error: unknown },
): TValue => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const attendedAction = (
  observedRevision = '0',
): Extract<AttentionEvent, { kind: 'MANUAL_ACTION' }> => ({
  kind: 'MANUAL_ACTION',
  scope,
  eventKey: 'attended',
  intentId: 'manual-intent',
  actorWorkspaceMemberId: identifier(12),
  action: 'ATTENDED',
  observedRevision,
});

const aliasHistory = (
  event: AttentionEvent,
  before: ConversationAttentionState,
  aliasSnapshot?: Pick<ConversationAttentionState, 'status' | 'revision'>,
) => {
  const rows = physicalRows(event, before);
  const aliasEvent = { ...event, eventKey: `${event.eventKey}:alias` };
  // A reducer witness can be locally possible while contradicting supplied rows.
  const { state: _state, ...result } = apply(
    { ...rows.transition.state, ...aliasSnapshot },
    aliasEvent,
  );
  const originalAudit = {
    ...rows.canonicalAudit,
    id: identifier(32),
    eventKey: aliasEvent.eventKey,
    result,
  };
  const receipt = {
    ...rows.canonicalReceipt,
    id: identifier(31),
    eventKey: aliasEvent.eventKey,
    originalAuditId: originalAudit.id,
  };
  return { ...rows, aliasEvent, receipt, originalAudit };
};

describe('alias historical revision consistency', () => {
  it.each([
    [
      'A: canonical after contradiction',
      inbound(),
      initial(),
      'ATTENDED',
      '1',
      false,
    ],
    [
      'B: baseline contradiction',
      attendedAction(),
      initial(),
      'PENDING',
      '0',
      false,
    ],
    ['C: matching canonical after', inbound(), initial(), 'PENDING', '1', true],
    [
      'E: matching IGNORED revision',
      attendedAction(),
      initial(),
      'ATTENDED',
      '0',
      true,
    ],
    [
      'F: contradictory IGNORED revision',
      attendedAction('1'),
      { ...initial(), revision: '1' },
      'PENDING',
      '1',
      false,
    ],
    [
      'canonical before contradiction',
      inbound(),
      pending(),
      'ATTENDED',
      '1',
      false,
    ],
  ] as const)(
    'should validate %s',
    (_label, event, before, status, revision, accepted) => {
      const rows = aliasHistory(event, before, { status, revision });
      for (const result of [
        validateAttentionReceiptRelations(rows),
        mapAttentionReceipt(rows),
      ]) {
        if (accepted) expect(result.ok).toBe(true);
        else
          expect(result).toMatchObject({
            ok: false,
            error: { code: 'IMPOSSIBLE_RESULT' },
          });
      }
    },
  );

  it('should match an independent revision-to-status oracle for supplied facts', () => {
    const revisions = [
      '0',
      '1',
      '9',
      '10',
      '9223372036854775808',
      '9223372036854775809',
    ];
    for (const canonicalRevision of revisions) {
      const before = { ...initial(), revision: canonicalRevision };
      for (const revision of revisions) {
        for (const status of ['PENDING', 'ATTENDED'] as const) {
          const rows = aliasHistory(attendedAction(canonicalRevision), before, {
            status,
            revision,
          });
          const statesByRevision = new Map<bigint, Set<AttentionStatus>>();
          for (const state of [
            {
              status: epoch.bootstrapStatus,
              revision: epoch.bootstrapRevision,
            },
            rows.canonicalAudit.result.audit.before,
            rows.canonicalAudit.result.audit.after,
            rows.originalAudit.result.audit.before,
            rows.originalAudit.result.audit.after,
          ]) {
            const key = BigInt(state.revision);
            const statuses =
              statesByRevision.get(key) ?? new Set<AttentionStatus>();
            statuses.add(state.status);
            statesByRevision.set(key, statuses);
          }
          const consistent = [...statesByRevision.values()].every(
            (statuses) => statuses.size === 1,
          );
          const chronological = BigInt(revision) >= BigInt(canonicalRevision);
          const result = validateAttentionReceiptRelations(rows);
          expect({
            canonicalRevision,
            revision,
            status,
            accepted: result.ok,
          }).toEqual({
            canonicalRevision,
            revision,
            status,
            accepted: consistent && chronological,
          });
          if (!consistent || !chronological)
            expect(result).toMatchObject({
              ok: false,
              error: { code: 'IMPOSSIBLE_RESULT' },
            });
        }
      }
    }
  });

  it('should reject a contradictory alias before producing a C1 receipt fact (G)', () => {
    const rows = aliasHistory(inbound(), initial(), {
      status: 'ATTENDED',
      revision: '1',
    });
    expect(mapAttentionEffect(rows).ok).toBe(true);
    const receipt = mapAttentionReceipt(rows);
    expect(receipt).toMatchObject({
      ok: false,
      error: { code: 'IMPOSSIBLE_RESULT' },
    });
    expect(receipt).not.toHaveProperty('value');
  });

  it.each(['APPLIED', 'IGNORED'] as const)(
    'should recover separate alias and %s originals in C1 after a legitimate closure (D/H)',
    (kind) => {
      const event = kind === 'APPLIED' ? inbound() : attendedAction();
      const canonical = apply(initial(), event);
      const opened =
        kind === 'APPLIED'
          ? canonical.state
          : apply(canonical.state, inbound()).state;
      const later = apply(opened, {
        ...attendedAction('1'),
        eventKey: 'later-closure',
        intentId: 'later-intent',
      });
      expect(later).toMatchObject({
        kind: 'APPLIED',
        state: { status: 'ATTENDED', revision: '2' },
      });
      const rows = aliasHistory(event, initial(), later.state);
      const eventReceipt = unwrap(mapAttentionReceipt(rows));
      const effect = unwrap(mapAttentionEffect(rows));
      const snapshot = unwrap(
        mapAttentionSnapshot(conversation('ATTENDED', '2'), epoch),
      );
      const plan = value(
        planAttentionProjection(snapshot, { scope, event: rows.aliasEvent }),
      );
      const evaluation = value(
        evaluateAttentionProjection(plan, {
          eventReceipt,
          effect,
          intent: null,
        }),
      );
      expect(evaluation.transition).toMatchObject({
        kind: 'DUPLICATE',
        reason: 'SAME_EVENT',
      });
      expect(evaluation.recovered?.eventResult).toEqual(
        rows.originalAudit.result,
      );
      expect(evaluation.recovered?.eventResult).toMatchObject({
        kind: 'DUPLICATE',
        audit: {
          before: { status: 'ATTENDED', revision: '2' },
          after: { status: 'ATTENDED', revision: '2' },
        },
      });
      expect(evaluation.recovered?.effectResult).toEqual(
        rows.canonicalAudit.result,
      );
      expect(evaluation.recovered?.effectResult?.kind).toBe(kind);
      expect(evaluation.delta).toMatchObject({
        effect: null,
        receipt: null,
        intent: null,
      });
    },
  );
});

describe('attention explicit relational validation', () => {
  it('should validate the canonical pair and expose unproved physical obligations', () => {
    const report = unwrap(validateAttentionEffectRelations(physicalRows()));
    expect(report.checked).toContain('CANONICAL_ORIGINAL');
    expect(report.unresolved).toEqual(
      expect.arrayContaining([
        'POSTGRESQL_CONSTRAINTS',
        'TRANSACTIONAL_COMPLETENESS',
        'CURRENT_AUTHORITY',
      ]),
    );
  });
  it.each(['epoch', 'effect', 'canonicalReceipt', 'canonicalAudit', 'message'])(
    'should fail incomplete %s without manufacturing absence',
    (field) => {
      expect(
        mapAttentionEffect({ ...physicalRows(), [field]: undefined }),
      ).toMatchObject({ ok: false, error: { code: 'INCOMPLETE_DATA' } });
    },
  );
  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ])('should reject cross-scope %s in every ledger dependent', (field) => {
    const rows = aliasRows();
    for (const dependent of ['effect', 'canonicalReceipt', 'receipt'] as const)
      expect(
        mapAttentionReceipt({
          ...rows,
          [dependent]: { ...rows[dependent], [field]: identifier(99) },
        }),
      ).toMatchObject({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
    const responseRows = physicalRows(response(), pending());
    expect(
      mapAttentionIntent({
        ...responseRows,
        intent: { ...responseRows.intent, [field]: identifier(99) },
      }),
    ).toMatchObject({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
  });
  it('should reject wrong canonical receipt, effect and original audit references', () => {
    const rows = aliasRows();
    for (const changed of [
      {
        ...rows,
        effect: { ...rows.effect, canonicalReceiptId: identifier(99) },
      },
      {
        ...rows,
        canonicalReceipt: {
          ...rows.canonicalReceipt,
          effectId: identifier(99),
        },
      },
      { ...rows, receipt: { ...rows.receipt, effectId: identifier(99) } },
      {
        ...rows,
        receipt: { ...rows.receipt, originalAuditId: identifier(99) },
      },
      { ...rows, canonicalAudit: rows.originalAudit },
    ])
      expect(validateAttentionReceiptRelations(changed).ok).toBe(false);
  });
  it('should retain individual alias original and reject canonical/alias substitution', () => {
    const rows = aliasRows();
    expect(unwrap(mapAttentionReceipt(rows)).original.kind).toBe('DUPLICATE');
    expect(unwrap(mapAttentionEffect(rows)).original.kind).toBe('APPLIED');
    expect(
      mapAttentionReceipt({ ...rows, originalAudit: rows.canonicalAudit }).ok,
    ).toBe(false);
    expect(
      mapAttentionEffect({ ...rows, canonicalAudit: rows.originalAudit }).ok,
    ).toBe(false);
  });
  it('should reject conflict audits as consumed originals', () => {
    const rows = physicalRows(evidence(), pending());
    expect(rows.canonicalAudit.result.kind).toBe('CONFLICT');
    expect(mapAttentionEffect(rows)).toMatchObject({ ok: false });
  });
  it('should enforce intent registration, message identity and immutable provenance', () => {
    const rows = physicalRows(response(), pending());
    expect(unwrap(validateAttentionIntentRelations(rows)).checked).toContain(
      'INTENT_REGISTRATION_LINK',
    );
    expect(unwrap(mapAttentionIntent(rows)).intent).toEqual(intent());
    for (const overrides of [
      { registeredEffectId: identifier(99) },
      { messageId: identifier(99) },
      { coveredRevision: '0' },
      { contentFingerprint: 'different-content' },
      { format: 'FREEFORM' },
      { authorityReference: 'changed-authority' },
      { actorWorkspaceMemberId: identifier(99) },
      { provenanceKind: 'AUTOMATION', actorWorkspaceMemberId: null },
    ])
      expect(
        mapAttentionIntent({
          ...rows,
          intent: { ...rows.intent, ...overrides },
        }).ok,
      ).toBe(false);
    expect(
      mapAttentionIntent({
        ...rows,
        message: { ...rows.message, sendMode: 'FREEFORM' },
      }).ok,
    ).toBe(false);
  });
  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'attentionTrackingEpochId',
  ])('should reject wrong Message %s', (field) => {
    const rows = physicalRows(response(), pending());
    expect(
      mapAttentionIntent({
        ...rows,
        message: { ...rows.message, [field]: identifier(99) },
      }),
    ).toMatchObject({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
  });
  it('should validate evidence against exact Message, status event and webhook connection', () => {
    const rows = physicalRows(evidence(), apply(pending(), response()).state);
    const report = unwrap(validateAttentionEffectRelations(rows));
    expect(report.checked).toContain(
      'PROVIDER_STATUS_MESSAGE_AND_NORMALIZED_STATUS',
    );
    expect(report.unresolved).toContain('EVIDENCE_ID_BINDING');
    expect(report.unresolved).toContain('INTENT_REGISTRATION_LINK');
    for (const changed of [
      {
        ...rows,
        message: {
          ...rows.message,
          providerMessageId: 'another-provider-message',
        },
      },
      {
        ...rows,
        providerStatus: { ...rows.providerStatus, messageId: identifier(99) },
      },
      {
        ...rows,
        providerStatus: { ...rows.providerStatus, id: identifier(99) },
      },
      {
        ...rows,
        providerStatus: { ...rows.providerStatus, normalizedStatus: 'READ' },
      },
      {
        ...rows,
        webhook: { ...rows.webhook, providerConnectionId: identifier(99) },
      },
      { ...rows, webhook: undefined },
      { ...rows, intent: undefined },
    ])
      expect(mapAttentionEffect(changed).ok).toBe(false);
  });
  it('should accept JSONB property reordering without changing identity bytes', () => {
    const rows = physicalRows(response(), pending());
    const audit = rows.canonicalAudit;
    const reordered = Object.fromEntries(
      Object.entries(audit.result.audit).reverse(),
    );
    expect(
      mapAttentionIntent({
        ...rows,
        canonicalAudit: {
          ...audit,
          result: {
            audit: reordered,
            reason: audit.result.reason,
            kind: audit.result.kind,
          },
        },
      }).ok,
    ).toBe(true);
    expect(
      mapAttentionEffect({
        ...rows,
        effect: { ...rows.effect, fingerprint: `${rows.effect.fingerprint} ` },
      }).ok,
    ).toBe(false);
  });
  it('should require baseline agreement without treating legacy null as an empty ledger', () => {
    expect(
      unwrap(mapAttentionSnapshot(conversation('ATTENDED', '0'), epoch))
        .revision,
    ).toBe('0');
    expect(
      mapAttentionSnapshot(conversation('PENDING', '0'), epoch),
    ).toMatchObject({ ok: false, error: { code: 'IMPOSSIBLE_RESULT' } });
    expect(
      mapAttentionSnapshot(
        {
          ...conversation('ATTENDED', '0'),
          attentionTrackingEpochId: null,
          attentionStatus: null,
          attentionRevision: null,
        },
        epoch,
      ),
    ).toMatchObject({ ok: false, error: { code: 'INCOMPLETE_DATA' } });
    expect(
      mapAttentionSnapshot(conversation('PENDING', '0'), {
        ...epoch,
        bootstrapStatus: 'PENDING',
        bootstrapPendingAt: timestamp,
      }).ok,
    ).toBe(true);
    expect(
      mapAttentionSnapshot(
        { ...conversation('ATTENDED', '0'), workspaceId: identifier(99) },
        epoch,
      ),
    ).toMatchObject({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
  });
});

describe('physical mappings with real C1 projection and reducer', () => {
  it('should preserve an IGNORED canonical effect and its later DUPLICATE alias', () => {
    const event: AttentionEvent = {
      kind: 'MANUAL_ACTION',
      scope,
      eventKey: 'attended',
      intentId: 'manual-intent',
      actorWorkspaceMemberId: identifier(12),
      action: 'ATTENDED',
      observedRevision: '0',
    };
    const rows = physicalRows(event);
    const later = apply(rows.transition.state, inbound()).state;
    const aliasEvent = { ...event, eventKey: 'attended-alias' };
    const { state: _state, ...result } = apply(later, aliasEvent);
    const originalAudit = {
      ...rows.canonicalAudit,
      id: identifier(32),
      eventKey: aliasEvent.eventKey,
      result,
    };
    const receipt = {
      ...rows.canonicalReceipt,
      id: identifier(31),
      eventKey: aliasEvent.eventKey,
      originalAuditId: originalAudit.id,
    };
    const facts = {
      effect: unwrap(mapAttentionEffect(rows)),
      eventReceipt: unwrap(
        mapAttentionReceipt({ ...rows, receipt, originalAudit }),
      ),
      intent: null,
    };
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
    );
    const plan = value(
      planAttentionProjection(snapshot, { scope, event: aliasEvent }),
    );
    expect(plan.identity.effectId).not.toBe(rows.effect.id);
    const evaluation = value(evaluateAttentionProjection(plan, facts));
    expect(evaluation.transition).toMatchObject({
      kind: 'DUPLICATE',
      state: { status: 'PENDING', revision: '1' },
    });
    expect(evaluation.recovered?.effectResult).toMatchObject({
      kind: 'IGNORED',
      reason: 'ALREADY_ATTENDED',
    });
    expect(evaluation.recovered?.eventResult).toMatchObject({
      kind: 'DUPLICATE',
      audit: { before: { revision: '1' } },
    });
  });
  it('should recover APPLIED canonical and DUPLICATE alias originals separately', () => {
    const rows = aliasRows();
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
    );
    const plan = value(
      planAttentionProjection(snapshot, { scope, event: rows.aliasEvent }),
    );
    const facts = {
      eventReceipt: unwrap(mapAttentionReceipt(rows)),
      effect: unwrap(mapAttentionEffect(rows)),
      intent: null,
    };
    const reconstructed = value(reconstructAttentionProjection(plan, facts));
    expect(reconstructed.receipts).toHaveLength(2);
    const evaluation = value(evaluateAttentionProjection(plan, facts));
    expect(evaluation.transition).toMatchObject({
      kind: 'DUPLICATE',
      reason: 'SAME_EVENT',
    });
    expect(evaluation.recovered?.eventResult).toEqual(
      rows.originalAudit.result,
    );
    expect(evaluation.recovered?.effectResult).toEqual(
      rows.canonicalAudit.result,
    );
    expect(evaluation.delta).toMatchObject({
      effect: null,
      receipt: null,
      intent: null,
    });
  });
  it('should map a new alias and preserve its own original after later revisions', () => {
    const rows = aliasRows();
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '2'), epoch),
    );
    const plan = value(
      planAttentionProjection(snapshot, {
        scope,
        event: { ...inbound(), eventKey: 'another-alias' },
      }),
    );
    // null here is an explicit test premise, never output from the physical mapper.
    const evaluation = value(
      evaluateAttentionProjection(plan, {
        eventReceipt: null,
        effect: unwrap(mapAttentionEffect(rows)),
        intent: null,
      }),
    );
    expect(evaluation.transition).toMatchObject({
      kind: 'DUPLICATE',
      reason: 'SAME_INTENTION_OR_EVIDENCE',
    });
    expect(evaluation.recovered?.eventResult).toBeNull();
    expect(evaluation.recovered?.effectResult?.audit.after.revision).toBe('1');
    expect(evaluation.delta.receipt?.original.audit.before.revision).toBe('2');
    expect(
      unwrap(mapAttentionReceipt(rows)).original.audit.before.revision,
    ).toBe('1');
  });
  it('should leave contradictory fingerprints as C1 CONFLICT without consuming keys', () => {
    const rows = physicalRows(response(), pending());
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
    );
    const event = response(intent({ contentFingerprint: 'changed' }));
    const plan = value(planAttentionProjection(snapshot, { scope, event }));
    const effect = unwrap(mapAttentionEffect(rows));
    const eventReceipt = unwrap(
      mapAttentionReceipt({
        ...rows,
        receipt: rows.canonicalReceipt,
        originalAudit: rows.canonicalAudit,
      }),
    );
    const evaluation = value(
      evaluateAttentionProjection(plan, {
        eventReceipt,
        effect,
        intent: unwrap(mapAttentionIntent(rows)),
      }),
    );
    expect(evaluation.transition).toMatchObject({
      kind: 'CONFLICT',
      reason: 'IDEMPOTENCY_CONFLICT',
    });
    expect(evaluation.delta).toMatchObject({
      effect: null,
      receipt: null,
      intent: null,
    });
  });
  it('should preserve eventKey pointing to another effect as a semantic conflict', () => {
    const rows = physicalRows();
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
    );
    const event: AttentionEvent = {
      ...inbound(),
      messageId: identifier(99),
    } as AttentionEvent;
    const plan = value(planAttentionProjection(snapshot, { scope, event }));
    const evaluation = value(
      evaluateAttentionProjection(plan, {
        effect: null,
        intent: null,
        eventReceipt: unwrap(
          mapAttentionReceipt({
            ...rows,
            receipt: rows.canonicalReceipt,
            originalAudit: rows.canonicalAudit,
          }),
        ),
      }),
    );
    expect(evaluation.transition.reason).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('should keep IGNORED consumed and repeated aliases idempotent', () => {
    const event: AttentionEvent = {
      scope,
      kind: 'MESSAGES_READ',
      eventKey: 'personal-read',
      actorWorkspaceMemberId: identifier(12),
    };
    const rows = physicalRows(event);
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('ATTENDED', '0'), epoch),
    );
    const plan = value(planAttentionProjection(snapshot, { scope, event }));
    const evaluation = value(
      evaluateAttentionProjection(plan, {
        eventReceipt: unwrap(
          mapAttentionReceipt({
            ...rows,
            receipt: rows.canonicalReceipt,
            originalAudit: rows.canonicalAudit,
          }),
        ),
        effect: unwrap(mapAttentionEffect(rows)),
        intent: null,
      }),
    );
    expect(evaluation.transition.kind).toBe('DUPLICATE');
    expect(evaluation.recovered?.effectResult?.kind).toBe('IGNORED');
  });
  it('should recover frozen intent without broadening its revision on retry', () => {
    const revision = '9223372036854775808';
    const rows = physicalRows(
      response(intent({ coveredRevision: revision })),
      pending(revision),
    );
    const snapshot = unwrap(
      mapAttentionSnapshot(
        conversation('PENDING', (BigInt(revision) + BigInt(1)).toString()),
        epoch,
      ),
    );
    const plan = value(
      planAttentionProjection(snapshot, {
        scope,
        event: response(intent({ coveredRevision: revision })),
      }),
    );
    const evaluation = value(
      evaluateAttentionProjection(plan, {
        eventReceipt: unwrap(
          mapAttentionReceipt({
            ...rows,
            receipt: rows.canonicalReceipt,
            originalAudit: rows.canonicalAudit,
          }),
        ),
        effect: unwrap(mapAttentionEffect(rows)),
        intent: unwrap(mapAttentionIntent(rows)),
      }),
    );
    expect(evaluation.transition.kind).toBe('DUPLICATE');
    expect(evaluation.transition.state.responseIntents[0].coveredRevision).toBe(
      revision,
    );
    expect(evaluation.delta.intent).toBeNull();
  });
  it.each(['HUMAN', 'AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should preserve %s TEMPLATE behavior under approved C1 policy',
    (kind) => {
      const provenance =
        kind === 'HUMAN'
          ? intent().provenance
          : { kind, authorityReference: 'historical-authority' };
      const responseIntent = intent({ provenance });
      const rows = physicalRows(response(responseIntent), pending());
      const snapshot = unwrap(
        mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
      );
      const plan = value(
        planAttentionProjection(snapshot, { scope, event: evidence() }),
      );
      const evaluation = value(
        evaluateAttentionProjection(plan, {
          eventReceipt: null,
          effect: null,
          intent: unwrap(mapAttentionIntent(rows)),
        }),
      );
      const full = apply(
        apply(pending(), response(responseIntent)).state,
        evidence(),
      );
      expect({
        ...evaluation.transition,
        state: {
          ...evaluation.transition.state,
          receipts: [
            ...rows.transition.state.receipts,
            ...evaluation.transition.state.receipts,
          ],
        },
      }).toEqual(full);
      expect(evaluation.transition.kind).toBe(
        kind === 'HUMAN' ? 'APPLIED' : 'IGNORED',
      );
      expect(evaluation.transition.state.status).toBe(
        kind === 'HUMAN' ? 'ATTENDED' : 'PENDING',
      );
    },
  );
  it.each(['SENT', 'FAILED', 'UNKNOWN'] as const)(
    'should never close automatically on %s',
    (status) => {
      const rows = physicalRows(response(), pending());
      const snapshot = unwrap(
        mapAttentionSnapshot(conversation('PENDING', '1'), epoch),
      );
      const plan = value(
        planAttentionProjection(snapshot, { scope, event: evidence(status) }),
      );
      expect(
        value(
          evaluateAttentionProjection(plan, {
            eventReceipt: null,
            effect: null,
            intent: unwrap(mapAttentionIntent(rows)),
          }),
        ).transition,
      ).toMatchObject({
        kind: 'IGNORED',
        reason: 'INSUFFICIENT_PROVIDER_EVIDENCE',
      });
    },
  );
  it('should reject old delivered coverage after a new inbound', () => {
    const rows = physicalRows(response(), pending());
    const snapshot = unwrap(
      mapAttentionSnapshot(conversation('PENDING', '2'), epoch),
    );
    const plan = value(
      planAttentionProjection(snapshot, { scope, event: evidence() }),
    );
    expect(
      value(
        evaluateAttentionProjection(plan, {
          eventReceipt: null,
          effect: null,
          intent: unwrap(mapAttentionIntent(rows)),
        }),
      ).transition,
    ).toMatchObject({
      kind: 'IGNORED',
      reason: 'REVISION_NOT_CURRENT',
      state: { revision: '2', status: 'PENDING' },
    });
  });
});
