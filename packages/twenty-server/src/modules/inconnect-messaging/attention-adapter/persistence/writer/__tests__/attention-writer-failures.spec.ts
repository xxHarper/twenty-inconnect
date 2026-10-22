import {
  evidence,
  identifier,
  intent,
  pending,
  physicalRows,
  response,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  bundle,
  conversation,
  type Step,
  sessionRow,
  type ReadFixture,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SESSION_SQL,
  ATTENTION_SLOTS_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { type ConversationAttentionState } from 'src/modules/inconnect-messaging/attention-domain';
import {
  manual,
  runWriter,
  writerRunner,
  writerScript,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';
import * as sql from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';

jest.mock('node:crypto', () => ({ randomUUID: jest.fn() }));

const failAt = async (
  statement: string,
  change: (step: Step) => void,
  code: string,
  fixture: ReadFixture = {},
  before?: ConversationAttentionState,
) => {
  const scenario = writerScript(fixture, before);
  const index = scenario.steps.findIndex((step) => step.sql === statement);
  expect(index).toBeGreaterThanOrEqual(0);
  change(scenario.steps[index]);
  scenario.steps.splice(index + 1);
  const run = await runWriter(scenario);
  expect(run.result).toMatchObject({
    ok: false,
    callerMustRollback: true,
    error: { code },
  });
  expect(run.result).not.toHaveProperty('value');
  return run;
};
const newEvidence = () => {
  const registration = physicalRows(response(), pending());
  return {
    before: registration.transition.state,
    fixture: {
      event: evidence(),
      current: conversation('PENDING', '1'),
      intent: registration.intent!,
      bundles: { [registration.effect.id]: bundle(registration) },
    },
  };
};

describe('writer failure boundaries and caller-owned abort', () => {
  it.each(['repeatable read', 'serializable'])(
    'should reject %s before locks or DML',
    async (isolation) => {
      await failAt(
        ATTENTION_SESSION_SQL,
        (step) => {
          step.rows = [{ ...sessionRow, isolation }];
        },
        'INCORRECT_TRANSACTION',
      );
    },
  );
  it.each([
    { mode: 'slave' },
    { isTransactionActive: false },
    { isReleased: true },
    { transactionDepth: 2 },
    { databaseConnection: undefined },
  ])('should reject an invalid caller runner %j', async (overrides) => {
    const harness = writerRunner([]);
    Object.assign(harness.runner, overrides);
    const admit = jest.fn();
    expect(
      await prepareAttentionWrite({
        queryRunner: harness.queryRunner,
        input: { scope, event: manual('PENDING', '0') },
        causal: { webhook: null, providerStatusEventId: null },
        admit,
      }),
    ).toMatchObject({
      ok: false,
      callerMustRollback: true,
      error: { code: 'INCORRECT_TRANSACTION' },
    });
    expect(admit).not.toHaveBeenCalled();
    harness.done();
  });
  it('should stop at DISABLED without applying the new ledger or calling admission', async () => {
    const run = await failAt(
      ATTENTION_CONFIGURATION_SQL,
      (step) => {
        step.rows = [{ ...(step.rows[0] as object), mode: 'DISABLED' }];
      },
      'TRACKING_DISABLED',
    );
    expect(run.admit).not.toHaveBeenCalled();
    expect(run.harness.calls.some((call) => call.sql.startsWith('WITH'))).toBe(
      false,
    );
  });
  it('should return an explicit unprepared epoch failure without bootstrap', async () => {
    await failAt(
      ATTENTION_ROOT_SQL,
      (step) => {
        step.rows = [
          {
            conversation: {
              ...conversation(),
              attentionTrackingEpochId: null,
              attentionStatus: null,
              attentionRevision: null,
            },
            epoch: null,
          },
        ];
      },
      'EPOCH_UNPREPARED',
    );
  });
  it('should keep authoritative reader failure distinct from absent keys', async () => {
    await failAt(
      ATTENTION_SLOTS_SQL.NONE,
      (step) => {
        step.error = Object.assign(new Error('private-sql'), { code: '42501' });
      },
      'QUERY_FAILED',
    );
  });
  it.each([
    sql.ATTENTION_INSERT_EFFECT_SQL,
    sql.ATTENTION_INSERT_AUDIT_SQL,
    sql.ATTENTION_INSERT_RECEIPT_SQL,
    sql.ATTENTION_UPDATE_CONVERSATION_SQL,
    sql.ATTENTION_INSERT_OUTBOX_SQL,
  ])(
    'should stop after a failed write without returning a partial accepted result (%#)',
    async (statement) => {
      const run = await failAt(
        statement,
        (step) => {
          step.error = Object.assign(new Error('private data'), {
            code: '08006',
          });
        },
        'WRITE_FAILED',
      );
      expect(JSON.stringify(run.result)).not.toMatch(
        /private|SELECT|INSERT|UPDATE/,
      );
      // Only a caller rollback can undo the preceding statements. This script does
      // not pretend to implement PostgreSQL rollback or visibility.
      expect(run.harness.calls.slice(-1)[0]?.sql).toBe(statement);
    },
  );
  it('should reject an intention INSERT error after its preceding cyclic writes', async () => {
    await failAt(
      sql.ATTENTION_INSERT_INTENT_SQL,
      (step) => {
        step.error = Object.assign(new Error('failed'), { code: '23503' });
      },
      'WRITE_FAILED',
      { event: response(), current: conversation('PENDING', '1') },
      pending(),
    );
  });
  it.each(['23505', '23503', '23514', '40P01', '40001', '55P03', '57014'])(
    'should preserve SQLSTATE %s without retries in the failed transaction',
    async (code) => {
      const run = await failAt(
        sql.ATTENTION_INSERT_EFFECT_SQL,
        (step) => {
          step.error = Object.assign(new Error('driver'), { code });
        },
        'WRITE_FAILED',
      );
      expect(run.result).toMatchObject({ error: { sqlState: code } });
      expect(
        run.harness.calls.filter(
          (call) => call.sql === sql.ATTENTION_INSERT_EFFECT_SQL,
        ),
      ).toHaveLength(1);
    },
  );
  it.each([sql.ATTENTION_DEFER_SQL, sql.ATTENTION_COMPLETE_SQL])(
    'should reject an error while controlling deferred obligations (%#)',
    async (statement) => {
      await failAt(
        statement,
        (step) => {
          step.error = Object.assign(new Error('constraint failed'), {
            code: '23514',
          });
        },
        'WRITE_FAILED',
      );
    },
  );
  it.each([
    sql.ATTENTION_INSERT_EFFECT_SQL,
    sql.ATTENTION_INSERT_AUDIT_SQL,
    sql.ATTENTION_INSERT_RECEIPT_SQL,
    sql.ATTENTION_UPDATE_CONVERSATION_SQL,
    sql.ATTENTION_INSERT_OUTBOX_SQL,
  ])(
    'should reject an empty RETURNING instead of claiming a write (%#)',
    async (statement) => {
      await failAt(
        statement,
        (step) => {
          step.rows = [];
        },
        'INCOMPLETE_WRITE',
      );
    },
  );
  it('should reject mismatched returned identity', async () => {
    await failAt(
      sql.ATTENTION_INSERT_EFFECT_SQL,
      (step) => {
        step.rows = [{ id: identifier(999) }];
      },
      'INCOMPLETE_WRITE',
    );
  });
  it('should reject a malformed driver write envelope', async () => {
    await failAt(
      sql.ATTENTION_INSERT_EFFECT_SQL,
      (step) => {
        step.result = { records: [{ id: identifier(101) }], affected: 1 };
      },
      'INCOMPLETE_WRITE',
    );
  });
  it('should reject a missing same-transaction Message INSERT for new inbound', async () => {
    await failAt(
      sql.ATTENTION_CAUSAL_MESSAGE_SQL,
      (step) => {
        step.rows = [{ ...(step.rows[0] as object), createdHere: false }];
      },
      'CAUSALITY_VIOLATION',
    );
  });
  it('should reject a stale webhook lease before locking Message or writing', async () => {
    await failAt(
      sql.ATTENTION_WEBHOOK_LOCK_SQL,
      (step) => {
        step.rows = [{ ...(step.rows[0] as object), leaseValid: false }];
      },
      'CAUSALITY_VIOLATION',
    );
  });
  it.each(['createdHere', 'appliedToProjection'])(
    'should reject evidence missing %s',
    async (field) => {
      const scenario = newEvidence();
      await failAt(
        sql.ATTENTION_CAUSAL_STATUS_SQL,
        (step) => {
          step.rows = [{ ...(step.rows[0] as object), [field]: false }];
        },
        'CAUSALITY_VIOLATION',
        scenario.fixture,
        scenario.before,
      );
    },
  );
  it('should reject a Message not updated by this evidence unit', async () => {
    const scenario = newEvidence();
    const scripted = writerScript(scenario.fixture, scenario.before);
    const message = scripted.steps.find(
      (step) => step.sql === sql.ATTENTION_CAUSAL_MESSAGE_SQL,
    )!;
    message.rows = [{ ...(message.rows[0] as object), updatedHere: false }];
    scripted.steps.splice(
      scripted.steps.findIndex(
        (step) => step.sql === sql.ATTENTION_CAUSAL_STATUS_SQL,
      ) + 1,
    );
    expect((await runWriter(scripted)).result).toMatchObject({
      ok: false,
      error: { code: 'CAUSALITY_VIOLATION' },
    });
  });
  it('should reject an outbound state inconsistent with newly admitted evidence', async () => {
    const scenario = newEvidence();
    const scripted = writerScript(scenario.fixture, scenario.before);
    const message = scripted.steps.find(
      (step) => step.sql === sql.ATTENTION_CAUSAL_MESSAGE_SQL,
    )!;
    message.rows = [
      { ...(message.rows[0] as object), outboundState: 'FAILED' },
    ];
    scripted.steps.splice(
      scripted.steps.findIndex(
        (step) => step.sql === sql.ATTENTION_CAUSAL_STATUS_SQL,
      ) + 1,
    );
    expect((await runWriter(scripted)).result).toMatchObject({
      ok: false,
      error: { code: 'CAUSALITY_VIOLATION' },
    });
  });
  it('should require caller rollback when a new outbound Message has stale coverage', async () => {
    const event = response(intent({ coveredRevision: '0' }));
    await failAt(
      sql.ATTENTION_CAUSAL_MESSAGE_SQL,
      (step) => {
        step.rows = [{ ...(step.rows[0] as object), createdHere: true }];
      },
      'CAUSAL_OPERATION_REJECTED',
      { event, current: conversation('PENDING', '1') },
      pending(),
    );
  });
  it('should leave missing-intention evidence unconsumed and require causal rollback', async () => {
    const scenario = writerScript(
      { event: evidence(), current: conversation('PENDING', '1') },
      pending(),
    );
    scenario.steps.splice(
      scenario.steps.findIndex(
        (step) => step.sql === sql.ATTENTION_CAUSAL_MESSAGE_SQL,
      ) + 1,
    );
    const run = await runWriter(scenario);
    expect(run.result).toMatchObject({
      ok: false,
      callerMustRollback: true,
      error: { code: 'CAUSAL_OPERATION_REJECTED' },
    });
    expect(run.harness.calls.some((call) => call.sql.startsWith('WITH'))).toBe(
      false,
    );
  });
  it.each([
    'authorityKind',
    'actorWorkspaceMemberId',
    'fingerprint',
    'eventKey',
    'scope',
  ])('should reject mismatched admission %s before DML', async (field) => {
    const scenario = writerScript({ event: manual('PENDING', '0') });
    const changed =
      field === 'scope'
        ? { ...scope, trackingEpochId: identifier(999) }
        : field === 'actorWorkspaceMemberId'
          ? identifier(999)
          : field === 'authorityKind'
            ? 'BACKEND'
            : 'different';
    Object.assign(scenario.admission, { [field]: changed });
    scenario.steps.splice(scenario.readerLength + 3);
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_REQUIRED' },
    });
  });
  it('should reject an unadmitted HUMAN event despite TEMPLATE format and historical attribution', async () => {
    const scenario = writerScript(
      { event: response(), current: conversation('PENDING', '1') },
      pending(),
    );
    Object.assign(scenario.admission, {
      authorityKind: 'BACKEND',
      actorWorkspaceMemberId: null,
    });
    scenario.steps.splice(scenario.readerLength + 3);
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_REQUIRED' },
    });
  });
  it.each([
    'outboundAdmission',
    'evidenceId',
    'providerStatusEventId',
    'correlationReference',
  ])(
    'should reject a missing/new-evidence admission binding %s',
    async (field) => {
      const evidenceScenario = newEvidence();
      const scenario = writerScript(
        evidenceScenario.fixture,
        evidenceScenario.before,
      );
      Object.assign(scenario.admission, { [field]: null });
      scenario.steps.splice(scenario.readerLength + 3);
      expect((await runWriter(scenario)).result).toMatchObject({
        ok: false,
        error: { code: 'AUTHORITY_REQUIRED' },
      });
    },
  );
  it('should detect transaction replacement between reader and admission', async () => {
    const scenario = writerScript();
    // The writer session pins identity before entering the approved reader.
    const index = scenario.readerLength + 1;
    scenario.steps[index].rows = [
      { ...sessionRow, transactionId: '4294979641' },
    ];
    scenario.steps.splice(index + 1);
    expect((await runWriter(scenario)).result).toMatchObject({
      ok: false,
      error: { code: 'INCORRECT_TRANSACTION' },
    });
  });
  it.each(['deny', 'throw', 'replace runner'] as const)(
    'should fail closed when admission will %s',
    async (operation) => {
      const scenario = writerScript();
      scenario.steps.splice(
        scenario.readerLength + (operation === 'deny' ? 3 : 2),
      );
      const harness = writerRunner(scenario.steps);
      const result = await prepareAttentionWrite({
        queryRunner: harness.queryRunner,
        input: { scope, event: scenario.event },
        causal: scenario.cause,
        admit: async () => {
          if (operation === 'throw') throw new Error('private auth text');
          if (operation === 'replace runner')
            Object.assign(harness.runner, {
              manager: { ...harness.runner.manager },
            });
          return null;
        },
      });
      expect(result).toMatchObject({
        ok: false,
        callerMustRollback: true,
        error: {
          code:
            operation === 'deny'
              ? 'AUTHORITY_REQUIRED'
              : operation === 'throw'
                ? 'ADMISSION_FAILED'
                : 'INCORRECT_TRANSACTION',
        },
      });
      expect(JSON.stringify(result)).not.toContain('private');
      harness.done();
    },
  );
});
