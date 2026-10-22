import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  epoch,
  inbound,
  physicalRows,
  scope,
  timestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_EFFECT_LINKS_SQL,
  ATTENTION_ORIGINAL_AUDIT_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SESSION_SQL,
  ATTENTION_SLOTS_SQL,
  ATTENTION_SOURCE_MESSAGE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';
import {
  bundle,
  conversation,
  mockRunner,
  script,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const scoped = (alias: string) =>
  ['workspaceId', 'conversationId', 'providerConnectionId', 'trackingEpochId']
    .map((column, index) => `${alias}."${column}" = $${index + 1}::uuid`)
    .join(' AND ');

describe('attention SQL source contract', () => {
  it('should lock Config SHARE before Conversation UPDATE through the only reader entry', async () => {
    const scenario = script();
    const harness = mockRunner(scenario.steps);
    const result = await readAttentionProjection({
      queryRunner: harness.queryRunner,
      input: { scope, event: scenario.event },
    });
    expect(result.ok).toBe(true);
    harness.done();
    expect(harness.calls.map(({ sql }) => sql)).toEqual([
      ATTENTION_SESSION_SQL,
      ATTENTION_CONFIGURATION_SQL,
      ATTENTION_CONVERSATION_LOCK_SQL,
      ATTENTION_ROOT_SQL,
      ATTENTION_SOURCE_MESSAGE_SQL,
      ATTENTION_SLOTS_SQL.NONE,
      ATTENTION_SESSION_SQL,
    ]);
    expect(normalize(ATTENTION_CONFIGURATION_SQL)).toContain(
      'WHERE configuration."workspaceId" = $1::uuid FOR SHARE OF configuration',
    );
    expect(normalize(ATTENTION_CONVERSATION_LOCK_SQL)).toContain(
      'WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid AND c."providerConnectionId" = $3::uuid FOR UPDATE OF c',
    );
  });
  it('should wait for the Conversation lock before reading any fresh root or ledger', async () => {
    const rows = physicalRows();
    const scenario = script({
      event: { ...inbound(), eventKey: 'post-lock-alias' },
      current: conversation('PENDING', '1'),
      effect: rows.effect,
      bundles: { [rows.effect.id]: bundle(rows) },
    });
    let releaseLock = () => {};
    let enteredLock = () => {};
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockEntered = new Promise<void>((resolve) => {
      enteredLock = resolve;
    });
    scenario.steps[2].onQuery = async () => {
      enteredLock();
      await lockReleased;
    };
    const harness = mockRunner(scenario.steps);
    const reading = readAttentionProjection({
      queryRunner: harness.queryRunner,
      input: { scope, event: scenario.event },
    });
    await lockEntered;
    expect(harness.calls.map(({ sql }) => sql)).toEqual([
      ATTENTION_SESSION_SQL,
      ATTENTION_CONFIGURATION_SQL,
      ATTENTION_CONVERSATION_LOCK_SQL,
    ]);
    releaseLock();
    const result = await reading;
    expect(result).toMatchObject({
      ok: true,
      value: {
        facts: {
          effect: { canonicalEventKey: rows.canonicalReceipt.eventKey },
        },
      },
    });
    harness.done();
  });
  it.each(Object.values(ATTENTION_SLOTS_SQL))(
    'should independently search all applicable slots in one rooted statement',
    (statement) => {
      const sql = normalize(statement);
      expect(sql).toContain(
        `LEFT JOIN core."inconnectMessagingAttentionReceipt" r ON ${scoped('r')} AND r."eventKey" = $5::text`,
      );
      expect(sql).toContain(
        `LEFT JOIN core."inconnectMessagingAttentionEffect" e ON ${scoped('e')} AND e."effectKey" = $6::text`,
      );
      expect(sql).not.toMatch(/e\."effectKey"[^\n]*r\."effectId"/);
      expect(sql).toContain(
        'FROM core."inconnectMessagingConversation" c LEFT JOIN core."inconnectMessagingAttentionEpoch" epoch',
      );
      expect(sql).toContain('r."id" IS NOT NULL AS "receiptPresent"');
      expect(sql).toContain('e."id" IS NOT NULL AS "effectPresent"');
      expect(sql).not.toMatch(
        /\b(INNER JOIN|LIMIT|OFFSET|ORDER BY|SKIP LOCKED|deletedAt)\b/i,
      );
    },
  );
  it('should look up intent by exact approved key, never by the incoming intent for RESPONSE_INTENDED', () => {
    expect(normalize(ATTENTION_SLOTS_SQL.INTENT_ID)).toContain(
      `LEFT JOIN core."inconnectMessagingAttentionResponseIntent" i ON ${scoped('i')} AND i."intentId" = $7::text`,
    );
    expect(normalize(ATTENTION_SLOTS_SQL.MESSAGE_ID)).toContain(
      `LEFT JOIN core."inconnectMessagingAttentionResponseIntent" i ON ${scoped('i')} AND i."messageId" = $7::uuid`,
    );
    expect(ATTENTION_SLOTS_SQL.NONE).not.toContain(
      'inconnectMessagingAttentionResponseIntent',
    );
  });
  it('should constrain every ledger join by full S and retain exact dependent identities', () => {
    const sql = normalize(ATTENTION_EFFECT_LINKS_SQL);
    for (const alias of ['r', 'a', 'i', 'g', 'gr', 'ga'])
      expect(sql).toContain(scoped(alias));
    expect(sql).toContain(`WHERE ${scoped('e')} AND e."id" = $5::uuid`);
    for (const alias of ['m', 'gm'])
      expect(sql).toContain(
        `${alias}."workspaceId" = $1::uuid AND ${alias}."conversationId" = $2::uuid AND ${alias}."providerConnectionId" = $3::uuid AND ${alias}."attentionTrackingEpochId" = $4::uuid`,
      );
    expect(sql).toContain('r."id" = e."canonicalReceiptId"');
    expect(sql).toContain('a."id" = r."originalAuditId"');
    expect(sql).toContain('g."id" = i."registeredEffectId"');
    expect(sql).toContain(
      's."workspaceId" = $1::uuid AND s."messageId" = m."id"',
    );
    expect(sql).toContain(
      'w."workspaceId" = $1::uuid AND w."providerConnectionId" = $3::uuid',
    );
    expect(normalize(ATTENTION_ORIGINAL_AUDIT_SQL)).toContain(
      `WHERE ${scoped('a')} AND a."id" = $5::uuid`,
    );
    expect(sql).not.toContain('INNER JOIN');
  });
  it('should enumerate decoder fields and explicitly select UTC microseconds without technical markers', () => {
    const sql = [
      ATTENTION_ROOT_SQL,
      ATTENTION_EFFECT_LINKS_SQL,
      ATTENTION_ORIGINAL_AUDIT_SQL,
    ].join('\n');
    expect(sql).not.toMatch(
      /SELECT\s+\*|to_jsonb\((e|r|a|i|epoch)\)|attentionCreatedTransactionId|attentionUpdatedTransactionId|\bxmin\b|::bigint|::numeric/i,
    );
    for (const alias of [
      'epoch."bootstrapPendingAt"',
      'epoch."createdAt"',
      'epoch."activatedAt"',
      'epoch."closedAt"',
      'c."pendingAt"',
      'e."createdAt"',
      'r."createdAt"',
      'i."createdAt"',
      'a."recordedAt"',
    ]) {
      expect(sql).toContain(
        `to_char(${alias} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      );
      // Out-of-range/BC/infinite values must reach rejection without normalization.
      expect(sql).toContain(`isfinite(${alias})`);
      expect(sql).toContain(`ELSE ${alias}::text END`);
    }
    expect(ATTENTION_CONFIGURATION_SQL).toContain('HH24:MI:SS.US');
    expect(ATTENTION_SESSION_SQL).toContain('pg_current_xact_id()::text');
    expect(ATTENTION_SESSION_SQL).not.toContain('xmin');
  });
  it('should preserve six microsecond digits and reject a Date instead of accepting a lossy value', async () => {
    const scenario = script({ current: conversation('PENDING', '0') });
    const precise = '2026-10-21T12:34:56.123456Z';
    const root = {
      conversation: { ...conversation('PENDING', '0'), pendingAt: precise },
      epoch: {
        ...epoch,
        bootstrapStatus: 'PENDING',
        bootstrapPendingAt: precise,
      },
    };
    scenario.steps[3].rows = [root];
    scenario.steps[5].rows = [{ ...scenario.slots, ...root }];
    const harness = mockRunner(scenario.steps);
    expect(
      await readAttentionProjection({
        queryRunner: harness.queryRunner,
        input: { scope, event: scenario.event },
      }),
    ).toMatchObject({
      ok: true,
      value: { epoch: { bootstrapPendingAt: precise } },
    });
    harness.done();
    const lossy = script();
    lossy.steps[3].rows = [
      {
        conversation: {
          ...conversation('PENDING', '1'),
          pendingAt: new Date(timestamp),
        },
        epoch,
      },
    ];
    lossy.steps.splice(4);
    const bad = mockRunner(lossy.steps);
    expect(
      await readAttentionProjection({
        queryRunner: bad.queryRunner,
        input: { scope, event: lossy.event },
      }),
    ).toMatchObject({ ok: false, error: { code: 'WRONG_TYPE' } });
    bad.done();
  });
  it('should keep hostile key bytes in parameters and never interpolate them into SQL', async () => {
    const scenario = script();
    const eventKey = "key'); DROP TABLE anything; --";
    const event = { ...scenario.event, eventKey };
    scenario.steps[5].parameters = [
      ...scenario.steps[5].parameters.slice(0, 4),
      eventKey,
      scenario.steps[5].parameters[5],
    ];
    const harness = mockRunner(scenario.steps);
    expect(
      await readAttentionProjection({
        queryRunner: harness.queryRunner,
        input: { scope, event },
      }),
    ).toMatchObject({ ok: true });
    harness.done();
    expect(harness.calls.every(({ sql }) => !sql.includes(eventKey))).toBe(
      true,
    );
  });
  it('should expose no transaction lifecycle, runtime provider or writing transition in reader source', () => {
    for (const filename of [
      'read-attention-projection.ts',
      'attention-reader-links.ts',
      'attention-reader-session.ts',
      'attention-reader-sql.ts',
    ]) {
      const source = readFileSync(join(__dirname, '..', filename), 'utf8');
      expect(source).not.toMatch(
        /\.connect\(|\.startTransaction\(|\.commitTransaction\(|\.rollbackTransaction\(|\.release\(|\.createQueryRunner\(|\.getRepository\(|\.transaction\(|@Injectable|@Module|evaluateAttentionProjection\(|transitionConversationAttention\(/,
      );
    }
  });
});
