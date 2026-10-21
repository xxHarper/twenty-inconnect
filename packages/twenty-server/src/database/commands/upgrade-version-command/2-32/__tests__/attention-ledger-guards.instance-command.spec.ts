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
  return normalizeAttentionSql(source);
};
const triggers = ATTENTION_LEDGER_UP.filter((statement) =>
  /^CREATE (?:CONSTRAINT )?TRIGGER/.test(statement),
);
const checkDefinitions = ATTENTION_LEDGER_UP.filter((statement) =>
  statement.includes('CHECK ('),
).join('\n');

describe('attention SQL integrity definitions (source inspection, no SQL execution)', () => {
  it.each(['Epoch', 'Effect', 'Receipt', 'ResponseIntent', 'TransitionAudit'])(
    'should retain %s history against update/delete/truncate as applicable',
    (name) => {
      const tableTriggers = triggers.filter((statement) =>
        statement.includes(`ON "core"."inconnectMessagingAttention${name}"`),
      );
      expect(
        tableTriggers.some(
          (statement) =>
            statement.includes('BEFORE TRUNCATE') &&
            statement.includes('im_at_immutable()'),
        ),
      ).toBe(true);
      if (name !== 'Epoch') {
        expect(
          tableTriggers.some(
            (statement) =>
              statement.includes('BEFORE UPDATE OR DELETE') &&
              statement.includes('im_at_immutable()'),
          ),
        ).toBe(true);
        expect(
          tableTriggers.some(
            (statement) =>
              statement.includes('BEFORE INSERT') &&
              statement.includes('im_at_insert_guard()'),
          ),
        ).toBe(true);
      } else {
        expect(
          tableTriggers.some(
            (statement) =>
              statement.includes('BEFORE INSERT OR UPDATE OR DELETE') &&
              statement.includes('im_at_epoch_guard()'),
          ),
        ).toBe(true);
      }
    },
  );

  it('should declare deferred row constraint triggers for both cycles and atomic deltas', () => {
    for (const name of [
      'EFFECT_LINKS',
      'RECEIPT_LINKS',
      'RESPONSEINTENT_LINKS',
      'AUDIT_COMPLETE',
      'MESSAGE_COMPLETE',
      'EPOCH_COMPLETE',
      'EFFECT_COMPLETE',
      'OUTBOX_COMPLETE',
    ]) {
      const statement = triggers.find((source) =>
        source.includes(`"TR_IM_AT_${name}"`),
      )!;
      expect(statement).toContain('CREATE CONSTRAINT TRIGGER');
      expect(statement).toContain('AFTER INSERT');
      expect(statement).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW');
    }
    expect(
      triggers.filter((source) =>
        source.startsWith('CREATE CONSTRAINT TRIGGER'),
      ),
    ).toHaveLength(8);
  });

  it('should close every nullable causal FK escape using local tuple checks', () => {
    const conversation = ATTENTION_LEDGER_UP.find((source) =>
      source.includes('ADD CONSTRAINT "CHK_IM_AT_CONVERSATION_STATE"'),
    )!;
    for (const name of [
      'attentionTrackingEpochId',
      'attentionStatus',
      'attentionRevision',
    ]) {
      expect(conversation).toContain(`"${name}" IS NULL`);
      expect(conversation).toContain(`"${name}" IS NOT NULL`);
    }
    const effect = ATTENTION_LEDGER_UP.find((source) =>
      source.startsWith(
        'CREATE TABLE "core"."inconnectMessagingAttentionEffect"',
      ),
    )!;
    expect(normalizeAttentionSql(effect)).toContain(
      `("eventKind" IN('INBOUND_RECEIVED','RESPONSE_INTENDED','PROVIDER_EVIDENCE'))=("messageId" IS NOT NULL)`,
    );
    expect(normalizeAttentionSql(effect)).toContain(
      `("eventKind" IN('RESPONSE_INTENDED','PROVIDER_EVIDENCE'))=("responseIntentId" IS NOT NULL)`,
    );
    expect(normalizeAttentionSql(effect)).toContain(
      `("eventKind" = 'PROVIDER_EVIDENCE')=("providerStatusEventId" IS NOT NULL)`,
    );
    expect(checkDefinitions).toContain('"canonicalReceiptId" uuid NOT NULL');
    expect(checkDefinitions).toContain('"originalAuditId" uuid NOT NULL');
    expect(checkDefinitions).toContain('"registeredEffectId" uuid NOT NULL');
    expect(definition('im_at_message_guard')).toContain(
      'NEW."attentionTrackingEpochId" IS DISTINCT FROM OLD."attentionTrackingEpochId"',
    );
  });

  it('should declare exact canonical, own-original and R1 historical alias comparisons', () => {
    const canonical = definition('im_at_validate_effect');
    expect(canonical).toContain('receipt."effectId" <> effect."id"');
    expect(canonical).toContain(
      `original."result"->>'kind' NOT IN('APPLIED','IGNORED')`,
    );
    expect(canonical).toContain(
      'ROW(receipt."eventKey",effect."effectKey",effect."fingerprint")',
    );
    const receipt = definition('im_at_link_guard');
    expect(receipt).toContain(`original."result"->>'kind' <> 'DUPLICATE'`);
    expect(receipt).toContain(
      `original."result"->>'reason' <> 'SAME_INTENTION_OR_EVIDENCE'`,
    );
    expect(receipt).toContain('core.im_at_compare_revision(');
    expect(receipt).toContain('epoch."bootstrapStatus"');
    expect(receipt).toContain(`canonical_audit."result" #> '{audit,before}'`);
    expect(receipt).toContain(`canonical_audit."result" #> '{audit,after}'`);
    expect(receipt).toContain(
      `canonical_state->>'revision' = original."result" #>> '{audit,before,revision}'`,
    );
    expect(receipt).toContain(
      `canonical_state->>'status' <> original."result" #>> '{audit,before,status}'`,
    );
  });

  it('should require bidirectional RESPONSE_INTENDED registration and frozen provenance/content/coverage', () => {
    const source = definition('im_at_validate_effect');
    for (const field of [
      'registeredEffectId',
      'messageId',
      'intentId',
      'contentFingerprint',
      'coveredRevision',
      'provenanceKind',
      'actorWorkspaceMemberId',
      'authorityReference',
      'format',
    ]) {
      expect(source).toContain(`intent."${field}"`);
    }
    expect(source).toContain(
      `original."result"->>'reason' <> 'RESPONSE_REGISTERED'`,
    );
    expect(source).toContain(
      'effect."fingerprint" <> core.im_at_compact(jsonb_build_array(',
    );
    expect(source).toContain(`registration."eventKind" = 'RESPONSE_INTENDED'`);
    expect(source).toContain(
      'core.im_at_validate_effect(intent."registeredEffectId")',
    );
    expect(definition('im_at_link_guard')).toContain(
      `"eventKind" = 'RESPONSE_INTENDED' AND "responseIntentId" = NEW."intentId"`,
    );
    expect(ATTENTION_LEDGER_UP.join('\n')).not.toMatch(
      /REFERENCES[^;]*[Ww]orkspaceMember/,
    );
  });

  it('should lock exact evidence dependencies and protect later status/webhook/provider-ID mutations', () => {
    const source = definition('im_at_validate_effect');
    expect(source).toContain('status."messageId" <> message."id"');
    expect(source).toContain('status."workspaceId" <> effect."workspaceId"');
    expect(source).toContain(
      `audit #>> '{evidence,providerMessageId}' IS DISTINCT FROM message."providerMessageId"`,
    );
    expect(source).toContain(
      `audit #>> '{evidence,status}' IS DISTINCT FROM status."normalizedStatus"`,
    );
    expect(source).toContain(
      'webhook."providerConnectionId" <> effect."providerConnectionId"',
    );
    expect(source.match(/FOR SHARE/g)).toHaveLength(3);
    expect(definition('im_at_status_guard')).toContain(
      'WHERE "providerStatusEventId" = OLD."id"',
    );
    expect(definition('im_at_webhook_guard')).toContain(
      'WHERE status."webhookReceiptId" = OLD."id"',
    );
    expect(definition('im_at_message_guard')).toContain(
      `"eventKind" = 'PROVIDER_EVIDENCE'`,
    );
    expect(definition('im_at_effect_complete')).toContain(
      'status."normalizedStatus" IS DISTINCT FROM message."outboundState"',
    );
  });

  it('should preserve legacy Pending exactly during explicit bootstrap and fence prepared aggregates before ENABLED', () => {
    const epoch = definition('im_at_epoch_guard');
    expect(epoch).toContain(
      'NEW."bootstrapPendingAt" IS DISTINCT FROM conversation."pendingAt"',
    );
    expect(epoch).toContain(
      'conversation."attentionTrackingEpochId" IS NOT NULL',
    );
    expect(epoch).toContain(`NEW."bootstrapRevision" <> '0'`);
    const conversation = definition('im_at_conversation_guard');
    expect(conversation).toContain(
      'NEW."pendingAt" IS DISTINCT FROM OLD."pendingAt"',
    );
    expect(conversation).toContain(
      'NEW."pendingAt" IS DISTINCT FROM epoch."bootstrapPendingAt"',
    );
    expect(conversation).toContain('NEW."pendingAt" := statement_timestamp()');
    expect(conversation).toContain(
      'core.im_at_next_revision(OLD."attentionRevision")',
    );
    expect(conversation).toContain('audit."result" #> \'{audit,before}\'');
    expect(conversation).toContain('audit."result" #> \'{audit,after}\'');
    expect(conversation).toContain('NEW."attentionTrackingEpochId",true)');
    const message = definition('im_at_message_guard');
    expect(message).toContain(
      `gate."attentionTrackingMode" = 'ENABLED' OR conversation."attentionTrackingEpochId" IS NOT NULL`,
    );
    expect(message).toContain("ELSIF TG_OP = 'UPDATE'");
    expect(message).toContain(
      'RETURN NEW; END IF; NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;',
    );
  });

  it('should require the shared gate/Conversation lock and reject caller-owned session flags as authority', () => {
    const source = definition('im_at_lock');
    expect(source.indexOf('FOR SHARE')).toBeLessThan(
      source.indexOf('FOR UPDATE'),
    );
    expect(source).toContain(`gate."attentionTrackingMode" <> 'ENABLED'`);
    expect(source).toContain(
      'gate."attentionWriterProtocolVersion" IS DISTINCT FROM 1',
    );
    expect(source).toContain(
      'conversation."attentionTrackingEpochId" IS DISTINCT FROM epoch_id',
    );
    expect(source).toContain(`"lifecycle" = 'READY'`);
    const all = ATTENTION_LEDGER_UP.join('\n');
    expect(all).not.toMatch(
      /current_setting|set_config|SET LOCAL|SECURITY DEFINER|GRANT |SKIP LOCKED|ON CONFLICT|CASCADE/,
    );
    expect(definition('im_at_configuration_guard')).toContain(
      `NEW."attentionTrackingMode" = 'DISABLED'`,
    );
    expect(definition('im_at_epoch_guard')).toContain(
      `OLD."lifecycle" = 'CLOSED' AND NEW IS DISTINCT FROM OLD`,
    );
  });

  it('should declare full-transaction audit, cause and Outbox completeness', () => {
    expect(definition('im_at_insert_guard')).toContain(
      'one event per transaction',
    );
    expect(definition('im_at_audit_complete')).toContain(
      'conflict cannot consume ledger keys',
    );
    expect(definition('im_at_audit_complete')).toContain(
      'receipt."originalAuditId" <> NEW."id"',
    );
    expect(definition('im_at_audit_complete')).toContain(
      'core.im_at_own_write(receipt."attentionCreatedTransactionId")',
    );
    expect(definition('im_at_audit_complete')).toContain(
      'core.im_at_own_write(output."attentionCreatedTransactionId")',
    );
    expect(definition('im_at_effect_complete')).toContain(
      'core.im_at_own_write(message."attentionUpdatedTransactionId")',
    );
    expect(definition('im_at_effect_complete')).toContain(
      'core.im_at_own_write(status."attentionCreatedTransactionId")',
    );
    expect(definition('im_at_message_complete')).toContain(
      `THEN 'INBOUND_RECEIVED' ELSE 'RESPONSE_INTENDED'`,
    );
    expect(definition('im_at_outbox_key')).toContain(
      `'attention-outbox-v1',workspace_id::text,conversation_id::text,connection_id::text,epoch_id::text,effect_key,'CONVERSATION_ATTENTION_CHANGED'`,
    );
    expect(definition('im_at_outbox_complete')).toContain(
      'core.im_at_outbox_key(',
    );
    expect(definition('im_at_own_write')).toContain('pg_current_xact_id()');
  });

  it('should keep all revision arithmetic decimal-text based and row-local JSON validation separate from cross-row guards', () => {
    for (const name of [
      'im_at_revision',
      'im_at_next_revision',
      'im_at_compare_revision',
    ]) {
      const source = definition(name);
      expect(source).not.toMatch(
        /::(?:bigint|integer|numeric)|Number|float|double/,
      );
      expect(source).toContain('IMMUTABLE');
    }
    const result = definition('im_at_result_valid');
    expect(result).toContain(
      'octet_length(core.im_at_compact(result))<= 65536',
    );
    expect(result).toContain('core.im_at_next_revision(before_revision)');
    expect(result).toContain(
      'core.im_at_compact(tuple)IS DISTINCT FROM fingerprint',
    );
    expect(result).not.toContain('FROM core.');
    expect(result).toContain('before_state = after_state');
    expect(result).toContain(
      `reason IN('SAME_EVENT','SAME_INTENTION_OR_EVIDENCE')`,
    );
    expect(result).toContain(`provenance->>'kind' <> 'HUMAN'`);
    expect(result).toContain(`evidence->>'status' NOT IN('DELIVERED','READ')`);
    expect(result).toContain("expected_reason := 'REVISION_NOT_CURRENT'");
    expect(result).not.toContain(
      "expected_reason := 'SUCCESS_POLICY_UNDECIDED'",
    );
  });

  it('should reverse every trigger/function and never overwrite a pre-existing SQL function', () => {
    for (const statement of triggers) {
      const name = /TRIGGER "([^"]+)"/.exec(statement)![1];
      const table = /ON "core"\."([^"]+)"/.exec(statement)![1];
      expect(ATTENTION_LEDGER_DOWN).toContain(
        `DROP TRIGGER "${name}" ON "core"."${table}"`,
      );
    }
    const functions = ATTENTION_LEDGER_UP.filter((statement) =>
      statement.startsWith('CREATE FUNCTION'),
    );
    expect(
      ATTENTION_LEDGER_DOWN.filter((statement) =>
        statement.startsWith('DROP FUNCTION'),
      ),
    ).toHaveLength(functions.length);
    for (const statement of functions) {
      const name = /^CREATE FUNCTION core\.([^ (]+)\(/.exec(statement)![1];
      expect(
        ATTENTION_LEDGER_DOWN.some((sql) =>
          sql.startsWith(`DROP FUNCTION core.${name}(`),
        ),
      ).toBe(true);
      expect(statement).toContain('SET search_path = pg_catalog');
    }
    expect(ATTENTION_LEDGER_UP.join('\n')).not.toContain('CREATE OR REPLACE');
  });
});
