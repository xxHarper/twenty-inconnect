import { type AttentionProjectionEvaluation } from 'src/modules/inconnect-messaging/attention-adapter/evaluate-attention-projection';
import {
  type AttentionReadSession,
  readObject,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  nullableRowValue,
  rowBoolean,
  rowChoice,
  rowFormat,
  rowProviderStatus,
  rowText,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { type AttentionWriterRead } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-admission';
import { failAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-session';
import {
  ATTENTION_CAUSAL_MESSAGE_SQL,
  ATTENTION_CAUSAL_STATUS_SQL,
  ATTENTION_WEBHOOK_LOCK_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { type AttentionWriterInput } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';

export const verifyAttentionCausality = async (
  session: AttentionReadSession,
  read: AttentionWriterRead,
  evaluation: AttentionProjectionEvaluation,
  causal: AttentionWriterInput['causal'],
) => {
  const { scope, event } = read.plan.input;
  const parameters = [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
  ];
  if (causal.webhook !== null) {
    if (event.kind !== 'INBOUND_RECEIVED' && event.kind !== 'PROVIDER_EVIDENCE')
      return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.webhook');
    const webhook = readObject(
      {
        id: rowUuid,
        workspaceId: rowUuid,
        providerConnectionId: rowUuid,
        eventKind: rowText(16384),
        leaseValid: rowBoolean,
      },
      await session.one(ATTENTION_WEBHOOK_LOCK_SQL, [
        ...parameters.slice(0, 3),
        causal.webhook.id,
        causal.webhook.leaseToken,
      ]),
    );
    if (
      webhook.id !== causal.webhook.id ||
      webhook.workspaceId !== scope.workspaceId ||
      webhook.providerConnectionId !== scope.providerConnectionId ||
      !webhook.leaseValid ||
      webhook.eventKind !==
        (event.kind === 'INBOUND_RECEIVED'
          ? 'INBOUND_MESSAGE'
          : 'STATUS_CALLBACK')
    )
      return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.webhook');
  } else if (event.kind === 'INBOUND_RECEIVED') {
    return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.webhook');
  }
  if (
    event.kind !== 'PROVIDER_EVIDENCE' &&
    causal.providerStatusEventId !== null
  )
    return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.status');
  const source = read.sourceMessage;
  if (source === null) return;
  const message = readObject(
    {
      id: rowUuid,
      direction: rowChoice(['INBOUND', 'OUTBOUND'] as const),
      sendMode: nullableRowValue(rowFormat),
      providerMessageId: nullableRowValue(rowText(16384)),
      outboundState: nullableRowValue(rowProviderStatus),
      createdHere: rowBoolean,
      updatedHere: rowBoolean,
    },
    await session.one(ATTENTION_CAUSAL_MESSAGE_SQL, [...parameters, source.id]),
  );
  if (
    message.id !== source.id ||
    message.direction !== source.direction ||
    message.sendMode !== source.sendMode ||
    message.providerMessageId !== source.providerMessageId ||
    (evaluation.delta.intent !== null &&
      event.kind === 'RESPONSE_INTENDED' &&
      message.sendMode !== event.intent.format)
  )
    return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.message');
  // A newly inserted tracked Message cannot survive a rejected registration.
  if (
    evaluation.transition.kind === 'CONFLICT' &&
    (message.createdHere || event.kind === 'PROVIDER_EVIDENCE')
  )
    return failAttentionWrite('CAUSAL_OPERATION_REJECTED', '$.causal.conflict');
  if (
    evaluation.delta.effect !== null &&
    event.kind !== 'PROVIDER_EVIDENCE' &&
    !message.createdHere
  )
    return failAttentionWrite(
      'CAUSALITY_VIOLATION',
      '$.causal.message.creation',
    );
  if (event.kind !== 'PROVIDER_EVIDENCE') return;
  const status = readObject(
    {
      id: rowUuid,
      webhookReceiptId: nullableRowValue(rowUuid),
      normalizedStatus: rowProviderStatus,
      appliedToProjection: rowBoolean,
      createdHere: rowBoolean,
      consumedBinding: rowBoolean,
    },
    await session.one(ATTENTION_CAUSAL_STATUS_SQL, [
      ...parameters,
      source.id,
      causal.providerStatusEventId,
      read.plan.identity.effectKey,
      read.plan.identity.fingerprint,
    ]),
  );
  if (
    status.id !== causal.providerStatusEventId ||
    !status.appliedToProjection ||
    status.normalizedStatus !== event.evidence.status ||
    (evaluation.delta.effect !== null
      ? !message.updatedHere ||
        !status.createdHere ||
        status.webhookReceiptId !== (causal.webhook?.id ?? null) ||
        message.outboundState !== status.normalizedStatus
      : !status.consumedBinding)
  )
    return failAttentionWrite('CAUSALITY_VIOLATION', '$.causal.evidence');
};
