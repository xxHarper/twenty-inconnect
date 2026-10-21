import { attentionTimestampMicroseconds } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-timestamp';
import {
  type AttentionSnapshot,
  type LogicalAttentionEffect,
  type LogicalAttentionIntent,
  type LogicalAttentionReceipt,
  type OriginalAttentionResult,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { validateAttentionSnapshot } from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';
import { type AttentionStoredResult } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import {
  type AttentionEffectRows,
  requireDecodedAttention,
  resolveAttentionEffectRows,
  resolveAttentionReceiptRows,
  resolveAttentionIntentRows,
  responseIntentFromRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-relational-validation';
import {
  decodeAttentionConversationColumns,
  decodeAttentionEpochRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import {
  decodeAttentionValue,
  rejectAttentionRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';

const consumedOriginal = (
  result: AttentionStoredResult,
): OriginalAttentionResult => {
  if (result.kind === 'CONFLICT')
    return rejectAttentionRow('IMPOSSIBLE_RESULT', '$.result.kind');
  return { kind: result.kind, reason: result.reason, audit: result.audit };
};

// These mappers materialize provided points. They never manufacture null slots
// or claim query completeness, readiness, locks, authentication or authorization.
export const mapAttentionEffect = (rows: AttentionEffectRows) =>
  decodeAttentionValue<LogicalAttentionEffect>(() => {
    const { effect, canonicalReceipt, canonicalAudit, scope } =
      resolveAttentionEffectRows(rows);
    return {
      scope,
      effectKey: effect.effectKey,
      fingerprint: effect.fingerprint,
      canonicalEventKey: canonicalReceipt.eventKey,
      original: consumedOriginal(canonicalAudit.result),
    };
  }, rows);

export const mapAttentionReceipt = (
  rows: Parameters<typeof resolveAttentionReceiptRows>[0],
) =>
  decodeAttentionValue<LogicalAttentionReceipt>(() => {
    const { effect, receipt, audit, scope } = resolveAttentionReceiptRows(rows);
    return {
      scope,
      eventKey: receipt.eventKey,
      effectKey: effect.effectKey,
      fingerprint: effect.fingerprint,
      original: consumedOriginal(audit.result),
    };
  }, rows);

export const mapAttentionIntent = (
  rows: AttentionEffectRows & Readonly<{ intent: unknown }>,
) =>
  decodeAttentionValue<LogicalAttentionIntent>(() => {
    const resolved = resolveAttentionIntentRows(rows);
    const { intent } = resolved;
    return { scope: resolved.scope, intent: responseIntentFromRow(intent) };
  }, rows);

export const mapAttentionSnapshot = (
  conversationValue: unknown,
  epochValue: unknown,
) =>
  decodeAttentionValue<AttentionSnapshot>(() => {
    const conversation = requireDecodedAttention(
      decodeAttentionConversationColumns(conversationValue),
    );
    const epoch = requireDecodedAttention(decodeAttentionEpochRow(epochValue));
    if (
      conversation.attentionTrackingEpochId === null ||
      conversation.attentionStatus === null ||
      conversation.attentionRevision === null
    )
      return rejectAttentionRow('INCOMPLETE_DATA', '$.conversation');
    if (
      conversation.id !== epoch.conversationId ||
      conversation.workspaceId !== epoch.workspaceId ||
      conversation.providerConnectionId !== epoch.providerConnectionId ||
      conversation.attentionTrackingEpochId !== epoch.id
    )
      return rejectAttentionRow('SCOPE_MISMATCH', '$.conversation');
    if (
      BigInt(conversation.attentionRevision) <
        BigInt(epoch.bootstrapRevision) ||
      (conversation.attentionRevision === epoch.bootstrapRevision &&
        (conversation.attentionStatus !== epoch.bootstrapStatus ||
          (conversation.pendingAt === null || epoch.bootstrapPendingAt === null
            ? conversation.pendingAt !== epoch.bootstrapPendingAt
            : attentionTimestampMicroseconds(conversation.pendingAt) !==
              attentionTimestampMicroseconds(epoch.bootstrapPendingAt))))
    )
      return rejectAttentionRow('IMPOSSIBLE_RESULT', '$.conversation.baseline');
    const snapshot = validateAttentionSnapshot({
      scope: {
        workspaceId: epoch.workspaceId,
        conversationId: epoch.conversationId,
        providerConnectionId: epoch.providerConnectionId,
        trackingEpochId: epoch.id,
      },
      status: conversation.attentionStatus,
      revision: conversation.attentionRevision,
    });
    if (!snapshot.ok)
      return rejectAttentionRow('IMPOSSIBLE_RESULT', '$.snapshot');
    return snapshot.value;
  }, conversationValue);
