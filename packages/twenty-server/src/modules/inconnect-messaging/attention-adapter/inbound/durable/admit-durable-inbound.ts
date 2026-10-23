import { isDeepStrictEqual } from 'node:util';

import { decodeDurableInboundFact } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/decode-durable-inbound-fact';
import {
  DURABLE_INBOUND_FACT_SQL,
  DURABLE_INBOUND_RECEIPT_LOCK_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';
import { type DurableInboundAttentionInput } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound.types';
import {
  createAttentionReadSession,
  readObject,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  rowBoolean,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { type AttentionWriterInput } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import { readReceiptIngressContract } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';

export const admitDurableInbound = async (
  context: Parameters<AttentionWriterInput['admit']>[0],
  expected: AttentionWriterInput['input'],
  cause: DurableInboundAttentionInput,
): ReturnType<AttentionWriterInput['admit']> => {
  if (
    context.queryRunner !== cause.queryRunner ||
    !isDeepStrictEqual(context.input, expected) ||
    !isDeepStrictEqual(context.input.scope, cause.scope) ||
    !isDeepStrictEqual(context.snapshot.scope, cause.scope) ||
    context.input.event.kind !== 'INBOUND_RECEIVED' ||
    context.input.event.messageId !== cause.messageId ||
    context.input.event.eventKey !==
      JSON.stringify(['whatsapp-inbound-v1', cause.receiptId])
  )
    return null;
  const session = createAttentionReadSession(cause.queryRunner);
  await session.verify();
  const schema = readObject(
    { installed: rowBoolean, compatible: rowBoolean },
    await session.one(RECEIPT_INGRESS_SCHEMA_SQL, []),
  );
  if (!schema.installed || !schema.compatible) return null;
  const parameters = [
    cause.scope.workspaceId,
    cause.scope.conversationId,
    cause.scope.providerConnectionId,
    cause.scope.trackingEpochId,
    cause.receiptId,
  ];
  const locked = readObject(
    { id: rowUuid },
    await session.one(DURABLE_INBOUND_RECEIPT_LOCK_SQL, parameters),
  );
  if (locked.id !== cause.receiptId) return null;
  // Uses the original manager, which is pinned to this runner by C2-II. Never
  // manufacture a WeakMap capability or claim a fresh Twilio signature here.
  await session.verify();
  const contract = await readReceiptIngressContract(cause.queryRunner.manager, {
    receiptId: cause.receiptId,
    workspaceId: cause.scope.workspaceId,
    providerConnectionId: cause.scope.providerConnectionId,
  });
  await session.verify();
  if (contract.kind !== 'SUPPORTED') return null;
  const fact = decodeDurableInboundFact(
    await session.one(DURABLE_INBOUND_FACT_SQL, [
      ...parameters,
      cause.messageId,
    ]),
    cause,
  );
  await session.verify();
  if (fact === null) return null;
  return {
    scope: cause.scope,
    eventKey: context.input.event.eventKey,
    fingerprint: getAttentionEventIdentity(context.input.event).fingerprint,
    authorityKind: 'BACKEND',
    actorWorkspaceMemberId: null,
    authenticationReference: JSON.stringify([
      'durable-inbound-t1-v1',
      cause.receiptId,
      fact.payloadHash,
    ]),
    correlationReference: JSON.stringify([
      'inbound-cause-v1',
      cause.receiptId,
      cause.messageId,
      fact.providerMessageId,
    ]),
    evidenceId: null,
    providerStatusEventId: null,
    outboundAdmission: null,
  };
};
