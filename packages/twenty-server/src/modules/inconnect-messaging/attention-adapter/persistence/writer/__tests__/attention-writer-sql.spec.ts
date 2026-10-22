import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ATTENTION_LEDGER_STRUCTURE_UP } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-structure';
import { ATTENTION_LEDGER_TRIGGERS_UP } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-triggers';
import { ATTENTION_LEDGER_AGGREGATE_GUARDS } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-aggregate';
import { ATTENTION_LEDGER_ROW_GUARDS } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-row-guards';
import {
  inbound,
  response,
  pending,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SLOTS_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { conversation } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  runWriter,
  writerScript,
  writerRunner,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';
import * as sql from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';

jest.mock('node:crypto', () => ({ randomUUID: jest.fn() }));
const normalize = (statement: string) => statement.replace(/\s+/g, ' ').trim();

describe('SQL and schema obligations, inspected without executing SQL', () => {
  it('should use the real approved reader, wait for its common lock and only then authorize/write', async () => {
    const scenario = writerScript();
    let entered = () => {};
    let resume = () => {};
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    scenario.steps.find(
      (step) => step.sql === ATTENTION_CONVERSATION_LOCK_SQL,
    )!.onQuery = async () => {
      entered();
      await release;
    };
    // Only observe the prefix: no DML is executed in this controlled wait.
    const lockIndex = scenario.steps.findIndex(
      (step) => step.sql === ATTENTION_CONVERSATION_LOCK_SQL,
    );
    const prefix = scenario.steps.slice(0, lockIndex + 1);
    const harness = writerRunner(prefix);
    const admit = jest.fn(async () => null);
    const writing = prepareAttentionWrite({
      queryRunner: harness.queryRunner,
      input: { scope, event: scenario.event },
      causal: scenario.cause,
      admit,
    });
    await locked;
    expect(harness.calls.map((call) => call.sql).slice(-2)).toEqual([
      ATTENTION_CONFIGURATION_SQL,
      ATTENTION_CONVERSATION_LOCK_SQL,
    ]);
    expect(
      harness.calls.some(
        (call) =>
          call.sql === ATTENTION_ROOT_SQL ||
          call.sql === ATTENTION_SLOTS_SQL.NONE,
      ),
    ).toBe(false);
    expect(admit).not.toHaveBeenCalled();
    // Make the acquired runner unusable to stop the protocol without another SQL.
    harness.runner.isTransactionActive = false;
    resume();
    expect(await writing).toMatchObject({
      ok: false,
      error: { code: 'INCORRECT_TRANSACTION' },
    });
    harness.done();
  });
  it('should constrain causal lookups by C and epoch, with Receipt before Message', async () => {
    const { harness } = await runWriter(writerScript());
    expect(
      harness.calls.findIndex(
        (call) => call.sql === sql.ATTENTION_WEBHOOK_LOCK_SQL,
      ),
    ).toBeLessThan(
      harness.calls.findIndex(
        (call) => call.sql === sql.ATTENTION_CAUSAL_MESSAGE_SQL,
      ),
    );
    expect(normalize(sql.ATTENTION_CAUSAL_MESSAGE_SQL)).toContain(
      'm."workspaceId" = $1::uuid AND m."conversationId" = $2::uuid AND m."providerConnectionId" = $3::uuid AND m."attentionTrackingEpochId" = $4::uuid',
    );
    for (const column of [
      'workspaceId',
      'conversationId',
      'providerConnectionId',
      'trackingEpochId',
    ]) {
      expect(sql.ATTENTION_INSERT_RECEIPT_SQL).toContain(`e."${column}"`);
      expect(sql.ATTENTION_CAUSAL_STATUS_SQL).toContain(`e."${column}"`);
    }
  });
  it('should type every SQL value position without unused or skipped parameter numbers', () => {
    for (const statement of Object.values(sql).filter(
      (value): value is string =>
        typeof value === 'string' && !value.startsWith('SET'),
    )) {
      const numbers = [...statement.matchAll(/\$(\d+)::/g)].map((match) =>
        Number(match[1]),
      );
      expect([...new Set(numbers)].sort((left, right) => left - right)).toEqual(
        Array.from({ length: Math.max(...numbers) }, (_, index) => index + 1),
      );
    }
  });
  it('should preserve literal hostile event bytes in SQL parameters', async () => {
    const eventKey = "key'); SELECT bad(); --";
    const { harness, result } = await runWriter(
      writerScript({ event: { ...inbound(), eventKey } }),
    );
    expect(result.ok).toBe(true);
    expect(harness.calls.every((call) => !call.sql.includes(eventKey))).toBe(
      true,
    );
    expect(
      harness.calls.some((call) => call.parameters.includes(eventKey)),
    ).toBe(true);
  });
  it('should never write xid8 markers, revise a frozen row or transport pendingAt through Date', () => {
    const writes = [
      sql.ATTENTION_INSERT_EFFECT_SQL,
      sql.ATTENTION_INSERT_AUDIT_SQL,
      sql.ATTENTION_INSERT_RECEIPT_SQL,
      sql.ATTENTION_INSERT_INTENT_SQL,
      sql.ATTENTION_UPDATE_CONVERSATION_SQL,
      sql.ATTENTION_INSERT_OUTBOX_SQL,
    ].join('\n');
    expect(writes).not.toMatch(
      /attentionCreatedTransactionId|attentionUpdatedTransactionId|xmin|::bigint|::numeric|ON CONFLICT|DO NOTHING|DELETE|TRUNCATE/,
    );
    expect(writes).not.toMatch(/UPDATE core\."inconnectMessagingAttention/);
    expect(sql.ATTENTION_UPDATE_CONVERSATION_SQL).toContain(
      'THEN c."pendingAt" ELSE NULL END',
    );
    expect(sql.ATTENTION_CAUSAL_MESSAGE_SQL).toContain(
      'core.im_at_own_write(m."attentionCreatedTransactionId")',
    );
    expect(sql.ATTENTION_CAUSAL_MESSAGE_SQL).toContain(
      'core.im_at_own_write(m."attentionUpdatedTransactionId")',
    );
    expect(sql.ATTENTION_CAUSAL_STATUS_SQL).toContain(
      'core.im_at_own_write(s."attentionCreatedTransactionId")',
    );
  });
  it('should close the actual immediate FK graph in statement order, allowing only declared deferred cycles', async () => {
    const { harness, result } = await runWriter(
      writerScript(
        { event: response(), current: conversation('PENDING', '1') },
        pending(),
      ),
    );
    expect(result.ok).toBe(true);
    // Independent schema oracle extracts real FK child/parent and deferrability;
    // it is not an in-memory SQL engine or a proof of installed PostgreSQL guards.
    const references = ATTENTION_LEDGER_STRUCTURE_UP.flatMap((statement) => {
      const match =
        /ALTER TABLE "core"\."(\w+)" ADD CONSTRAINT "(\w+)" FOREIGN KEY .* REFERENCES "core"\."(\w+)" .* (NOT DEFERRABLE|DEFERRABLE INITIALLY DEFERRED)$/.exec(
          statement,
        );
      return match
        ? [
            {
              child: match[1],
              name: match[2],
              parent: match[3],
              deferred: match[4] === 'DEFERRABLE INITIALLY DEFERRED',
            },
          ]
        : [];
    });
    expect(references).toHaveLength(15);
    const effectValues = harness.calls.find(
      (call) => call.sql === sql.ATTENTION_INSERT_EFFECT_SQL,
    )!.parameters;
    const applicable = references.filter(
      (reference) =>
        reference.name !== 'FK_IM_AT_EFFECT_STATUS' ||
        effectValues[11] !== null,
    );
    const present = new Set([
      'inconnectMessagingConversation',
      'inconnectMessagingAttentionEpoch',
      'inconnectMessagingMessage',
    ]);
    const insertions = harness.calls.flatMap((call) => {
      const match = /INSERT INTO core\."(\w+)"/.exec(call.sql);
      return match ? [match[1]] : [];
    });
    for (const table of insertions) {
      for (const reference of applicable.filter(
        (reference) => reference.child === table && !reference.deferred,
      ))
        expect({
          name: reference.name,
          present: present.has(reference.parent),
        }).toEqual({ name: reference.name, present: true });
      present.add(table);
    }
    for (const reference of applicable.filter((reference) =>
      present.has(reference.child),
    ))
      expect(present.has(reference.parent)).toBe(true);
    expect(insertions).toEqual([
      'inconnectMessagingAttentionEffect',
      'inconnectMessagingAttentionTransitionAudit',
      'inconnectMessagingAttentionReceipt',
      'inconnectMessagingAttentionResponseIntent',
    ]);
    if (result.ok) {
      const effect = harness.calls.find(
        (call) => call.sql === sql.ATTENTION_INSERT_EFFECT_SQL,
      )!.parameters;
      const receipt = harness.calls.find(
        (call) => call.sql === sql.ATTENTION_INSERT_RECEIPT_SQL,
      )!.parameters;
      const intent = harness.calls.find(
        (call) => call.sql === sql.ATTENTION_INSERT_INTENT_SQL,
      )!.parameters;
      expect(effect[7]).toBe(result.value.rows.receiptId);
      expect(receipt[6]).toBe(result.value.rows.auditId);
      expect(intent[13]).toBe(result.value.rows.effectId);
      expect(effect[10]).toBe(intent[5]);
    }
  });
  it('should flush only named declared deferred FKs/triggers after all writes', async () => {
    const definitions = [
      ...ATTENTION_LEDGER_STRUCTURE_UP,
      ...ATTENTION_LEDGER_TRIGGERS_UP,
    ];
    for (const name of sql.ATTENTION_WRITE_CONSTRAINTS) {
      const definition = definitions.find((statement) =>
        statement.includes(`"${name}"`),
      );
      expect(definition).toBeDefined();
      expect(definition).toContain('DEFERRABLE INITIALLY DEFERRED');
      expect(definition).not.toContain('NOT DEFERRABLE');
    }
    const { harness } = await runWriter(writerScript());
    expect(
      harness.calls.findIndex((call) => call.sql === sql.ATTENTION_DEFER_SQL),
    ).toBeLessThan(
      harness.calls.findIndex(
        (call) => call.sql === sql.ATTENTION_INSERT_EFFECT_SQL,
      ),
    );
    expect(
      harness.calls.findIndex(
        (call) => call.sql === sql.ATTENTION_COMPLETE_SQL,
      ),
    ).toBeGreaterThan(
      harness.calls.findIndex(
        (call) => call.sql === sql.ATTENTION_INSERT_OUTBOX_SQL,
      ),
    );
  });
  it('should satisfy audit-before-state and atomic output obligations of the actual guard sources', async () => {
    const { harness } = await runWriter(writerScript());
    const ordered = harness.calls.map((call) => call.sql);
    expect(ordered.indexOf(sql.ATTENTION_INSERT_AUDIT_SQL)).toBeLessThan(
      ordered.indexOf(sql.ATTENTION_UPDATE_CONVERSATION_SQL),
    );
    expect(ATTENTION_LEDGER_ROW_GUARDS.join('\n')).toContain(
      'one event per transaction',
    );
    expect(ATTENTION_LEDGER_AGGREGATE_GUARDS.join('\n')).toContain(
      'attention mutation requires matching new audit',
    );
    expect(sql.ATTENTION_INSERT_OUTBOX_SQL).toContain(
      'core.im_at_outbox_key($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6::text)',
    );
    expect(sql.ATTENTION_INSERT_OUTBOX_SQL).toContain(
      "jsonb_build_object('conversationId', $2::uuid::text)",
    );
    expect(sql.ATTENTION_INSERT_OUTBOX_SQL).toContain(
      "'CONVERSATION_ATTENTION_CHANGED'",
    );
  });
  it('should remain inert, with no runtime registration, external publication or transaction factory', () => {
    const files = readdirSync(join(__dirname, '..')).filter((name) =>
      name.endsWith('.ts'),
    );
    const source = files
      .map((name) => readFileSync(join(__dirname, '..', name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /\.connect\(|\.startTransaction\(|\.commitTransaction\(|\.rollbackTransaction\(|\.release\(|\.createQueryRunner\(|\.transaction\(|getRepository\(|@Injectable|@Module|requestPublication\(|publish\(|Twilio|Redis|new Date\(/,
    );
    expect(source).toContain('readAttentionProjection({');
    expect(source).toContain(
      'evaluateAttentionProjection(read.plan, read.facts)',
    );
    const moduleSource = readFileSync(
      join(__dirname, '../../../../inconnect-messaging.module.ts'),
      'utf8',
    );
    expect(moduleSource).not.toContain('persistence/writer');
  });
});
