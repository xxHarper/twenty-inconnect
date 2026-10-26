import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { isInconnectMessagingMimeAllowedForType } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-media-policy.constant';
import { prepareDurableInboundAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/prepare-durable-inbound-attention-write';
import {
  decodeAttentionConversationColumns,
  decodeAttentionEpochRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import { mapAttentionSnapshot } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence-mappers';
import {
  rowBoolean,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import {
  createAttentionReadSession,
  decodeReadValue,
  readObject,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_ROOT_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { createAttentionWriteSession } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-session';
import {
  ATTENTION_DEFER_SQL,
  ATTENTION_COMPLETE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import {
  inboundWriteShape,
  rejectTrackedInbound,
  TrackedInboundSqlFailure,
  type PreparedTrackedInbound,
  type TrackedInboundInput,
} from './tracked-inbound-contract';
import * as sql from './tracked-inbound-sql';

// Private source composition. Its caller owns one exclusive primary transaction;
// this entry never selects legacy and cannot activate an operational route.
export const prepareTrackedInbound = async (
  supplied: TrackedInboundInput,
): Promise<PreparedTrackedInbound> => {
  const claim = { ...supplied.claim };
  const queryRunner = supplied.queryRunner;
  Object.values(claim).forEach((value) => rowUuid(value, '$.claim'));
  const session = createAttentionReadSession(queryRunner);
  await session.verify();
  const gate = await session.one(ATTENTION_CONFIGURATION_SQL, [
    claim.workspaceId,
  ]);
  if (
    gate === null ||
    typeof gate !== 'object' ||
    !('workspaceId' in gate) ||
    gate.workspaceId !== claim.workspaceId ||
    !('installed' in gate) ||
    gate.installed !== true ||
    !('mode' in gate) ||
    gate.mode !== 'ENABLED' ||
    !('protocolVersion' in gate) ||
    gate.protocolVersion !== 1 ||
    !('gateUpdatedAt' in gate) ||
    gate.gateUpdatedAt === null
  )
    return rejectTrackedInbound('TRACKING_NOT_READY');
  const schema = readObject(
    { installed: rowBoolean, compatible: rowBoolean },
    await session.one(RECEIPT_INGRESS_SCHEMA_SQL, []),
  );
  if (!schema.installed || !schema.compatible)
    return rejectTrackedInbound('INGRESS_SCHEMA_NOT_READY');
  const receiptParameters = [
    claim.receiptId,
    claim.workspaceId,
    claim.providerConnectionId,
  ];
  // Locator only: after the common locks we reread the entire immutable fact.
  const locator = await session.one(sql.INBOUND_LOCATOR_SQL, receiptParameters);
  const receiptShape = inboundWriteShape;
  if (
    locator === null ||
    typeof locator !== 'object' ||
    !('version' in locator) ||
    locator.version !== 1 ||
    !('id' in locator) ||
    locator.id !== claim.receiptId ||
    !('workspaceId' in locator) ||
    locator.workspaceId !== claim.workspaceId ||
    !('providerConnectionId' in locator) ||
    locator.providerConnectionId !== claim.providerConnectionId ||
    !('eventKind' in locator) ||
    locator.eventKind !== 'INBOUND_MESSAGE' ||
    !('normalizedMetadata' in locator)
  )
    return rejectTrackedInbound('UNACCREDITED_RECEIPT');
  const parsed = receiptShape.safeParse(locator.normalizedMetadata);
  if (!parsed.success) return rejectTrackedInbound('INVALID_INBOUND_FACT');
  const webhook = parsed.data;
  if (
    !('idempotencyKey' in locator) ||
    locator.idempotencyKey !== webhook.providerMessageId ||
    webhook.idempotencyKey !== webhook.providerMessageId
  )
    return rejectTrackedInbound('INVALID_INBOUND_IDENTITY');
  const connection = await session.one(sql.INBOUND_CONNECTION_SQL, [
    claim.workspaceId,
    claim.providerConnectionId,
  ]);
  if (readObject({ id: rowUuid }, connection).id !== claim.providerConnectionId)
    return rejectTrackedInbound('CONNECTION_NOT_READY');
  const { control } = createAttentionWriteSession(queryRunner);
  await control(ATTENTION_DEFER_SQL);
  const candidateId = randomUUID();
  const created = await session.query(sql.INBOUND_CREATE_CONVERSATION_SQL, [
    claim.workspaceId,
    claim.providerConnectionId,
    webhook.externalAddressNormalized,
    candidateId,
    webhook.waId,
  ]);
  if (
    created.length > 1 ||
    (created.length === 1 &&
      readObject({ id: rowUuid }, created[0]).id !== candidateId)
  )
    return rejectTrackedInbound('CONVERSATION_INSERT_INCOMPLETE');
  const winning = await session.one(sql.INBOUND_LOCK_CONVERSATION_SQL, [
    claim.workspaceId,
    claim.providerConnectionId,
    webhook.externalAddressNormalized,
  ]);
  if (
    winning === null ||
    typeof winning !== 'object' ||
    !('id' in winning) ||
    !('workspaceId' in winning) ||
    winning.workspaceId !== claim.workspaceId ||
    !('providerConnectionId' in winning) ||
    winning.providerConnectionId !== claim.providerConnectionId ||
    !('externalAddressNormalized' in winning) ||
    winning.externalAddressNormalized !== webhook.externalAddressNormalized
  )
    return rejectTrackedInbound('CONVERSATION_SCOPE_MISMATCH');
  const conversationId = rowUuid(winning.id, '$.conversation.id');
  const parameters = [
    claim.workspaceId,
    conversationId,
    claim.providerConnectionId,
  ];
  const requireId = async (
    statement: string,
    values: readonly unknown[],
    id: string,
  ) => {
    let row: unknown;
    if (statement === sql.INBOUND_INSERT_MESSAGE_SQL) {
      // Preserve only the known index identity needed for a bounded fresh retry;
      // C2-II intentionally strips driver detail from its read errors.
      let result: unknown;
      try {
        result = await queryRunner.query(statement, [...values], true);
      } catch (error) {
        const descriptor =
          error !== null && typeof error === 'object' ? error : {};
        const code: unknown = Object.getOwnPropertyDescriptor(
          descriptor,
          'code',
        )?.value;
        const constraint: unknown = Object.getOwnPropertyDescriptor(
          descriptor,
          'constraint',
        )?.value;
        throw new TrackedInboundSqlFailure(
          typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
            ? code
            : undefined,
          constraint === 'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE'
            ? constraint
            : undefined,
        );
      }
      if (
        result === null ||
        typeof result !== 'object' ||
        !('records' in result) ||
        !Array.isArray(result.records) ||
        result.records.length !== 1 ||
        !('raw' in result) ||
        result.raw !== result.records ||
        !('affected' in result) ||
        result.affected !== 1
      )
        return rejectTrackedInbound('INCOMPLETE_CAUSAL_WRITE');
      row = result.records[0];
    } else row = await session.one(statement, values);
    if (readObject({ id: rowUuid }, row).id !== id)
      rejectTrackedInbound('INCOMPLETE_CAUSAL_WRITE');
  };
  const rootBefore = await session.one(ATTENTION_ROOT_SQL, parameters);
  const rootShape = (root: unknown) => {
    if (
      root === null ||
      typeof root !== 'object' ||
      !('conversation' in root) ||
      !('epoch' in root)
    )
      return rejectTrackedInbound('INCOMPLETE_ROOT');
    return root;
  };
  let root = rootShape(rootBefore);
  const before = decodeReadValue(
    decodeAttentionConversationColumns(root.conversation),
  );
  if (
    before.id !== conversationId ||
    before.workspaceId !== claim.workspaceId ||
    before.providerConnectionId !== claim.providerConnectionId
  )
    return rejectTrackedInbound('CONVERSATION_SCOPE_MISMATCH');
  if (created.length === 1) {
    if (
      conversationId !== candidateId ||
      before.attentionTrackingEpochId !== null ||
      root.epoch !== null ||
      before.pendingAt !== null
    )
      return rejectTrackedInbound('CONTRADICTORY_NEW_CONVERSATION');
    const epochId = randomUUID();
    await requireId(
      sql.INBOUND_CREATE_EPOCH_SQL,
      [
        ...parameters,
        epochId,
        JSON.stringify([
          'new-inbound-conversation-v1',
          claim.receiptId,
          conversationId,
        ]),
      ],
      epochId,
    );
    await requireId(
      sql.INBOUND_PREPARE_POINTER_SQL,
      [...parameters, epochId],
      conversationId,
    );
    await requireId(
      sql.INBOUND_READY_EPOCH_SQL,
      [...parameters, epochId],
      epochId,
    );
    root = rootShape(await session.one(ATTENTION_ROOT_SQL, parameters));
  } else if (before.attentionTrackingEpochId === null) {
    return rejectTrackedInbound('HISTORICAL_CONVERSATION_NOT_READY');
  }
  const conversation = decodeReadValue(
    decodeAttentionConversationColumns(root.conversation),
  );
  const epoch = decodeReadValue(decodeAttentionEpochRow(root.epoch));
  decodeReadValue(mapAttentionSnapshot(conversation, epoch));
  if (
    conversation.id !== conversationId ||
    conversation.workspaceId !== claim.workspaceId ||
    conversation.providerConnectionId !== claim.providerConnectionId ||
    epoch.lifecycle !== 'READY' ||
    conversation.attentionTrackingEpochId !== epoch.id
  )
    return rejectTrackedInbound('EPOCH_NOT_READY');
  // All common locks and READY validation precede Receipt -> Message.
  await requireId(
    sql.INBOUND_LOCK_RECEIPT_SQL,
    receiptParameters,
    claim.receiptId,
  );
  const freshLocator = await session.one(
    sql.INBOUND_LOCATOR_SQL,
    receiptParameters,
  );
  if (!isDeepStrictEqual(locator, freshLocator))
    return rejectTrackedInbound('RECEIPT_FACT_CHANGED');
  const lease = await session.one(
    sql.INBOUND_RECEIPT_LEASE_SQL,
    receiptParameters,
  );
  if (
    lease === null ||
    typeof lease !== 'object' ||
    !('id' in lease) ||
    lease.id !== claim.receiptId ||
    !('processingState' in lease) ||
    lease.processingState !== 'PROCESSING' ||
    !('leaseToken' in lease) ||
    lease.leaseToken !== claim.leaseToken ||
    !('leaseValid' in lease) ||
    lease.leaseValid !== true ||
    !('unfinished' in lease) ||
    lease.unfinished !== true ||
    !('attemptCount' in lease) ||
    !Number.isSafeInteger(lease.attemptCount) ||
    Number(lease.attemptCount) <= 0
  )
    return rejectTrackedInbound('LEASE_LOST');
  const found = await session.query(sql.INBOUND_MESSAGE_SQL, [
    claim.providerConnectionId,
    webhook.providerMessageId,
  ]);
  if (found.length > 1) return rejectTrackedInbound('AMBIGUOUS_MESSAGE');
  const messageId =
    found.length === 0
      ? randomUUID()
      : (() => {
          const existing = found[0];
          if (
            existing === null ||
            typeof existing !== 'object' ||
            !('id' in existing) ||
            !('workspaceId' in existing) ||
            existing.workspaceId !== claim.workspaceId ||
            !('conversationId' in existing) ||
            existing.conversationId !== conversationId ||
            !('providerConnectionId' in existing) ||
            existing.providerConnectionId !== claim.providerConnectionId ||
            !('attentionTrackingEpochId' in existing) ||
            existing.attentionTrackingEpochId !== epoch.id ||
            !('direction' in existing) ||
            existing.direction !== 'INBOUND'
          )
            return rejectTrackedInbound('CONTRADICTORY_MESSAGE');
          return rowUuid(existing.id, '$.message.id');
        })();
  if (found.length === 0) {
    await requireId(
      sql.INBOUND_INSERT_MESSAGE_SQL,
      [
        ...parameters,
        epoch.id,
        messageId,
        webhook.messageType,
        webhook.body,
        webhook.providerMessageId,
        JSON.stringify(webhook.providerMetadata),
        webhook.serverReceivedAt,
        webhook.providerOccurredAt,
        webhook.effectiveInboundAt,
        webhook.timestampSource,
      ],
      messageId,
    );
    for (const attachment of webhook.attachments) {
      const id = randomUUID();
      const metadataPresent =
        attachment.providerMediaLocator !== null &&
        attachment.declaredMimeType !== null;
      const supported =
        metadataPresent &&
        attachment.declaredMimeType !== null &&
        isInconnectMessagingMimeAllowedForType({
          mimeType: attachment.declaredMimeType,
          type: attachment.type,
        });
      await requireId(
        sql.INBOUND_INSERT_ATTACHMENT_SQL,
        [
          id,
          claim.workspaceId,
          claim.providerConnectionId,
          messageId,
          attachment.ordinal,
          attachment.type,
          attachment.providerMediaLocator,
          attachment.declaredMimeType,
          attachment.safeFilename,
          supported ? 'PENDING' : 'FAILED',
          metadataPresent
            ? supported
              ? null
              : 'UNSUPPORTED_MIME'
            : 'MALFORMED_PROVIDER_MEDIA_METADATA',
        ],
        id,
      );
    }
    await requireId(
      sql.INBOUND_UPDATE_ACTIVITY_SQL,
      [...parameters, webhook.effectiveInboundAt, webhook.waId],
      conversationId,
    );
  }
  const attention = await prepareDurableInboundAttentionWrite({
    queryRunner,
    scope: {
      workspaceId: claim.workspaceId,
      conversationId,
      providerConnectionId: claim.providerConnectionId,
      trackingEpochId: epoch.id,
    },
    receiptId: claim.receiptId,
    leaseToken: claim.leaseToken,
    messageId,
  });
  const key = `inconnect-messaging:receipt:${claim.receiptId}:message`;
  const payload = {
    messageId,
    conversationId,
    providerConnectionId: claim.providerConnectionId,
    messageType: webhook.messageType,
    effectiveInboundAt: webhook.effectiveInboundAt,
  };
  let outboxId: string;
  if (found.length === 0) {
    outboxId = randomUUID();
    await requireId(
      sql.INBOUND_INSERT_OUTBOX_SQL,
      [outboxId, claim.workspaceId, messageId, JSON.stringify(payload), key],
      outboxId,
    );
  } else {
    const original = await session.one(sql.INBOUND_ORIGINAL_OUTBOX_SQL, [key]);
    if (
      original === null ||
      typeof original !== 'object' ||
      !('id' in original) ||
      !isDeepStrictEqual(original, {
        id: original.id,
        workspaceId: claim.workspaceId,
        aggregateType: 'MESSAGE',
        aggregateId: messageId,
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        immutablePayload: payload,
        deduplicationKey: key,
      })
    )
      return rejectTrackedInbound('INBOUND_OUTBOX_MISSING_OR_CONTRADICTORY');
    outboxId = rowUuid(original.id, '$.outbox.id');
  }
  await requireId(
    sql.INBOUND_FINALIZE_RECEIPT_SQL,
    [...receiptParameters, claim.leaseToken],
    claim.receiptId,
  );
  // III-A closes its obligations; also flush after the caller's final writes.
  await control(ATTENTION_COMPLETE_SQL);
  await session.verify();
  return {
    status: 'PREPARED',
    receiptId: claim.receiptId,
    workspaceId: claim.workspaceId,
    providerConnectionId: claim.providerConnectionId,
    conversationId,
    trackingEpochId: epoch.id,
    messageId,
    providerMessageId: webhook.providerMessageId,
    publicationRequests: [
      {
        id: outboxId,
        workspaceId: claim.workspaceId,
        eventType: 'INBOUND_MESSAGE_RECEIVED',
      },
      ...(attention.value.rows.outboxId === null
        ? []
        : [
            {
              id: attention.value.rows.outboxId,
              workspaceId: claim.workspaceId,
              eventType: 'CONVERSATION_ATTENTION_CHANGED',
            },
          ]),
    ],
  };
};
