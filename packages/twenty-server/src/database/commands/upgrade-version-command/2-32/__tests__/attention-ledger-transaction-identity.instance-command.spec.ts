import {
  ATTENTION_LEDGER_UP,
  ATTENTION_LEDGER_DOWN,
} from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1792540800000-create-inconnect-messaging-attention-ledger';
import { normalizeAttentionSql } from 'src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-metadata.fixtures';

const definition = (name: string) => {
  const source = ATTENTION_LEDGER_UP.find((statement) =>
    statement.startsWith(`CREATE FUNCTION core.${name}(`),
  );

  if (!source) throw new Error(`Missing ${name}`);

  return source;
};

// Interpret only the scalar equality contract actually declared in the source.
// This deliberately cannot execute SQL, PL/pgSQL, snapshots, freezing or MVCC.
// Any different expression must be reviewed instead of silently modeled here.
const evaluateScalarContract = (stored: string | null, current: string) => {
  const expression = definition('im_at_own_write').split('$fn$')[1].trim();

  if (
    !/^SELECT COALESCE\(transaction_id::xid8 = pg_current_xact_id\(\), false\)$/.test(
      expression,
    )
  ) {
    throw new Error('Unreviewed transaction equality expression');
  }

  return stored !== null && BigInt(stored) === BigInt(current);
};

// Independent oracle: compare generation and counter separately, without using
// the production helper, its expression, or decimal-string equality.
const identityParts = (transaction: bigint) => [
  transaction >> BigInt('32'),
  transaction & BigInt('0xffffffff'),
];
const sameIdentity = (first: bigint, second: bigint) =>
  identityParts(first).every(
    (part, index) => part === identityParts(second)[index],
  );

const historical = '12345';
const current = '4294979641';
type Witness = Readonly<{
  id: string;
  created: string | null;
  updated?: string | null;
}>;
const ownCreation = (row: Witness | undefined) =>
  row !== undefined && evaluateScalarContract(row.created, current);

describe('full transaction identity regression (source and arithmetic, no PostgreSQL)', () => {
  it('A: should distinguish the retained historical audit despite a low32 collision', () => {
    expect(identityParts(BigInt(historical))[1]).toBe(
      identityParts(BigInt(current))[1],
    );
    expect(sameIdentity(BigInt(historical), BigInt(current))).toBe(false);
    expect(evaluateScalarContract(historical, current)).toBe(false);
  });

  it('B/C: should admit the first current audit and reject a real second one', () => {
    const audits: Witness[] = [{ id: 'retained', created: historical }];
    const canInsert = () => !audits.some(ownCreation);

    expect(canInsert()).toBe(true);
    audits.push({ id: 'first-current', created: current });
    expect(canInsert()).toBe(false);
    expect(definition('im_at_insert_guard')).toContain(
      'AND "conversationId" = NEW."conversationId" AND core.im_at_own_write("attentionCreatedTransactionId")',
    );
  });

  it('D: should agree with the independent generation/counter oracle across full xid8', () => {
    const generations = [
      BigInt('0'),
      BigInt('1'),
      BigInt('2'),
      BigInt('2097152'),
      BigInt('0xffffffff'),
    ];
    const counters = [
      BigInt('3'),
      BigInt('12345'),
      BigInt('0x7fffffff'),
      BigInt('0xffffffff'),
    ];

    for (const firstGeneration of generations) {
      for (const secondGeneration of generations) {
        for (const firstCounter of counters) {
          for (const secondCounter of counters) {
            const first = (firstGeneration << BigInt('32')) | firstCounter;
            const second = (secondGeneration << BigInt('32')) | secondCounter;

            expect(
              evaluateScalarContract(first.toString(), second.toString()),
            ).toBe(sameIdentity(first, second));
          }
        }
      }
    }
  });

  it.each([
    'Epoch',
    'Effect',
    'Receipt',
    'ResponseIntent',
    'TransitionAudit',
    'Message',
    'ProviderStatusEvent',
    'OutboxEvent',
  ])(
    'should fail closed for a historical or missing %s creation marker',
    () => {
      expect(ownCreation(undefined)).toBe(false);
      expect(ownCreation({ id: 'legacy', created: null })).toBe(false);
      expect(ownCreation({ id: 'old', created: historical })).toBe(false);
      expect(ownCreation({ id: 'new', created: current })).toBe(true);
      expect(ownCreation({ id: 'other-session', created: '8589946937' })).toBe(
        false,
      );
    },
  );

  it('E: should require current causes as well as exact original identities', () => {
    const audit = { id: 'new-audit', created: current };
    const satisfiesOriginal = (
      receipt: Witness | undefined,
      effect: Witness | undefined,
      originalAuditId: string,
    ) =>
      ownCreation(receipt) &&
      ownCreation(effect) &&
      originalAuditId === audit.id;

    expect(
      satisfiesOriginal(
        { id: 'receipt', created: historical },
        { id: 'effect', created: current },
        audit.id,
      ),
    ).toBe(false);
    expect(
      satisfiesOriginal(
        { id: 'receipt', created: current },
        { id: 'effect', created: historical },
        audit.id,
      ),
    ).toBe(false);
    expect(
      satisfiesOriginal(
        undefined,
        { id: 'effect', created: current },
        audit.id,
      ),
    ).toBe(false);
    expect(
      satisfiesOriginal(
        { id: 'receipt', created: current },
        undefined,
        audit.id,
      ),
    ).toBe(false);
    expect(
      satisfiesOriginal(
        { id: 'receipt', created: current },
        { id: 'effect', created: current },
        'wrong-audit',
      ),
    ).toBe(false);
    expect(
      satisfiesOriginal(
        { id: 'receipt', created: current },
        { id: 'effect', created: current },
        audit.id,
      ),
    ).toBe(true);
    const source = definition('im_at_audit_complete');

    expect(source).toContain(
      'receipt."originalAuditId" <> NEW."id" OR effect."canonicalReceiptId" <> receipt."id"',
    );
    expect(source).toContain(
      'NOT core.im_at_own_write(receipt."attentionCreatedTransactionId") OR NOT core.im_at_own_write(effect."attentionCreatedTransactionId")',
    );
  });

  it('F/G: should reject old Outbox rows even after lease updates and require a new matching audit', () => {
    const output = { id: 'output', created: historical, updated: current };
    const satisfiesOutput = (
      row: Witness | undefined,
      audit: Witness | undefined,
      exactKey: boolean,
    ) => ownCreation(row) && ownCreation(audit) && exactKey;

    expect(
      satisfiesOutput(output, { id: 'audit', created: current }, true),
    ).toBe(false);
    expect(
      satisfiesOutput(
        { ...output, created: current },
        { id: 'audit', created: historical },
        true,
      ),
    ).toBe(false);
    expect(
      satisfiesOutput(undefined, { id: 'audit', created: current }, true),
    ).toBe(false);
    expect(
      satisfiesOutput({ ...output, created: current }, undefined, true),
    ).toBe(false);
    expect(
      satisfiesOutput(
        { ...output, created: current },
        { id: 'audit', created: current },
        false,
      ),
    ).toBe(false);
    expect(
      satisfiesOutput(
        { ...output, created: current },
        { id: 'audit', created: current },
        true,
      ),
    ).toBe(true);
    expect(definition('im_at_audit_complete')).toContain(
      'core.im_at_own_write(output."attentionCreatedTransactionId")',
    );
    expect(definition('im_at_outbox_complete')).toContain(
      'core.im_at_own_write(audit."attentionCreatedTransactionId")',
    );
    expect(definition('im_at_outbox_complete')).toContain(
      'NEW."deduplicationKey" = core.im_at_outbox_key(',
    );
  });

  it('G: should separate Message creation from a current update and StatusEvent creation', () => {
    const message = { id: 'message', created: historical, updated: current };

    expect(ownCreation(message)).toBe(false);
    expect(evaluateScalarContract(message.updated, current)).toBe(true);
    expect(
      ownCreation({ id: 'old-status', created: historical, updated: current }),
    ).toBe(false);
    expect(evaluateScalarContract(null, current)).toBe(false);
    const source = definition('im_at_effect_complete');

    expect(source).toContain(`IF NEW."eventKind" = 'PROVIDER_EVIDENCE' THEN`);
    expect(source).toContain(
      'NOT core.im_at_own_write(message."attentionUpdatedTransactionId")',
    );
    expect(source).toContain(
      'ELSIF NOT core.im_at_own_write(message."attentionCreatedTransactionId")',
    );
    expect(source).toContain(
      'NOT core.im_at_own_write(status."attentionCreatedTransactionId")',
    );
  });

  it('H: should preserve historical originals for replay and require only the alias receipt to be new', () => {
    const original = { id: 'canonical', created: historical };
    const ownAlias = { id: 'alias', created: current };

    expect(ownCreation(original)).toBe(false);
    expect(ownCreation(ownAlias)).toBe(true);
    const source = definition('im_at_audit_complete');
    const alias = source
      .split(
        `ELSIF NEW."result"->>'reason' = 'SAME_INTENTION_OR_EVIDENCE' THEN`,
      )[1]
      .split('END IF;')[0];

    expect(alias).toContain(
      'receipt."originalAuditId" <> NEW."id" OR NOT core.im_at_own_write(receipt."attentionCreatedTransactionId")',
    );
    expect(alias).not.toContain('effect."attentionCreatedTransactionId"');
    expect(source).toContain(`ELSIF receipt."originalAuditId" = NEW."id" THEN`);
    // Historical relationship validation deliberately has no current-tx filter.
    expect(definition('im_at_validate_effect')).not.toContain(
      'im_at_own_write',
    );
    expect(definition('im_at_link_guard')).not.toContain('im_at_own_write');
  });

  it.each([
    'im_at_epoch_guard',
    'im_at_insert_guard',
    'im_at_message_guard',
    'im_at_status_guard',
    'im_at_outbox_guard',
  ])(
    'I: should generate creation identity inside PostgreSQL through %s',
    (name) => {
      expect(definition(name)).toContain(
        'NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;',
      );
    },
  );

  it.each(['im_at_message_guard', 'im_at_status_guard', 'im_at_outbox_guard'])(
    'I: should reject rewriting creation identity through %s',
    (name) => {
      expect(definition(name)).toContain(
        'NEW."attentionCreatedTransactionId" IS DISTINCT FROM OLD."attentionCreatedTransactionId"',
      );
    },
  );

  it('should overwrite client update markers and clear them on Message creation', () => {
    const source = definition('im_at_message_guard');

    expect(source).toContain(
      'NEW."attentionUpdatedTransactionId" := pg_current_xact_id()::text;',
    );
    expect(source).toContain('NEW."attentionUpdatedTransactionId" := NULL;');
    for (const table of ['STATUS', 'OUTBOX']) {
      expect(
        ATTENTION_LEDGER_UP.some((statement) =>
          statement.includes(
            `"TR_IM_AT_${table}_WRITE" BEFORE INSERT OR UPDATE OR DELETE`,
          ),
        ),
      ).toBe(true);
    }
    expect(ATTENTION_LEDGER_DOWN).toContain(
      'DROP FUNCTION core.im_at_own_write(text)',
    );
  });

  it('should retain Epoch creation identity through lifecycle updates', () => {
    const source = definition('im_at_epoch_guard');
    const updateBranch = source
      .split("IF TG_OP = 'UPDATE' THEN")[1]
      .split('     ELSE')[0];

    expect(updateBranch).toContain(
      "to_jsonb(NEW) - ARRAY['lifecycle','activatedAt','closedAt']",
    );
    expect(updateBranch).not.toContain('pg_current_xact_id');
    expect(
      ownCreation({ id: 'epoch', created: historical, updated: current }),
    ).toBe(false);
  });

  it('should count retained savepoint writes against the same top-level unit', () => {
    // The SQL API supplies the top-level ID even in a subtransaction. The model
    // only checks the identity invariant; it does not model savepoint execution.
    const retainedChildAudit: Witness = { id: 'child-audit', created: current };
    const audits = [retainedChildAudit];

    expect(audits.some(ownCreation)).toBe(true);
    // A rolled-back insert supplies no surviving witness for a later attempt.
    expect(
      audits.filter(({ id }) => id !== retainedChildAudit.id).some(ownCreation),
    ).toBe(false);
    expect(definition('im_at_own_write')).toContain('pg_current_xact_id()');
    expect(definition('im_at_insert_guard')).toContain(
      'one event per transaction',
    );
  });

  it('J: should remove all MVCC-version/low32 consumers and retain exact scoped witnesses', () => {
    expect(ATTENTION_LEDGER_UP.join('\n')).not.toMatch(
      /\bxmin\b|\bversion_xid\b|\bxid\b|4294967296|%/,
    );
    for (const [name, witness] of [
      ['im_at_conversation_guard', 'epoch'],
      ['im_at_conversation_guard', 'audit'],
      ['im_at_message_complete', 'effect'],
      ['im_at_audit_complete', 'effect'],
      ['im_at_audit_complete', 'receipt'],
      ['im_at_audit_complete', 'output'],
      ['im_at_outbox_complete', 'audit'],
    ]) {
      expect(definition(name)).toContain(
        `core.im_at_own_write(${witness}."attentionCreatedTransactionId")`,
      );
    }
    expect(
      normalizeAttentionSql(definition('im_at_conversation_guard')),
    ).toContain('audit."trackingEpochId" = NEW."attentionTrackingEpochId"');
  });
});
