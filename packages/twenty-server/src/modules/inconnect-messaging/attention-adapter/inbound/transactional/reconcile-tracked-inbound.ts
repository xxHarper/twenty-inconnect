import { type QueryRunner } from 'typeorm';
import { evaluateAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/evaluate-attention-projection';

import { decodeCommittedDurableInboundFact } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/decode-durable-inbound-fact';
import { DURABLE_INBOUND_FACT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';
import {
  createAttentionReadSession,
  readObject,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  rowBoolean,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import { readReceiptIngressContract } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import {
  rejectTrackedInbound,
  type TrackedInboundClaim,
} from './tracked-inbound-contract';
import {
  INBOUND_LOCATOR_SQL,
  INBOUND_ORIGINAL_OUTBOX_SQL,
} from './tracked-inbound-sql';
import { isDeepStrictEqual } from 'node:util';

export const INBOUND_RECONCILE_MESSAGE_SQL = `SELECT "id", "conversationId", "attentionTrackingEpochId"
  FROM core."inconnectMessagingMessage" WHERE "workspaceId" = $1::uuid AND "providerConnectionId" = $2::uuid
    AND "providerMessageId" = $3::text`;
export const INBOUND_COMMITTED_FACT_SQL = DURABLE_INBOUND_FACT_SQL.replace(
  'w."processedAt",',
  'w."processedAt"::text AS "processedAt",',
);
export const INBOUND_COMMITTED_ORIGINAL_SQL = `SELECT a."authenticationReference", a."correlationReference", a."authorityKind",
  output."id" AS "outboxId" FROM core."inconnectMessagingAttentionReceipt" r
  JOIN core."inconnectMessagingAttentionEffect" e ON e."id" = r."effectId" AND e."workspaceId" = r."workspaceId"
    AND e."conversationId" = r."conversationId" AND e."providerConnectionId" = r."providerConnectionId" AND e."trackingEpochId" = r."trackingEpochId"
  JOIN core."inconnectMessagingAttentionTransitionAudit" a ON a."id" = r."originalAuditId" AND a."workspaceId" = r."workspaceId"
    AND a."conversationId" = r."conversationId" AND a."providerConnectionId" = r."providerConnectionId" AND a."trackingEpochId" = r."trackingEpochId"
    AND a."eventKey" = r."eventKey"
  JOIN core."inconnectMessagingOutboxEvent" output ON output."deduplicationKey" = core.im_at_outbox_key(
    e."workspaceId",e."conversationId",e."providerConnectionId",e."trackingEpochId",e."effectKey")
    AND output."workspaceId" = r."workspaceId" AND output."aggregateType" = 'CONVERSATION' AND output."aggregateId" = r."conversationId"
    AND output."eventType" = 'CONVERSATION_ATTENTION_CHANGED' AND output."immutablePayload" = jsonb_build_object('conversationId',r."conversationId"::text)
  WHERE r."workspaceId" = $1::uuid AND r."conversationId" = $2::uuid AND r."providerConnectionId" = $3::uuid
    AND r."trackingEpochId" = $4::uuid AND r."eventKey" = $5::text`;

// No writes, claim, fake PROCESSING, audit replay or new domain keys. Caller owns
// a NEW primary transaction and must commit/release it before requesting work.
export const reconcileTrackedInbound = async (
  queryRunner: QueryRunner,
  supplied: Omit<TrackedInboundClaim, 'leaseToken'>,
) => {
  const identity = { ...supplied };
  const session = createAttentionReadSession(queryRunner);
  await session.verify();
  const locator = await session.one(INBOUND_LOCATOR_SQL, [
    identity.receiptId,
    identity.workspaceId,
    identity.providerConnectionId,
  ]);
  if (
    locator === null ||
    typeof locator !== 'object' ||
    !('normalizedMetadata' in locator) ||
    locator.normalizedMetadata === null ||
    typeof locator.normalizedMetadata !== 'object' ||
    !('providerMessageId' in locator.normalizedMetadata) ||
    typeof locator.normalizedMetadata.providerMessageId !== 'string'
  )
    return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  const providerMessageId = locator.normalizedMetadata.providerMessageId;
  const message = readObject(
    { id: rowUuid, conversationId: rowUuid, attentionTrackingEpochId: rowUuid },
    await session.one(INBOUND_RECONCILE_MESSAGE_SQL, [
      identity.workspaceId,
      identity.providerConnectionId,
      providerMessageId,
    ]),
  );
  const scope = {
    workspaceId: identity.workspaceId,
    providerConnectionId: identity.providerConnectionId,
    conversationId: message.conversationId,
    trackingEpochId: message.attentionTrackingEpochId,
  };
  const eventKey = JSON.stringify(['whatsapp-inbound-v1', identity.receiptId]);
  const read = await readAttentionProjection({
    queryRunner,
    input: {
      scope,
      event: {
        kind: 'INBOUND_RECEIVED',
        scope,
        eventKey,
        messageId: message.id,
      },
    },
  });
  if (
    !read.ok ||
    read.value.facts.eventReceipt === null ||
    read.value.facts.effect === null ||
    read.value.facts.eventReceipt.eventKey !== eventKey ||
    read.value.facts.effect.original.kind !== 'APPLIED' ||
    read.value.facts.effect.original.audit.eventKind !== 'INBOUND_RECEIVED'
  )
    return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  const evaluated = evaluateAttentionProjection(
    read.value.plan,
    read.value.facts,
  );
  if (
    !evaluated.ok ||
    evaluated.value.transition.kind !== 'DUPLICATE' ||
    evaluated.value.transition.reason !== 'SAME_EVENT'
  )
    return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  const schema = readObject(
    { installed: rowBoolean, compatible: rowBoolean },
    await session.one(RECEIPT_INGRESS_SCHEMA_SQL, []),
  );
  if (!schema.installed || !schema.compatible)
    return rejectTrackedInbound('INGRESS_SCHEMA_NOT_READY');
  const version = await readReceiptIngressContract(
    queryRunner.manager,
    identity,
  );
  if (version.kind !== 'SUPPORTED')
    return rejectTrackedInbound('UNACCREDITED_RECEIPT');
  const parameters = [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
  ];
  const fact = decodeCommittedDurableInboundFact(
    await session.one(INBOUND_COMMITTED_FACT_SQL, [
      ...parameters,
      identity.receiptId,
      message.id,
    ]),
    { scope, receiptId: identity.receiptId, messageId: message.id },
  );
  if (fact === null) return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  const original = await session.one(INBOUND_COMMITTED_ORIGINAL_SQL, [
    ...parameters,
    eventKey,
  ]);
  if (
    original === null ||
    typeof original !== 'object' ||
    !('outboxId' in original) ||
    !isDeepStrictEqual(original, {
      outboxId: original.outboxId,
      authorityKind: 'BACKEND',
      authenticationReference: JSON.stringify([
        'durable-inbound-t1-v1',
        identity.receiptId,
        fact.payloadHash,
      ]),
      correlationReference: JSON.stringify([
        'inbound-cause-v1',
        identity.receiptId,
        message.id,
        providerMessageId,
      ]),
    })
  )
    return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  const inbound = await session.one(INBOUND_ORIGINAL_OUTBOX_SQL, [
    `inconnect-messaging:receipt:${identity.receiptId}:message`,
  ]);
  const payload = {
    messageId: message.id,
    conversationId: scope.conversationId,
    providerConnectionId: identity.providerConnectionId,
    messageType: fact.type,
    effectiveInboundAt: fact.normalizedMetadata.effectiveInboundAt,
  };
  if (
    inbound === null ||
    typeof inbound !== 'object' ||
    !('id' in inbound) ||
    !isDeepStrictEqual(inbound, {
      id: inbound.id,
      workspaceId: identity.workspaceId,
      aggregateType: 'MESSAGE',
      aggregateId: message.id,
      eventType: 'INBOUND_MESSAGE_RECEIVED',
      immutablePayload: payload,
      deduplicationKey: `inconnect-messaging:receipt:${identity.receiptId}:message`,
    })
  )
    return rejectTrackedInbound('RECONCILIATION_NOT_PROVEN');
  await session.verify();
  return {
    status: 'RECONCILED' as const,
    ...identity,
    conversationId: scope.conversationId,
    trackingEpochId: scope.trackingEpochId,
    messageId: message.id,
    providerMessageId,
    originals: {
      eventResult: read.value.facts.eventReceipt.original,
      effectResult: read.value.facts.effect.original,
    },
    publicationRequests: [
      {
        id: rowUuid(inbound.id, '$.outbox'),
        workspaceId: identity.workspaceId,
        eventType: 'INBOUND_MESSAGE_RECEIVED',
      },
      {
        id: rowUuid(original.outboxId, '$.outbox'),
        workspaceId: identity.workspaceId,
        eventType: 'CONVERSATION_ATTENTION_CHANGED',
      },
    ],
  };
};
