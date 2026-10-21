import { attentionTimestampMicroseconds } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-timestamp';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import { eventFromAttentionFingerprint } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-fingerprint-decoder';
import {
  type AttentionConversationColumns,
  type AttentionEffectRow,
  type AttentionEpochRow,
  type AttentionMessageColumns,
  type AttentionProviderStatusColumns,
  type AttentionReceiptRow,
  type AttentionResponseIntentRow,
  type AttentionTransitionAuditRow,
  type AttentionWebhookColumns,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import {
  storedResultDecoder,
  validateStoredAttentionResult,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-result-decoder';
import {
  type RowDecoder,
  decodeAttentionValue,
  nullableRowValue,
  rejectAttentionRow,
  rowBoolean,
  rowChoice,
  rowEventKind,
  rowFormat,
  rowObject,
  rowProvenanceKind,
  rowProviderStatus,
  rowRevision,
  rowScope,
  rowStatus,
  rowText,
  rowTimestamp,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';

const epochDecoder: RowDecoder<AttentionEpochRow> = (value, path) => {
  const row = rowObject({
    id: rowUuid,
    workspaceId: rowUuid,
    conversationId: rowUuid,
    providerConnectionId: rowUuid,
    identityVersion: rowChoice(['attention-domain-v1'] as const, true),
    reducerVersion: rowChoice(['attention-reducer-v1'] as const, true),
    successPolicy: rowChoice(['PROPOSED_DELIVERED_OR_READ'] as const, true),
    lifecycle: rowChoice([
      'PREPARING',
      'READY',
      'SUSPENDED',
      'CLOSED',
    ] as const),
    bootstrapStatus: rowStatus,
    bootstrapRevision: rowRevision,
    bootstrapPendingAt: nullableRowValue(rowTimestamp),
    bootstrapReference: rowText(16384),
    createdAt: rowTimestamp,
    activatedAt: nullableRowValue(rowTimestamp),
    closedAt: nullableRowValue(rowTimestamp),
  })(value, path);
  if (row.bootstrapRevision !== '0')
    return rejectAttentionRow('INVALID_REVISION', `${path}.bootstrapRevision`);
  if ((row.bootstrapStatus === 'PENDING') !== (row.bootstrapPendingAt !== null))
    return rejectAttentionRow('INVALID_VALUE', `${path}.bootstrapPendingAt`);
  if (
    (row.lifecycle === 'CLOSED') !== (row.closedAt !== null) ||
    (row.lifecycle === 'PREPARING' && row.activatedAt !== null) ||
    (row.lifecycle === 'READY' && row.activatedAt === null)
  )
    return rejectAttentionRow('INVALID_VALUE', `${path}.lifecycle`);
  const created = attentionTimestampMicroseconds(row.createdAt);
  const activated =
    row.activatedAt === null
      ? null
      : attentionTimestampMicroseconds(row.activatedAt);
  const closed =
    row.closedAt === null ? null : attentionTimestampMicroseconds(row.closedAt);
  if (
    (activated !== null && activated < created) ||
    (closed !== null &&
      (closed < created || (activated !== null && closed < activated)))
  )
    return rejectAttentionRow('INVALID_VALUE', `${path}.lifecycleTimestamps`);
  return row;
};

const effectDecoder: RowDecoder<AttentionEffectRow> = (value, path) => {
  const row = rowObject({
    ...rowScope,
    id: rowUuid,
    effectKey: rowText(1024),
    fingerprint: rowText(16384),
    canonicalReceiptId: rowUuid,
    eventKind: rowEventKind,
    messageId: nullableRowValue(rowUuid),
    responseIntentId: nullableRowValue(rowText(128)),
    providerStatusEventId: nullableRowValue(rowUuid),
    createdAt: rowTimestamp,
  })(value, path);
  // READ identity includes eventKey, which is deliberately stored only on Receipt.
  const tuple: unknown = (() => {
    try {
      return JSON.parse(row.effectKey);
    } catch {
      return null;
    }
  })();
  const eventKey =
    row.eventKind === 'MESSAGES_READ' &&
    Array.isArray(tuple) &&
    typeof tuple[1] === 'string'
      ? rowText(1024)(tuple[1], `${path}.effectKey.eventKey`)
      : 'physical-row-validation';
  const event = eventFromAttentionFingerprint(row.fingerprint, eventKey, row);
  const messageId =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent.messageId
      : event.kind === 'INBOUND_RECEIVED' || event.kind === 'PROVIDER_EVIDENCE'
        ? event.messageId
        : null;
  const intentId =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent.intentId
      : event.kind === 'PROVIDER_EVIDENCE'
        ? event.intentId
        : null;
  if (
    event.kind !== row.eventKind ||
    getAttentionEventIdentity(event).effectKey !== row.effectKey ||
    row.messageId !== messageId ||
    row.responseIntentId !== intentId ||
    (row.eventKind === 'PROVIDER_EVIDENCE') !==
      (row.providerStatusEventId !== null)
  )
    return rejectAttentionRow('INVALID_CAUSAL_REFERENCE', path);
  return row;
};

const receiptDecoder: RowDecoder<AttentionReceiptRow> = rowObject({
  ...rowScope,
  id: rowUuid,
  eventKey: rowText(1024),
  effectId: rowUuid,
  originalAuditId: rowUuid,
  createdAt: rowTimestamp,
});

const intentDecoder: RowDecoder<AttentionResponseIntentRow> = (value, path) => {
  const row = rowObject({
    ...rowScope,
    id: rowUuid,
    intentId: rowText(128),
    messageId: rowUuid,
    contentFingerprint: rowText(16384),
    coveredRevision: rowRevision,
    provenanceKind: rowProvenanceKind,
    actorWorkspaceMemberId: nullableRowValue(rowUuid),
    authorityReference: rowText(16384),
    format: rowFormat,
    registeredEffectId: rowUuid,
    createdAt: rowTimestamp,
  })(value, path);
  if (
    (row.provenanceKind === 'HUMAN') !==
    (row.actorWorkspaceMemberId !== null)
  )
    return rejectAttentionRow(
      'INVALID_CAUSAL_REFERENCE',
      `${path}.actorWorkspaceMemberId`,
    );
  return row;
};

const auditDecoder: RowDecoder<AttentionTransitionAuditRow> = (value, path) => {
  const row = rowObject({
    ...rowScope,
    id: rowUuid,
    eventKey: rowText(1024),
    effectKey: rowText(1024),
    fingerprint: rowText(16384),
    result: storedResultDecoder,
    resultVersion: rowChoice([1] as const, true),
    authorityKind: rowChoice(['HUMAN', 'BACKEND', 'PROVIDER'] as const),
    authenticationReference: rowText(16384),
    correlationReference: nullableRowValue(rowText(16384)),
    recordedAt: rowTimestamp,
  })(value, path);
  const kind = row.result.audit.eventKind;
  if (
    (kind === 'PROVIDER_EVIDENCE' &&
      (row.authorityKind !== 'PROVIDER' ||
        row.correlationReference === null)) ||
    (['MANUAL_ACTION', 'MESSAGES_READ'].includes(kind) &&
      row.authorityKind !== 'HUMAN') ||
    (kind === 'INBOUND_RECEIVED' && row.authorityKind === 'HUMAN') ||
    (kind === 'RESPONSE_INTENDED' &&
      row.authorityKind !==
        (row.result.audit.provenance?.kind === 'HUMAN' ? 'HUMAN' : 'BACKEND'))
  )
    return rejectAttentionRow(
      'INVALID_CAUSAL_REFERENCE',
      `${path}.authorityKind`,
    );
  validateStoredAttentionResult(row);
  return row;
};

const conversationDecoder: RowDecoder<AttentionConversationColumns> = (
  value,
  path,
) => {
  const row = rowObject({
    id: rowUuid,
    workspaceId: rowUuid,
    providerConnectionId: rowUuid,
    attentionTrackingEpochId: nullableRowValue(rowUuid),
    attentionStatus: nullableRowValue(rowStatus),
    attentionRevision: nullableRowValue(rowRevision),
    pendingAt: nullableRowValue(rowTimestamp),
  })(value, path);
  const fields = [
    row.attentionTrackingEpochId,
    row.attentionStatus,
    row.attentionRevision,
  ];
  if (
    fields.some((field) => field === null) &&
    fields.some((field) => field !== null)
  )
    return rejectAttentionRow('INCOMPLETE_DATA', path);
  if (
    row.attentionStatus !== null &&
    (row.attentionStatus === 'PENDING') !== (row.pendingAt !== null)
  )
    return rejectAttentionRow('INVALID_VALUE', `${path}.pendingAt`);
  return row;
};

const messageDecoder: RowDecoder<AttentionMessageColumns> = (value, path) => {
  const row = rowObject({
    id: rowUuid,
    workspaceId: rowUuid,
    conversationId: rowUuid,
    providerConnectionId: rowUuid,
    attentionTrackingEpochId: nullableRowValue(rowUuid),
    direction: rowChoice(['INBOUND', 'OUTBOUND'] as const),
    sendMode: nullableRowValue(rowFormat),
    providerMessageId: nullableRowValue(rowText(16384)),
  })(value, path);
  if ((row.direction === 'OUTBOUND') !== (row.sendMode !== null))
    return rejectAttentionRow('INVALID_VALUE', `${path}.sendMode`);
  return row;
};

const providerStatusDecoder: RowDecoder<AttentionProviderStatusColumns> =
  rowObject({
    id: rowUuid,
    workspaceId: rowUuid,
    messageId: rowUuid,
    webhookReceiptId: nullableRowValue(rowUuid),
    providerEventKey: nullableRowValue(rowText(16384)),
    originalStatus: rowText(16384),
    normalizedStatus: rowProviderStatus,
    appliedToProjection: rowBoolean,
  });
const webhookDecoder: RowDecoder<AttentionWebhookColumns> = rowObject({
  id: rowUuid,
  workspaceId: rowUuid,
  providerConnectionId: rowUuid,
  eventKind: rowText(16384),
});

export const decodeAttentionEpochRow = (value: unknown) =>
  decodeAttentionValue(epochDecoder, value);
export const decodeAttentionEffectRow = (value: unknown) =>
  decodeAttentionValue(effectDecoder, value);
export const decodeAttentionReceiptRow = (value: unknown) =>
  decodeAttentionValue(receiptDecoder, value);
export const decodeAttentionResponseIntentRow = (value: unknown) =>
  decodeAttentionValue(intentDecoder, value);
export const decodeAttentionTransitionAuditRow = (value: unknown) =>
  decodeAttentionValue(auditDecoder, value);
export const decodeAttentionConversationColumns = (value: unknown) =>
  decodeAttentionValue(conversationDecoder, value);
export const decodeAttentionMessageColumns = (value: unknown) =>
  decodeAttentionValue(messageDecoder, value);
export const decodeAttentionProviderStatusColumns = (value: unknown) =>
  decodeAttentionValue(providerStatusDecoder, value);
export const decodeAttentionWebhookColumns = (value: unknown) =>
  decodeAttentionValue(webhookDecoder, value);
