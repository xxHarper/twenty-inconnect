import { randomUUID } from 'node:crypto';

import { copyAttentionEvent } from 'src/modules/inconnect-messaging/attention-adapter/attention-event-copy';
import { evaluateAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/evaluate-attention-projection';
import { decodeAttentionTransitionAuditRow } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import {
  decodeAttentionValue,
  nullableRowValue,
  rowObject,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import {
  AttentionReadFailure,
  decodeReadValue,
  readObject,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';
import { validateAttentionAdmission } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-admission';
import { verifyAttentionCausality } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-causality';
import {
  AttentionWriteFailure,
  createAttentionWriteSession,
  failAttentionWrite,
  writeAttentionRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-session';
import {
  ATTENTION_COMPLETE_SQL,
  ATTENTION_DEFER_SQL,
  ATTENTION_INSERT_AUDIT_SQL,
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_INSERT_INTENT_SQL,
  ATTENTION_INSERT_OUTBOX_SQL,
  ATTENTION_INSERT_RECEIPT_SQL,
  ATTENTION_UPDATE_CONVERSATION_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import {
  type AttentionWriterInput,
  type AttentionWriterResult,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';

import { admissionFailure } from './attention-admission-diagnostic';

// Inert internal component. The caller exclusively owns transaction lifecycle,
// causal DML and eventual publication. Every failure requires caller rollback.
export const prepareAttentionWrite = async ({
  queryRunner,
  input,
  causal,
  admit,
}: AttentionWriterInput): Promise<AttentionWriterResult> => {
  try {
    const requested = copyAttentionEvent(input);
    const cause = decodeReadValue(
      decodeAttentionValue(
        rowObject({
          webhook: nullableRowValue(
            rowObject({ id: rowUuid, leaseToken: rowUuid }),
          ),
          providerStatusEventId: nullableRowValue(rowUuid),
        }),
        causal,
      ),
    );
    const { session, control } = createAttentionWriteSession(queryRunner);
    // Pins the entire composition, including C2-II and the admission callback.
    await session.verify();
    const readResult = await readAttentionProjection({
      queryRunner,
      input: requested,
    });
    if (!readResult.ok)
      return { ok: false, callerMustRollback: true, error: readResult.error };
    await session.verify();
    const read = readResult.value;
    const evaluated = evaluateAttentionProjection(read.plan, read.facts);
    if (!evaluated.ok)
      return failAttentionWrite('INVALID_PROJECTION', '$.evaluation');
    const evaluation = evaluated.value;
    let admitted;
    try {
      admitted = await admit({
        queryRunner,
        input: read.plan.input,
        snapshot: read.plan.snapshot,
        consumption:
          evaluation.transition.kind === 'CONFLICT'
            ? 'CONFLICT'
            : evaluation.delta.effect !== null
              ? 'NEW'
              : 'CONSUMED',
      });
    } catch (error) {
      return {
        ok: false,
        callerMustRollback: true,
        error: admissionFailure(error),
      };
    }
    await session.verify();
    const admission = validateAttentionAdmission(
      admitted,
      read,
      evaluation,
      cause.providerStatusEventId,
    );
    await verifyAttentionCausality(session, read, evaluation, cause);
    const { plan, facts } = read;
    const { transition, delta } = evaluation;
    const { scope, event } = plan.input;
    const { eventKey, effectKey, fingerprint } = plan.identity;
    const parameters = [
      scope.workspaceId,
      scope.conversationId,
      scope.providerConnectionId,
      scope.trackingEpochId,
    ];
    const auditId = randomUUID();
    const effectId = delta.effect !== null ? randomUUID() : null;
    const receiptId = delta.receipt !== null ? randomUUID() : null;
    const responseIntentId = delta.intent !== null ? randomUUID() : null;
    const outboxId = transition.audit.attentionChanged ? randomUUID() : null;
    const outcome = {
      kind: transition.kind,
      reason: transition.reason,
      audit: transition.audit,
    };
    // Strict accepted decoder also enforces capacity BEFORE the first write.
    // recordedAt below is a validation placeholder only; SQL owns real timestamps.
    decodeReadValue(
      decodeAttentionTransitionAuditRow({
        ...scope,
        id: auditId,
        eventKey,
        effectKey,
        fingerprint,
        result: outcome,
        resultVersion: 1,
        authorityKind: admission.authorityKind,
        authenticationReference: admission.authenticationReference,
        correlationReference: admission.correlationReference,
        recordedAt: read.epoch.createdAt,
      }),
    );
    const insert = async (
      sql: string,
      values: readonly unknown[],
      expectedId: string,
    ) => {
      const written = readObject(
        { id: rowUuid },
        await writeAttentionRow(session, sql, values),
      );
      if (written.id !== expectedId)
        return failAttentionWrite('INCOMPLETE_WRITE', '$.write.id');
    };
    await control(ATTENTION_DEFER_SQL);
    if (effectId !== null) {
      await insert(
        ATTENTION_INSERT_EFFECT_SQL,
        [
          ...parameters,
          effectId,
          effectKey,
          fingerprint,
          receiptId,
          event.kind,
          transition.audit.messageId,
          event.kind === 'RESPONSE_INTENDED' ||
          event.kind === 'PROVIDER_EVIDENCE'
            ? transition.audit.intentId
            : null,
          cause.providerStatusEventId,
        ],
        effectId,
      );
    }
    // Must precede Conversation UPDATE and Receipt's immediate original FK.
    await insert(
      ATTENTION_INSERT_AUDIT_SQL,
      [
        ...parameters,
        auditId,
        eventKey,
        effectKey,
        fingerprint,
        JSON.stringify(outcome),
        admission.authorityKind,
        admission.authenticationReference,
        admission.correlationReference,
      ],
      auditId,
    );
    let receiptEffectId = null;
    if (receiptId !== null) {
      const receipt = readObject(
        { id: rowUuid, effectId: rowUuid },
        await writeAttentionRow(session, ATTENTION_INSERT_RECEIPT_SQL, [
          ...parameters,
          receiptId,
          eventKey,
          auditId,
          effectKey,
          fingerprint,
        ]),
      );
      if (
        receipt.id !== receiptId ||
        (effectId !== null && receipt.effectId !== effectId)
      )
        return failAttentionWrite('INCOMPLETE_WRITE', '$.write.receipt');
      receiptEffectId = receipt.effectId;
    }
    if (delta.intent !== null && responseIntentId !== null) {
      const intent = delta.intent.intent;
      await insert(
        ATTENTION_INSERT_INTENT_SQL,
        [
          ...parameters,
          responseIntentId,
          intent.intentId,
          intent.messageId,
          intent.contentFingerprint,
          intent.coveredRevision,
          intent.provenance.kind,
          intent.provenance.kind === 'HUMAN'
            ? intent.provenance.actorWorkspaceMemberId
            : null,
          intent.provenance.authorityReference,
          intent.format,
          effectId,
        ],
        responseIntentId,
      );
    }
    if (outboxId !== null) {
      await insert(
        ATTENTION_UPDATE_CONVERSATION_SQL,
        [
          ...parameters,
          transition.audit.before.status,
          transition.audit.before.revision,
          transition.audit.after.status,
          transition.audit.after.revision,
        ],
        scope.conversationId,
      );
      await insert(
        ATTENTION_INSERT_OUTBOX_SQL,
        [...parameters, outboxId, effectKey],
        outboxId,
      );
    }
    // Leaves these named constraints IMMEDIATE. No incomplete cycle is accepted
    // as PREPARED; commit and its possible failure remain the caller's concern.
    await control(ATTENTION_COMPLETE_SQL);
    return {
      ok: true,
      status: 'PREPARED',
      value: {
        outcome,
        snapshot: delta.snapshot,
        originals:
          transition.kind === 'CONFLICT'
            ? { eventResult: null, effectResult: null }
            : {
                eventResult:
                  facts.eventReceipt?.original ??
                  delta.receipt?.original ??
                  null,
                effectResult:
                  facts.effect?.original ?? delta.effect?.original ?? null,
              },
        rows: {
          auditId,
          effectId: effectId ?? receiptEffectId,
          receiptId,
          responseIntentId,
          outboxId,
        },
      },
    };
  } catch (error) {
    if (
      error instanceof AttentionReadFailure ||
      error instanceof AttentionWriteFailure
    )
      return { ok: false, callerMustRollback: true, error: error.failure };
    // Programming errors still reject the call; never return a partial outcome.
    throw error;
  }
};
