import { originalAttentionResultKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-original-result';
import {
  type AttentionResponseIntent,
  type ResponseProvenance,
  transitionConversationAttention,
} from 'src/modules/inconnect-messaging/attention-domain';
import {
  type AttentionStoredResult,
  type AttentionTransitionAuditRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { eventFromAttentionFingerprint } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-fingerprint-decoder';
import {
  type RowDecoder,
  nullableRowValue,
  rejectAttentionRow,
  rowBoolean,
  rowChoice,
  rowEventKind,
  rowObject,
  rowProviderStatus,
  rowProvenanceKind,
  rowRevision,
  rowStatus,
  rowText,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';

const provenance: RowDecoder<ResponseProvenance> = (value, path) => {
  if (value === null) return rejectAttentionRow('INVALID_NULL', path);
  if (typeof value !== 'object') return rejectAttentionRow('WRONG_TYPE', path);
  const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (descriptor === undefined)
    return rejectAttentionRow('MISSING_FIELD', `${path}.kind`);
  if (!('value' in descriptor))
    return rejectAttentionRow('WRONG_TYPE', `${path}.kind`);
  const kind = rowProvenanceKind(descriptor.value, `${path}.kind`);
  return kind === 'HUMAN'
    ? rowObject({
        kind: rowChoice(['HUMAN'] as const),
        actorWorkspaceMemberId: rowUuid,
        authorityReference: rowText(16384),
      })(value, path)
    : rowObject({
        kind: rowChoice(['AUTOMATION', 'LEGACY_UNKNOWN'] as const),
        authorityReference: rowText(16384),
      })(value, path);
};

export const storedResultDecoder: RowDecoder<AttentionStoredResult> = rowObject(
  {
    kind: rowChoice(['APPLIED', 'IGNORED', 'DUPLICATE', 'CONFLICT'] as const),
    reason: rowChoice([
      'INBOUND_OPENED',
      'MANUAL_PENDING_RENEWED',
      'MANUAL_ATTENDED',
      'RESPONSE_REGISTERED',
      'HUMAN_RESPONSE_CONFIRMED',
      'READ_DOES_NOT_ATTEND',
      'NON_HUMAN_RESPONSE',
      'INSUFFICIENT_PROVIDER_EVIDENCE',
      'SUCCESS_POLICY_UNDECIDED',
      'REVISION_NOT_CURRENT',
      'ALREADY_ATTENDED',
      'SAME_EVENT',
      'SAME_INTENTION_OR_EVIDENCE',
      'IDEMPOTENCY_CONFLICT',
      'SCOPE_MISMATCH',
      'INVALID_REVISION',
      'FUTURE_REVISION',
      'STALE_MANUAL_ATTENDED',
      'STALE_RESPONSE_INTENT',
      'RESPONSE_INTENT_NOT_FOUND',
      'MESSAGE_IDENTITY_CONFLICT',
    ] as const),
    audit: rowObject({
      scope: rowObject({
        workspaceId: rowUuid,
        conversationId: rowUuid,
        providerConnectionId: rowUuid,
      }),
      eventKey: rowText(1024),
      effectKey: rowText(1024),
      eventKind: rowEventKind,
      before: rowObject({ status: rowStatus, revision: rowRevision }),
      after: rowObject({ status: rowStatus, revision: rowRevision }),
      attentionChanged: rowBoolean,
      intentId: nullableRowValue(rowText(128)),
      messageId: nullableRowValue(rowUuid),
      actorWorkspaceMemberId: nullableRowValue(rowUuid),
      coveredRevision: nullableRowValue(rowRevision),
      provenance: nullableRowValue(provenance),
      evidence: nullableRowValue(
        rowObject({
          evidenceId: rowText(16384),
          providerMessageId: rowText(16384),
          status: rowProviderStatus,
        }),
      ),
      successPolicy: rowChoice(['PROPOSED_DELIVERED_OR_READ'] as const, true),
    }),
  },
);

// Compare the whole audit with the accepted reducer, including its null fields.
// Synthetic receipts below model only a claimed duplicate/collision, never SQL.
export const validateStoredAttentionResult = (
  row: AttentionTransitionAuditRow,
): void => {
  const { result } = row;
  const { audit } = result;
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536)
    return rejectAttentionRow('CAPACITY_EXCEEDED', '$.result');
  if (
    ['workspaceId', 'conversationId', 'providerConnectionId'].some(
      (key) =>
        row[key as keyof typeof audit.scope] !==
        audit.scope[key as keyof typeof audit.scope],
    )
  )
    return rejectAttentionRow('SCOPE_MISMATCH', '$.result.audit.scope');
  const event = eventFromAttentionFingerprint(
    row.fingerprint,
    row.eventKey,
    audit.scope,
  );
  const identity = getAttentionEventIdentity(event);
  if (
    (event.kind === 'MESSAGES_READ' &&
      result.reason === 'SAME_INTENTION_OR_EVIDENCE') ||
    (result.kind === 'DUPLICATE' &&
      audit.coveredRevision !== null &&
      BigInt(audit.coveredRevision) > BigInt(audit.before.revision)) ||
    (event.kind === 'PROVIDER_EVIDENCE' &&
      result.kind !== 'CONFLICT' &&
      (audit.provenance === null || audit.coveredRevision === null))
  )
    return rejectAttentionRow('IMPOSSIBLE_RESULT', '$.result.causalHistory');
  if (
    identity.effectKey !== row.effectKey ||
    audit.effectKey !== row.effectKey ||
    audit.eventKey !== row.eventKey ||
    audit.eventKind !== event.kind
  )
    return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', '$.result.audit');

  const intent: AttentionResponseIntent | null =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent
      : event.kind === 'PROVIDER_EVIDENCE' &&
          audit.provenance !== null &&
          audit.coveredRevision !== null
        ? {
            intentId: event.intentId,
            messageId: event.messageId,
            coveredRevision: audit.coveredRevision,
            contentFingerprint: 'historical-evidence-validation',
            format: 'FREEFORM',
            provenance: audit.provenance,
          }
        : null;
  let responseIntents =
    intent === null || event.kind === 'RESPONSE_INTENDED' ? [] : [intent];
  if (result.reason === 'MESSAGE_IDENTITY_CONFLICT') {
    if (event.kind === 'RESPONSE_INTENDED') responseIntents = [event.intent];
    else if (event.kind === 'PROVIDER_EVIDENCE' && intent !== null)
      responseIntents = [
        {
          ...intent,
          messageId: `${event.messageId}:different-message`,
        },
      ];
  }
  const receipts =
    result.kind === 'DUPLICATE'
      ? [
          {
            eventKey:
              result.reason === 'SAME_EVENT'
                ? event.eventKey
                : `${event.eventKey}:canonical`,
            ...identity,
          },
        ]
      : result.kind === 'CONFLICT' && result.reason === 'IDEMPOTENCY_CONFLICT'
        ? [
            {
              eventKey: event.eventKey,
              ...identity,
              fingerprint: `${row.fingerprint}:collision`,
            },
          ]
        : [];
  const expected = transitionConversationAttention({
    state: {
      scope: audit.scope,
      ...{ status: audit.before.status, revision: audit.before.revision },
      responseIntents,
      receipts,
    },
    event,
    successPolicy: 'PROPOSED_DELIVERED_OR_READ',
  });
  // The comparison helper is field-wise and independent of JSONB key order.
  const comparable = (value: AttentionStoredResult) =>
    JSON.stringify([
      value.kind,
      originalAttentionResultKey({ ...value, kind: 'APPLIED' }),
    ]);
  if (comparable(result) !== comparable(expected))
    return rejectAttentionRow('IMPOSSIBLE_RESULT', '$.result');
};
