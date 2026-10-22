import {
  epoch,
  evidence,
  identifier,
  inbound,
  pending,
  physicalRows,
  response,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_EFFECT_LINKS_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SESSION_SQL,
  ATTENTION_SLOTS_SQL,
  ATTENTION_SOURCE_MESSAGE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';
import {
  bundle,
  conversation,
  gateRow,
  mockRunner,
  script,
  sessionRow,
  structured,
  type ReadFixture,
  type Step,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';

const failureAt = async (
  sql: string,
  change: (step: Step) => void,
  code: string,
  fixture: ReadFixture = {},
) => {
  const scenario = script(fixture);
  const index = scenario.steps.findIndex((step) => step.sql === sql);
  expect(index).toBeGreaterThanOrEqual(0);
  const last = scenario.steps[index];
  change(last);
  scenario.steps.splice(index + 1);
  const harness = mockRunner(scenario.steps);
  const result = await readAttentionProjection({
    queryRunner: harness.queryRunner,
    input: { scope, event: scenario.event },
  });
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(result).not.toHaveProperty('value');
  harness.done();
};

describe('attention reader fails closed', () => {
  it.each([
    ['DISABLED', 'TRACKING_DISABLED'],
    ['PREPARING', 'TRACKING_PREPARING'],
    ['SUSPENDED', 'TRACKING_SUSPENDED'],
  ])(
    'should stop at gate %s without querying attention tables or Conversation',
    async (mode, code) => {
      await failureAt(
        ATTENTION_CONFIGURATION_SQL,
        (step) => {
          step.rows = [{ ...gateRow, mode }];
        },
        code,
      );
    },
  );
  it('should detect pre-DDL configuration without querying noninstalled tables', async () => {
    await failureAt(
      ATTENTION_CONFIGURATION_SQL,
      (step) => {
        step.rows = [
          {
            ...gateRow,
            installed: false,
            mode: null,
            protocolVersion: null,
            gateUpdatedAt: null,
          },
        ];
      },
      'SCHEMA_NOT_INSTALLED',
    );
  });
  it('should distinguish missing gate from disabled gate', async () => {
    await failureAt(
      ATTENTION_CONFIGURATION_SQL,
      (step) => {
        step.rows = [];
      },
      'GATE_MISSING',
    );
  });
  it.each([
    [{ mode: 'UNDECIDED' }, 'INVALID_CONFIGURATION'],
    [{ protocolVersion: 2 }, 'INCOMPATIBLE_VERSION'],
    [{ protocolVersion: null }, 'INCOMPATIBLE_VERSION'],
    [{ protocolVersion: '1' }, 'INVALID_CONFIGURATION'],
    [{ gateUpdatedAt: null }, 'INVALID_CONFIGURATION'],
    [{ workspaceId: identifier(99) }, 'SCOPE_MISMATCH'],
  ])('should reject corrupt/incompatible gate %j', async (overrides, code) => {
    await failureAt(
      ATTENTION_CONFIGURATION_SQL,
      (step) => {
        step.rows = [{ ...gateRow, ...overrides }];
      },
      code,
    );
  });
  it('should reject a missing Conversation without pretending to acquire its lock', async () => {
    await failureAt(
      ATTENTION_CONVERSATION_LOCK_SQL,
      (step) => {
        step.rows = [];
      },
      'CONVERSATION_MISSING',
    );
  });
  it.each([
    [{ lifecycle: 'PREPARING', activatedAt: null }, 'EPOCH_PREPARING'],
    [{ lifecycle: 'SUSPENDED' }, 'EPOCH_SUSPENDED'],
    [{ lifecycle: 'CLOSED', closedAt: epoch.createdAt }, 'EPOCH_CLOSED'],
    [{ identityVersion: 'v2' }, 'INCOMPATIBLE_VERSION'],
    [{ conversationId: identifier(99) }, 'SCOPE_MISMATCH'],
    [{ id: identifier(99) }, 'SCOPE_MISMATCH'],
  ])(
    'should reject unavailable/inconsistent epoch %j',
    async (overrides, code) => {
      await failureAt(
        ATTENTION_ROOT_SQL,
        (step) => {
          step.rows = [
            { conversation: conversation(), epoch: { ...epoch, ...overrides } },
          ];
        },
        code,
      );
    },
  );
  it('should distinguish an unprepared Conversation from a missing linked epoch', async () => {
    await failureAt(
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
    await failureAt(
      ATTENTION_ROOT_SQL,
      (step) => {
        step.rows = [{ conversation: conversation(), epoch: null }];
      },
      'EPOCH_MISSING',
    );
  });
  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'attentionTrackingEpochId',
  ])('should reject a source Message crossing %s', async (field) => {
    await failureAt(
      ATTENTION_SOURCE_MESSAGE_SQL,
      (step) => {
        const source = physicalRows().message!;
        step.rows = [{ message: { ...source, [field]: identifier(99) } }];
      },
      'SCOPE_MISMATCH',
    );
  });
  it('should reject a legacy source Message without adopting the active epoch', async () => {
    await failureAt(
      ATTENTION_SOURCE_MESSAGE_SQL,
      (step) => {
        step.rows = [
          {
            message: {
              ...physicalRows().message,
              attentionTrackingEpochId: null,
            },
          },
        ];
      },
      'SCOPE_MISMATCH',
    );
  });
  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ])(
    'should reject cross-scope %s returned in an Effect bundle',
    async (field) => {
      const rows = physicalRows();
      await failureAt(
        ATTENTION_EFFECT_LINKS_SQL,
        (step) => {
          step.rows = [
            {
              ...bundle(rows),
              effect: { ...rows.effect, [field]: identifier(99) },
            },
          ];
        },
        'SCOPE_MISMATCH',
        {
          current: conversation('PENDING', '1'),
          effect: rows.effect,
          bundles: { [rows.effect.id]: bundle(rows) },
        },
      );
    },
  );
  it.each(['canonicalReceipt', 'canonicalAudit', 'message'])(
    'should reject a present Effect missing its %s',
    async (field) => {
      const rows = physicalRows();
      await failureAt(
        ATTENTION_EFFECT_LINKS_SQL,
        (step) => {
          step.rows = [{ ...bundle(rows), [field]: null }];
        },
        'INCOMPLETE_DATA',
        {
          current: conversation('PENDING', '1'),
          effect: rows.effect,
          bundles: { [rows.effect.id]: bundle(rows) },
        },
      );
    },
  );
  it('should reject incomplete ResponseIntent registration', async () => {
    const rows = physicalRows(response(), pending());
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      (step) => {
        step.rows = [{ ...bundle(rows), registrationAudit: null }];
      },
      'INCOMPLETE_DATA',
      {
        event: evidence(),
        current: conversation('PENDING', '1'),
        intent: rows.intent!,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it('should reject a malformed frozen intention', async () => {
    const rows = physicalRows(response(), pending());
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      (step) => {
        step.rows = [
          { ...bundle(rows), intent: { ...rows.intent, coveredRevision: 1 } },
        ];
      },
      'WRONG_TYPE',
      {
        event: evidence(),
        current: conversation('PENDING', '1'),
        intent: rows.intent!,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it.each([
    { ...sessionRow, isolation: 'repeatable read' },
    { ...sessionRow, isolation: 'serializable' },
    { ...sessionRow, readOnly: 'on' },
    { ...sessionRow, inRecovery: true },
    { ...sessionRow, rowSecurity: 'on' },
    { ...sessionRow, transactionId: '0' },
    { ...sessionRow, transactionId: '18446744073709551616' },
    { ...sessionRow, statementTimeout: '0' },
    { ...sessionRow, lockTimeout: '0' },
  ])('should reject an incorrect transaction/session %j', async (session) => {
    await failureAt(
      ATTENTION_SESSION_SQL,
      (step) => {
        step.rows = [session];
      },
      'INCORRECT_TRANSACTION',
    );
  });
  it.each([
    { mode: 'slave' },
    { isTransactionActive: false },
    { isReleased: true },
    { transactionDepth: 2 },
    { databaseConnection: undefined },
  ])(
    'should reject an invalid runner before querying %j',
    async (overrides) => {
      const harness = mockRunner([]);
      Object.assign(harness.runner, overrides);
      expect(
        await readAttentionProjection({
          queryRunner: harness.queryRunner,
          input: { scope, event: inbound() },
        }),
      ).toMatchObject({ ok: false, error: { code: 'INCORRECT_TRANSACTION' } });
      harness.done();
    },
  );
  it('should reject a manager replacement after acquiring the common lock', async () => {
    const scenario = script();
    scenario.steps.splice(3);
    const harness = mockRunner(scenario.steps);
    scenario.steps[2].onQuery = () => {
      Object.assign(harness.runner, { manager: { ...harness.runner.manager } });
    };
    expect(
      await readAttentionProjection({
        queryRunner: harness.queryRunner,
        input: { scope, event: inbound() },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INCORRECT_TRANSACTION' } });
    harness.done();
  });
  it.each(['transactionId', 'backendPid'])(
    'should reject a changed final %s',
    async (field) => {
      const scenario = script();
      scenario.steps[scenario.steps.length - 1].rows = [
        { ...sessionRow, [field]: field === 'backendPid' ? 42 : '4294979641' },
      ];
      const harness = mockRunner(scenario.steps);
      expect(
        await readAttentionProjection({
          queryRunner: harness.queryRunner,
          input: { scope, event: inbound() },
        }),
      ).toMatchObject({ ok: false, error: { code: 'INCORRECT_TRANSACTION' } });
      harness.done();
    },
  );
  it.each(['42501', '57014', '55P03', '08006', '42P01'])(
    'should keep SQL failure %s distinct from absence',
    async (code) => {
      await failureAt(
        ATTENTION_SLOTS_SQL.NONE,
        (step) => {
          step.error = Object.assign(new Error('private driver text'), {
            code,
          });
        },
        'QUERY_FAILED',
      );
    },
  );
  it.each(
    [
      [],
      null,
      {},
      { records: [], raw: [], affected: 0 },
      { ...structured([]), affected: 1 },
      { raw: [], affected: 0 },
    ].map((result) => [result]),
  )('should reject an incomplete SQL result envelope %j', async (result) => {
    // null is tested as raw via a non-null wrapper result with missing fields.
    await failureAt(
      ATTENTION_SLOTS_SQL.NONE,
      (step) => {
        step.result = result ?? { records: null };
      },
      'INCOMPLETE_PROJECTION',
    );
  });
  it.each([[], [{}, {}]].map((rows) => [rows]))(
    'should reject missing/duplicate materialization root %j',
    async (rows) => {
      await failureAt(
        ATTENTION_SLOTS_SQL.NONE,
        (step) => {
          step.rows = rows;
        },
        'INCOMPLETE_PROJECTION',
      );
    },
  );
  it('should reject omitted SQL slots and contradictory existence indicators', async () => {
    await failureAt(
      ATTENTION_SLOTS_SQL.NONE,
      (step) => {
        step.rows = [{ conversation: conversation(), epoch }];
      },
      'MISSING_FIELD',
    );
    await failureAt(
      ATTENTION_SLOTS_SQL.NONE,
      (step) => {
        step.rows = [
          {
            conversation: conversation(),
            epoch,
            receiptPresent: false,
            receipt: {},
            effectPresent: false,
            effect: null,
            intentPresent: false,
            intent: null,
          },
        ];
      },
      'INCOMPLETE_PROJECTION',
    );
  });
  it('should reject a changed post-lock snapshot', async () => {
    const scenario = script();
    await failureAt(
      ATTENTION_SLOTS_SQL.NONE,
      (step) => {
        step.rows = [
          { ...scenario.slots, conversation: conversation('PENDING', '1') },
        ];
      },
      'SNAPSHOT_CHANGED',
    );
  });
  it('should reject a current status contradicting known history at the same revision', async () => {
    const rows = physicalRows();
    await failureAt(ATTENTION_EFFECT_LINKS_SQL, () => {}, 'IMPOSSIBLE_RESULT', {
      current: conversation('ATTENDED', '1'),
      effect: rows.effect,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
  });
  it('should reject an absent Receipt contradicted by the requested canonical Effect', async () => {
    const rows = physicalRows();
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      () => {},
      'INCOMPLETE_PROJECTION',
      {
        current: conversation('PENDING', '1'),
        effect: rows.effect,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it('should reject an absent Effect contradicted by the selected ResponseIntent registration', async () => {
    const rows = physicalRows(response(), pending());
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      () => {},
      'INCOMPLETE_PROJECTION',
      {
        event: { ...response(), eventKey: 'new-retry-key' },
        current: conversation('PENDING', '1'),
        intent: rows.intent!,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it('should reject an absent intent slot contradicted by the selected response Effect', async () => {
    const rows = physicalRows(response(), pending());
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      () => {},
      'INCOMPLETE_PROJECTION',
      {
        event: { ...response(), eventKey: 'new-retry-key' },
        current: conversation('PENDING', '1'),
        effect: rows.effect,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it('should reject a present Receipt whose linked Effect query has no root', async () => {
    const rows = physicalRows();
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      (step) => {
        step.rows = [];
      },
      'INCOMPLETE_PROJECTION',
      {
        current: conversation('PENDING', '1'),
        receipt: rows.canonicalReceipt,
        originalAudit: rows.canonicalAudit,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it('should reject an invalid stored original without recalculating it from the current Conversation', async () => {
    const rows = physicalRows();
    await failureAt(
      ATTENTION_EFFECT_LINKS_SQL,
      (step) => {
        step.rows = [
          {
            ...bundle(rows),
            canonicalAudit: {
              ...rows.canonicalAudit,
              result: { ...rows.canonicalAudit.result, kind: 'IGNORED' },
            },
          },
        ];
      },
      'IMPOSSIBLE_RESULT',
      {
        event: { ...inbound(), eventKey: 'alias' },
        current: conversation('PENDING', '1'),
        effect: rows.effect,
        bundles: { [rows.effect.id]: bundle(rows) },
      },
    );
  });
  it.each([
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ])(
    'should reject a slot crossing %s before any dependent lookup',
    async (field) => {
      const rows = physicalRows();
      await failureAt(
        ATTENTION_SLOTS_SQL.NONE,
        (step) => {
          const scenario = script({ current: conversation('PENDING', '1') });
          step.rows = [
            {
              ...scenario.slots,
              effectPresent: true,
              effect: { ...rows.effect, [field]: identifier(99) },
            },
          ];
        },
        'SCOPE_MISMATCH',
        { current: conversation('PENDING', '1') },
      );
    },
  );
  it('should enforce physical admission before sending an oversized key to PostgreSQL', async () => {
    const harness = mockRunner([]);
    expect(
      await readAttentionProjection({
        queryRunner: harness.queryRunner,
        input: { scope, event: { ...inbound(), eventKey: 'é'.repeat(513) } },
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPACITY_EXCEEDED' } });
    harness.done();
  });
});
