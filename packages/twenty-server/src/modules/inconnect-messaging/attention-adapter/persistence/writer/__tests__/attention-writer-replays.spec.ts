import {
  aliasRows,
  apply,
  evidence,
  identifier,
  inbound,
  intent,
  pending,
  physicalRows,
  response,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  bundle,
  conversation,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { ATTENTION_ROOT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  runWriter,
  writerScript,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import * as sql from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';

jest.mock('node:crypto', () => ({ randomUUID: jest.fn() }));

const consumedEvidence = () => {
  const registration = physicalRows(response(), pending());
  const original = physicalRows(evidence(), registration.transition.state);
  const effect = {
    ...original.effect,
    id: identifier(40),
    canonicalReceiptId: identifier(41),
  };
  const canonicalAudit = { ...original.canonicalAudit, id: identifier(50) };
  const canonicalReceipt = {
    ...original.canonicalReceipt,
    id: identifier(41),
    effectId: effect.id,
    originalAuditId: canonicalAudit.id,
  };
  const stored = {
    ...original,
    effect,
    canonicalAudit,
    canonicalReceipt,
    intent: registration.intent,
  };
  return { registration, stored };
};

describe('historical originals, consumption and immutable caller inputs', () => {
  it('should prepare an evidence alias using retained StatusEvent without fresh outbound admission', async () => {
    const { registration, stored } = consumedEvidence();
    const event = { ...evidence(), eventKey: 'new-receipt-for-old-evidence' };
    const scenario = writerScript(
      {
        event,
        current: conversation('ATTENDED', '2'),
        effect: stored.effect,
        intent: registration.intent!,
        bundles: {
          [stored.effect.id]: bundle(stored, registration),
          [registration.effect.id]: bundle(registration),
        },
      },
      stored.transition.state,
    );
    // This is ledger recovery, without a newly claimed inbound receipt. The
    // original historical webhook is retained and checked by the real C2-II.
    Object.assign(scenario.cause, { webhook: null });
    const webhookIndex = scenario.steps.findIndex(
      (step) => step.sql === sql.ATTENTION_WEBHOOK_LOCK_SQL,
    );
    scenario.steps.splice(webhookIndex, 1);
    const messageStep = scenario.steps.find(
      (step) => step.sql === sql.ATTENTION_CAUSAL_MESSAGE_SQL,
    )!;
    messageStep.rows = [
      {
        ...(messageStep.rows[0] as object),
        outboundState: 'READ',
        createdHere: false,
        updatedHere: false,
      },
    ];
    const { result, harness } = await runWriter(scenario);
    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: { kind: 'DUPLICATE' },
        originals: {
          eventResult: { kind: 'DUPLICATE' },
          effectResult: { kind: 'APPLIED', reason: 'HUMAN_RESPONSE_CONFIRMED' },
        },
      },
    });
    expect(
      harness.calls
        .filter((call) => call.sql.startsWith('WITH'))
        .map((call) => call.sql),
    ).toEqual([
      sql.ATTENTION_INSERT_AUDIT_SQL,
      sql.ATTENTION_INSERT_RECEIPT_SQL,
    ]);
  });
  it('should allow a new transport receipt for consumed evidence while retaining its original physical cause', async () => {
    const { registration, stored } = consumedEvidence();
    const event = { ...evidence(), eventKey: 'new-transport-alias' };
    const scenario = writerScript(
      {
        event,
        current: conversation('ATTENDED', '2'),
        effect: stored.effect,
        intent: registration.intent!,
        bundles: {
          [stored.effect.id]: bundle(stored, registration),
          [registration.effect.id]: bundle(registration),
        },
      },
      stored.transition.state,
    );
    Object.assign(scenario.cause, {
      webhook: { id: identifier(99), leaseToken: identifier(28) },
    });
    const webhookStep = scenario.steps.find(
      (step) => step.sql === sql.ATTENTION_WEBHOOK_LOCK_SQL,
    )!;
    webhookStep.parameters = [
      ...webhookStep.parameters.slice(0, 3),
      identifier(99),
      identifier(28),
    ];
    webhookStep.rows = [
      { ...(webhookStep.rows[0] as object), id: identifier(99) },
    ];
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: true,
      value: { outcome: { kind: 'DUPLICATE' } },
    });
  });
  it('should reject a consumed evidence binding to a different StatusEvent', async () => {
    const { registration, stored } = consumedEvidence();
    const scenario = writerScript(
      {
        event: { ...evidence(), eventKey: 'alias' },
        current: conversation('ATTENDED', '2'),
        effect: stored.effect,
        intent: registration.intent!,
        bundles: {
          [stored.effect.id]: bundle(stored, registration),
          [registration.effect.id]: bundle(registration),
        },
      },
      stored.transition.state,
    );
    const index = scenario.steps.findIndex(
      (step) => step.sql === sql.ATTENTION_CAUSAL_STATUS_SQL,
    );
    scenario.steps[index].rows = [
      { ...(scenario.steps[index].rows[0] as object), consumedBinding: false },
    ];
    scenario.steps.splice(index + 1);
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: false,
      callerMustRollback: true,
      error: { code: 'CAUSALITY_VIOLATION' },
    });
  });
  it('should replay a frozen response after another inbound without writing or broadening its intention', async () => {
    const revision = '922337203685477580812345678901234567890';
    const event = response(intent({ coveredRevision: revision }));
    const registration = physicalRows(event, pending(revision));
    const before = apply(registration.transition.state, inbound()).state;
    const scenario = writerScript(
      {
        event,
        current: conversation('PENDING', before.revision),
        effect: registration.effect,
        receipt: registration.canonicalReceipt,
        originalAudit: registration.canonicalAudit,
        intent: registration.intent!,
        bundles: { [registration.effect.id]: bundle(registration) },
      },
      before,
    );
    const { result, harness } = await runWriter(scenario);
    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: { kind: 'DUPLICATE' },
        originals: {
          eventResult: { audit: { coveredRevision: revision } },
          effectResult: { audit: { coveredRevision: revision } },
        },
      },
    });
    expect(
      harness.calls.some(
        (call) => call.sql === sql.ATTENTION_INSERT_INTENT_SQL,
      ),
    ).toBe(false);
  });
  it('should stop before writes when the reader finds a contradictory retained original', async () => {
    const rows = aliasRows();
    const scenario = writerScript(
      {
        event: rows.aliasEvent,
        current: conversation('PENDING', '1'),
        effect: rows.effect,
        receipt: rows.receipt,
        originalAudit: rows.originalAudit,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
      rows.transition.state,
    );
    // Contradict baseline/current during the earliest authoritative post-lock read.
    const index = scenario.steps.findIndex(
      (step) => step.sql === ATTENTION_ROOT_SQL,
    );
    scenario.steps[index].rows = [
      {
        ...(scenario.steps[index].rows[0] as object),
        conversation: conversation('PENDING', '0'),
      },
    ];
    scenario.steps.splice(index + 1);
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: false,
      error: { code: 'IMPOSSIBLE_RESULT' },
    });
  });
  it('should capture event and causal identities before the first asynchronous boundary', async () => {
    const scenario = writerScript();
    scenario.steps[0].onQuery = () => {
      Object.assign(scenario.event, { eventKey: 'changed-after-await' });
      if (scenario.cause.webhook !== null)
        Object.assign(scenario.cause.webhook, { id: identifier(999) });
    };
    const { result } = await runWriter(scenario);
    expect(result).toMatchObject({
      ok: true,
      value: { outcome: { audit: { eventKey: 'inbound-event' } } },
    });
  });
});
