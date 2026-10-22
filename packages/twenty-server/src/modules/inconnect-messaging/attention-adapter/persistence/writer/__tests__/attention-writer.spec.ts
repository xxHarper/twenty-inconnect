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
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  manual,
  runWriter,
  writerScript,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import * as sql from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';

jest.mock('node:crypto', () => ({ randomUUID: jest.fn() }));

const writes = (calls: { sql: string }[]) =>
  calls.filter((call) => call.sql.startsWith('WITH written'));

describe('source-only transactional attention writer', () => {
  it('should prepare new inbound with a complete canonical aggregate and exact C/S parameters', async () => {
    const scenario = writerScript();
    const { result, harness } = await runWriter(scenario);
    expect(result).toMatchObject({
      ok: true,
      status: 'PREPARED',
      value: {
        outcome: scenario.outcome,
        rows: {
          auditId: scenario.ids.auditId,
          effectId: scenario.ids.effectId,
          receiptId: scenario.ids.receiptId,
          outboxId: scenario.ids.outboxId,
        },
      },
    });
    expect(writes(harness.calls).map((call) => call.sql)).toEqual([
      sql.ATTENTION_INSERT_EFFECT_SQL,
      sql.ATTENTION_INSERT_AUDIT_SQL,
      sql.ATTENTION_INSERT_RECEIPT_SQL,
      sql.ATTENTION_UPDATE_CONVERSATION_SQL,
      sql.ATTENTION_INSERT_OUTBOX_SQL,
    ]);
    if (result.ok) {
      expect(result.value.originals.eventResult).toEqual(scenario.outcome);
      expect(result.value.originals.effectResult).toEqual(scenario.outcome);
    }
  });
  it.each([
    [
      'pending renewal',
      manual('PENDING', '0'),
      pending(),
      'PENDING',
      '2',
      'APPLIED',
    ],
    [
      'manual close',
      manual('ATTENDED', '1'),
      pending(),
      'ATTENDED',
      '2',
      'APPLIED',
    ],
    [
      'manual stale',
      manual('ATTENDED', '0'),
      pending(),
      'PENDING',
      '1',
      'CONFLICT',
    ],
    [
      'manual future',
      manual('PENDING', '2'),
      pending(),
      'PENDING',
      '1',
      'CONFLICT',
    ],
    [
      'already attended',
      manual('ATTENDED', '0'),
      initial(),
      'ATTENDED',
      '0',
      'IGNORED',
    ],
    [
      'personal read',
      {
        kind: 'MESSAGES_READ',
        scope,
        eventKey: 'personal-read',
        actorWorkspaceMemberId: identifier(12),
      } as AttentionEvent,
      pending(),
      'PENDING',
      '1',
      'IGNORED',
    ],
  ] as const)(
    'should preserve real C1/reducer behavior for %s',
    async (_label, event, before, status, revision, kind) => {
      const scenario = writerScript(
        { event, current: conversation(before.status, before.revision) },
        before,
      );
      const { result, harness } = await runWriter(scenario);
      expect(result).toMatchObject({
        ok: true,
        value: { outcome: { kind }, snapshot: { status, revision } },
      });
      const expectedChanges = scenario.full.audit.attentionChanged;
      expect(
        harness.calls.some(
          (call) => call.sql === sql.ATTENTION_INSERT_OUTBOX_SQL,
        ),
      ).toBe(expectedChanges);
      if (kind === 'CONFLICT')
        expect(writes(harness.calls).map((call) => call.sql)).toEqual([
          sql.ATTENTION_INSERT_AUDIT_SQL,
        ]);
    },
  );
  it.each(['FREEFORM', 'TEMPLATE'] as const)(
    'should freeze an authenticated HUMAN %s intention with a cyclic registration',
    async (format) => {
      const event = response(intent({ format }));
      const scenario = writerScript(
        { event, current: conversation('PENDING', '1') },
        pending(),
      );
      const { result, harness } = await runWriter(scenario);
      expect(result).toMatchObject({
        ok: true,
        value: {
          outcome: { kind: 'APPLIED', reason: 'RESPONSE_REGISTERED' },
          snapshot: { revision: '1' },
          rows: { responseIntentId: scenario.ids.intentId, outboxId: null },
        },
      });
      expect(writes(harness.calls).map((call) => call.sql)).toEqual([
        sql.ATTENTION_INSERT_EFFECT_SQL,
        sql.ATTENTION_INSERT_AUDIT_SQL,
        sql.ATTENTION_INSERT_RECEIPT_SQL,
        sql.ATTENTION_INSERT_INTENT_SQL,
      ]);
    },
  );
  it.each(['AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should persist %s TEMPLATE without assigning HUMAN',
    async (kind) => {
      const event = response(
        intent({
          provenance: { kind, authorityReference: 'authorized-operation' },
        }),
      );
      const scenario = writerScript(
        { event, current: conversation('PENDING', '1') },
        pending(),
      );
      expect((await runWriter(scenario)).result).toMatchObject({
        ok: true,
        value: { outcome: { audit: { provenance: { kind } } } },
      });
    },
  );
  it.each(['DELIVERED', 'READ', 'SENT', 'FAILED', 'UNKNOWN'] as const)(
    'should preserve HUMAN evidence %s through the real reducer',
    async (status) => {
      const registration = physicalRows(response(), pending());
      const event = evidence(status);
      const before = registration.transition.state;
      const scenario = writerScript(
        {
          event,
          current: conversation('PENDING', '1'),
          intent: registration.intent!,
          bundles: { [registration.effect.id]: bundle(registration) },
        },
        before,
      );
      const { result } = await runWriter(scenario);
      expect(result).toMatchObject({
        ok: true,
        value: {
          outcome: scenario.outcome,
          snapshot: {
            status:
              status === 'DELIVERED' || status === 'READ'
                ? 'ATTENDED'
                : 'PENDING',
          },
        },
      });
    },
  );
  it.each(['AUTOMATION', 'LEGACY_UNKNOWN'] as const)(
    'should never close on delivered evidence of %s',
    async (kind) => {
      const registration = physicalRows(
        response(
          intent({
            provenance: { kind, authorityReference: 'backend-source' },
          }),
        ),
        pending(),
      );
      const scenario = writerScript(
        {
          event: evidence(),
          current: conversation('PENDING', '1'),
          intent: registration.intent!,
          bundles: { [registration.effect.id]: bundle(registration) },
        },
        registration.transition.state,
      );
      expect((await runWriter(scenario)).result).toMatchObject({
        ok: true,
        value: {
          outcome: { kind: 'IGNORED', reason: 'NON_HUMAN_RESPONSE' },
          snapshot: { status: 'PENDING' },
        },
      });
    },
  );
  it('should retain old frozen coverage after a later inbound', async () => {
    const registration = physicalRows(response(), pending());
    const before = apply(registration.transition.state, {
      ...inbound(),
      eventKey: 'later',
    }).state;
    const scenario = writerScript(
      {
        event: evidence(),
        current: conversation('PENDING', '2'),
        intent: registration.intent!,
        bundles: { [registration.effect.id]: bundle(registration) },
      },
      before,
    );
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: {
        outcome: { kind: 'IGNORED', reason: 'REVISION_NOT_CURRENT' },
        snapshot: { revision: '2' },
      },
    });
  });
  it('should preserve huge decimal arithmetic without int64 or Number', async () => {
    const revision = '922337203685477580812345678901234567890999999999999';
    const before = pending(revision);
    const scenario = writerScript(
      { current: conversation('PENDING', revision) },
      before,
    );
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          revision: '922337203685477580812345678901234567891000000000000',
        },
      },
    });
  });
  it('should create only the alias Receipt and its own DUPLICATE original', async () => {
    const stored = physicalRows();
    const event = { ...inbound(), eventKey: 'new-alias' };
    const scenario = writerScript(
      {
        event,
        current: conversation('PENDING', '1'),
        effect: stored.effect,
        bundles: { [stored.effect.id]: bundle(stored) },
      },
      stored.transition.state,
    );
    const { result, harness } = await runWriter(scenario);
    expect(writes(harness.calls).map((call) => call.sql)).toEqual([
      sql.ATTENTION_INSERT_AUDIT_SQL,
      sql.ATTENTION_INSERT_RECEIPT_SQL,
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        originals: {
          eventResult: { kind: 'DUPLICATE' },
          effectResult: { kind: 'APPLIED' },
        },
      },
    });
  });
  it('should preserve alias original separately during replay after later changes', async () => {
    const rows = aliasRows();
    const before = {
      ...rows.transition.state,
      revision: '2',
      receipts: [
        ...rows.transition.state.receipts,
        {
          eventKey: rows.aliasEvent.eventKey,
          effectKey: rows.effect.effectKey,
          fingerprint: rows.effect.fingerprint,
        },
      ],
    };
    const scenario = writerScript(
      {
        event: rows.aliasEvent,
        current: conversation('PENDING', '2'),
        effect: rows.effect,
        receipt: rows.receipt,
        originalAudit: rows.originalAudit,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
      before,
    );
    const { result, harness } = await runWriter(scenario);
    expect(writes(harness.calls).map((call) => call.sql)).toEqual([
      sql.ATTENTION_INSERT_AUDIT_SQL,
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        originals: {
          eventResult: rows.originalAudit.result,
          effectResult: rows.canonicalAudit.result,
        },
      },
    });
  });
  it('should preserve an IGNORED canonical and its new alias', async () => {
    const event = manual('ATTENDED', '0');
    const stored = physicalRows(event);
    const scenario = writerScript(
      {
        event: { ...event, eventKey: 'ignored-alias' },
        effect: stored.effect,
        bundles: { [stored.effect.id]: bundle(stored) },
      },
      stored.transition.state,
    );
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: {
        originals: {
          effectResult: { kind: 'IGNORED' },
          eventResult: { kind: 'DUPLICATE' },
        },
      },
    });
  });
  it('should preserve canonical original on exact replay', async () => {
    const stored = physicalRows();
    const scenario = writerScript(
      {
        current: conversation('PENDING', '1'),
        effect: stored.effect,
        receipt: stored.canonicalReceipt,
        originalAudit: stored.canonicalAudit,
        bundles: { [stored.effect.id]: bundle(stored) },
      },
      stored.transition.state,
    );
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: {
        originals: {
          eventResult: stored.canonicalAudit.result,
          effectResult: stored.canonicalAudit.result,
        },
      },
    });
  });
  it('should audit a consumed intention collision without reserving domain keys', async () => {
    const registration = physicalRows(response(), pending());
    const event = {
      ...response(intent({ contentFingerprint: 'changed' })),
      eventKey: 'collision',
    };
    const scenario = writerScript(
      {
        event,
        current: conversation('PENDING', '1'),
        effect: registration.effect,
        intent: registration.intent!,
        bundles: { [registration.effect.id]: bundle(registration) },
      },
      registration.transition.state,
    );
    const { result, harness } = await runWriter(scenario);
    expect(result).toMatchObject({
      ok: true,
      value: { outcome: { kind: 'CONFLICT', reason: 'IDEMPOTENCY_CONFLICT' } },
    });
    expect(writes(harness.calls).map((call) => call.sql)).toEqual([
      sql.ATTENTION_INSERT_AUDIT_SQL,
    ]);
  });
  it('should reject a second intention for the same Message without new ledger keys', async () => {
    const registration = physicalRows(response(), pending());
    const scenario = writerScript(
      {
        event: {
          ...response(intent({ intentId: 'other-intention' })),
          eventKey: 'other-response-event',
        },
        current: conversation('PENDING', '1'),
        intent: registration.intent!,
        bundles: { [registration.effect.id]: bundle(registration) },
      },
      registration.transition.state,
    );
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: {
        outcome: { kind: 'CONFLICT', reason: 'MESSAGE_IDENTITY_CONFLICT' },
      },
    });
  });
});
