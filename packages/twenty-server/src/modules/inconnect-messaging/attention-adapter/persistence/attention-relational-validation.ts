import { originalAttentionResultKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-original-result';
import { attentionScopeKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';
import { type AttentionTrackingScope } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import { type AttentionResponseIntent } from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionPersistenceResult,
  type AttentionResponseIntentRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import {
  decodeAttentionEffectRow,
  decodeAttentionEpochRow,
  decodeAttentionMessageColumns,
  decodeAttentionProviderStatusColumns,
  decodeAttentionReceiptRow,
  decodeAttentionResponseIntentRow,
  decodeAttentionTransitionAuditRow,
  decodeAttentionWebhookColumns,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import {
  decodeAttentionValue,
  rejectAttentionRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';

// Missing dependents are errors. They are never interpreted as absent keys.
export type AttentionEffectRows = Readonly<{
  epoch: unknown;
  effect: unknown;
  canonicalReceipt: unknown;
  canonicalAudit: unknown;
  message?: unknown;
  intent?: unknown;
  providerStatus?: unknown;
  webhook?: unknown;
}>;

export const requireDecodedAttention = <TValue>(
  result: AttentionPersistenceResult<TValue>,
): TValue => {
  if (!result.ok)
    return rejectAttentionRow(result.error.code, result.error.path);
  return result.value;
};

const dependent = (value: unknown, path: string): unknown => {
  if (value === null || value === undefined)
    return rejectAttentionRow('INCOMPLETE_DATA', path);
  return value;
};

export const requireAttentionScope = (
  scope: AttentionTrackingScope,
  other: AttentionTrackingScope,
): void => {
  if (attentionScopeKey(scope) !== attentionScopeKey(other))
    return rejectAttentionRow('SCOPE_MISMATCH', '$.scope');
};

export const responseIntentFromRow = (
  row: AttentionResponseIntentRow,
): AttentionResponseIntent => ({
  intentId: row.intentId,
  messageId: row.messageId,
  contentFingerprint: row.contentFingerprint,
  coveredRevision: row.coveredRevision,
  format: row.format,
  provenance:
    row.provenanceKind === 'HUMAN'
      ? {
          kind: row.provenanceKind,
          actorWorkspaceMemberId: row.actorWorkspaceMemberId!,
          authorityReference: row.authorityReference,
        }
      : {
          kind: row.provenanceKind,
          authorityReference: row.authorityReference,
        },
});

export const resolveAttentionEffectRows = (rows: AttentionEffectRows) => {
  const epoch = requireDecodedAttention(
    decodeAttentionEpochRow(dependent(rows.epoch, '$.epoch')),
  );
  const effect = requireDecodedAttention(
    decodeAttentionEffectRow(dependent(rows.effect, '$.effect')),
  );
  const canonicalReceipt = requireDecodedAttention(
    decodeAttentionReceiptRow(
      dependent(rows.canonicalReceipt, '$.canonicalReceipt'),
    ),
  );
  const canonicalAudit = requireDecodedAttention(
    decodeAttentionTransitionAuditRow(
      dependent(rows.canonicalAudit, '$.canonicalAudit'),
    ),
  );
  const scope = {
    workspaceId: epoch.workspaceId,
    conversationId: epoch.conversationId,
    providerConnectionId: epoch.providerConnectionId,
    trackingEpochId: epoch.id,
  };
  for (const row of [effect, canonicalReceipt, canonicalAudit])
    requireAttentionScope(scope, row);
  if (
    effect.canonicalReceiptId !== canonicalReceipt.id ||
    canonicalReceipt.effectId !== effect.id ||
    canonicalReceipt.originalAuditId !== canonicalAudit.id ||
    canonicalReceipt.eventKey !== canonicalAudit.eventKey ||
    canonicalAudit.effectKey !== effect.effectKey ||
    canonicalAudit.fingerprint !== effect.fingerprint ||
    !['APPLIED', 'IGNORED'].includes(canonicalAudit.result.kind)
  )
    return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', '$.canonicalReceipt');
  for (const state of [
    canonicalAudit.result.audit.before,
    canonicalAudit.result.audit.after,
  ]) {
    if (
      BigInt(state.revision) < BigInt(epoch.bootstrapRevision) ||
      (state.revision === epoch.bootstrapRevision &&
        state.status !== epoch.bootstrapStatus)
    )
      return rejectAttentionRow(
        'IMPOSSIBLE_RESULT',
        '$.canonicalAudit.baseline',
      );
  }
  const checked = [
    'EPOCH_SCOPE',
    'CANONICAL_RECEIPT',
    'CANONICAL_ORIGINAL',
    'EPOCH_BASELINE_STATUS',
  ];
  const unresolved = [
    'POSTGRESQL_CONSTRAINTS',
    'TRANSACTIONAL_COMPLETENESS',
    'CURRENT_AUTHORITY',
  ];
  if (effect.messageId !== null) {
    const message = requireDecodedAttention(
      decodeAttentionMessageColumns(dependent(rows.message, '$.message')),
    );
    requireAttentionScope(scope, {
      ...message,
      trackingEpochId: message.attentionTrackingEpochId ?? '',
    });
    if (
      message.id !== effect.messageId ||
      message.direction !==
        (effect.eventKind === 'INBOUND_RECEIVED' ? 'INBOUND' : 'OUTBOUND')
    )
      return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', '$.message');
    checked.push('MESSAGE_SCOPE_AND_DIRECTION');
    if (effect.responseIntentId !== null) {
      const intent = requireDecodedAttention(
        decodeAttentionResponseIntentRow(dependent(rows.intent, '$.intent')),
      );
      requireAttentionScope(scope, intent);
      const audit = canonicalAudit.result.audit;
      const logicalIntent = responseIntentFromRow(intent);
      if (
        intent.intentId !== effect.responseIntentId ||
        intent.messageId !== message.id ||
        intent.format !== message.sendMode ||
        audit.intentId !== intent.intentId ||
        audit.messageId !== message.id ||
        audit.coveredRevision !== intent.coveredRevision ||
        JSON.stringify(audit.provenance) !==
          JSON.stringify(logicalIntent.provenance)
      )
        return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', '$.intent');
      if (
        effect.eventKind === 'RESPONSE_INTENDED' &&
        (intent.registeredEffectId !== effect.id ||
          canonicalAudit.result.kind !== 'APPLIED' ||
          canonicalAudit.result.reason !== 'RESPONSE_REGISTERED' ||
          getAttentionEventIdentity({
            kind: 'RESPONSE_INTENDED',
            scope,
            eventKey: canonicalReceipt.eventKey,
            intent: logicalIntent,
          }).fingerprint !== effect.fingerprint)
      )
        return rejectAttentionRow(
          'INVALID_CAUSAL_REFERENCE',
          '$.intent.registeredEffectId',
        );
      checked.push('INTENT_MESSAGE_AND_FROZEN_HISTORY');
      if (effect.eventKind === 'PROVIDER_EVIDENCE') {
        unresolved.push('INTENT_REGISTRATION_LINK');
        const status = requireDecodedAttention(
          decodeAttentionProviderStatusColumns(
            dependent(rows.providerStatus, '$.providerStatus'),
          ),
        );
        const evidence = audit.evidence;
        if (
          status.id !== effect.providerStatusEventId ||
          status.messageId !== message.id ||
          status.workspaceId !== scope.workspaceId ||
          evidence === null ||
          evidence.providerMessageId !== message.providerMessageId ||
          evidence.status !== status.normalizedStatus
        )
          return rejectAttentionRow(
            'INVALID_CAUSAL_REFERENCE',
            '$.providerStatus',
          );
        if (status.webhookReceiptId !== null) {
          const webhook = requireDecodedAttention(
            decodeAttentionWebhookColumns(dependent(rows.webhook, '$.webhook')),
          );
          if (
            webhook.id !== status.webhookReceiptId ||
            webhook.workspaceId !== scope.workspaceId ||
            webhook.providerConnectionId !== scope.providerConnectionId
          )
            return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', '$.webhook');
          checked.push('WEBHOOK_CONNECTION');
        }
        // C2 does not choose evidenceId = status UUID or providerEventKey.
        // Keep the logical identity exact; backend binding remains integration work.
        unresolved.push(
          'EVIDENCE_ID_BINDING',
          'PROVIDER_AUTHENTICATION_AND_OUTBOUND_ADMISSION',
        );
        checked.push('PROVIDER_STATUS_MESSAGE_AND_NORMALIZED_STATUS');
      }
    }
  }
  return {
    epoch,
    effect,
    canonicalReceipt,
    canonicalAudit,
    scope,
    checked,
    unresolved,
  };
};

export const resolveAttentionReceiptRows = (
  rows: AttentionEffectRows &
    Readonly<{ receipt: unknown; originalAudit: unknown }>,
) => {
  const resolved = resolveAttentionEffectRows(rows);
  const receipt = requireDecodedAttention(
    decodeAttentionReceiptRow(dependent(rows.receipt, '$.receipt')),
  );
  const audit = requireDecodedAttention(
    decodeAttentionTransitionAuditRow(
      dependent(rows.originalAudit, '$.originalAudit'),
    ),
  );
  requireAttentionScope(resolved.scope, receipt);
  requireAttentionScope(resolved.scope, audit);
  const canonical = receipt.id === resolved.canonicalReceipt.id;
  if (
    receipt.effectId !== resolved.effect.id ||
    receipt.originalAuditId !== audit.id ||
    receipt.eventKey !== audit.eventKey ||
    audit.effectKey !== resolved.effect.effectKey ||
    audit.fingerprint !== resolved.effect.fingerprint ||
    (canonical
      ? audit.id !== resolved.canonicalAudit.id
      : audit.result.kind !== 'DUPLICATE' ||
        audit.result.reason !== 'SAME_INTENTION_OR_EVIDENCE' ||
        receipt.eventKey === resolved.canonicalReceipt.eventKey)
  )
    return rejectAttentionRow(
      'INVALID_CAUSAL_REFERENCE',
      '$.receipt.originalAuditId',
    );
  if (
    BigInt(audit.result.audit.before.revision) <
      BigInt(resolved.canonicalAudit.result.audit.after.revision) &&
    !canonical
  )
    return rejectAttentionRow(
      'IMPOSSIBLE_RESULT',
      '$.receipt.originalAudit.revision',
    );
  // A revision identifies one status in this epoch; later aliases may differ.
  const knownStates = [
    {
      status: resolved.epoch.bootstrapStatus,
      revision: resolved.epoch.bootstrapRevision,
    },
    resolved.canonicalAudit.result.audit.before,
    resolved.canonicalAudit.result.audit.after,
  ];
  if (
    knownStates.some(
      (state) =>
        state.revision === audit.result.audit.before.revision &&
        state.status !== audit.result.audit.before.status,
    )
  )
    return rejectAttentionRow(
      'IMPOSSIBLE_RESULT',
      '$.receipt.originalAudit.status',
    );
  const cause = (result: typeof audit.result) => {
    const {
      eventKind,
      intentId,
      messageId,
      actorWorkspaceMemberId,
      coveredRevision,
      provenance,
      evidence,
    } = result.audit;
    return JSON.stringify([
      eventKind,
      intentId,
      messageId,
      actorWorkspaceMemberId,
      coveredRevision,
      provenance,
      evidence,
    ]);
  };
  if (cause(audit.result) !== cause(resolved.canonicalAudit.result))
    return rejectAttentionRow(
      'INVALID_CAUSAL_REFERENCE',
      '$.receipt.originalAudit.cause',
    );
  if (
    canonical &&
    (audit.result.kind !== resolved.canonicalAudit.result.kind ||
      originalAttentionResultKey({ ...audit.result, kind: 'APPLIED' }) !==
        originalAttentionResultKey({
          ...resolved.canonicalAudit.result,
          kind: 'APPLIED',
        }))
  )
    return rejectAttentionRow(
      'IMPOSSIBLE_RESULT',
      '$.receipt.canonicalOriginal',
    );
  return { ...resolved, receipt, audit };
};

export const validateAttentionEffectRelations = (rows: AttentionEffectRows) =>
  decodeAttentionValue(() => {
    const { checked, unresolved } = resolveAttentionEffectRows(rows);
    return { checked, unresolved };
  }, rows);

export const validateAttentionReceiptRelations = (
  rows: Parameters<typeof resolveAttentionReceiptRows>[0],
) =>
  decodeAttentionValue(() => {
    const { checked, unresolved } = resolveAttentionReceiptRows(rows);
    return { checked: [...checked, 'RECEIPT_OWN_ORIGINAL'], unresolved };
  }, rows);

export const resolveAttentionIntentRows = (
  rows: AttentionEffectRows & Readonly<{ intent: unknown }>,
) => {
  const resolved = resolveAttentionEffectRows(rows);
  const intent = requireDecodedAttention(
    decodeAttentionResponseIntentRow(rows.intent),
  );
  if (
    resolved.effect.eventKind !== 'RESPONSE_INTENDED' ||
    intent.registeredEffectId !== resolved.effect.id
  )
    return rejectAttentionRow(
      'INVALID_CAUSAL_REFERENCE',
      '$.intent.registeredEffectId',
    );
  return { ...resolved, intent };
};

export const validateAttentionIntentRelations = (
  rows: Parameters<typeof resolveAttentionIntentRows>[0],
) =>
  decodeAttentionValue(() => {
    const { checked, unresolved } = resolveAttentionIntentRows(rows);
    return { checked: [...checked, 'INTENT_REGISTRATION_LINK'], unresolved };
  }, rows);
