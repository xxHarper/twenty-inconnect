import { isDeepStrictEqual } from 'node:util';

import { type EntityManager } from 'typeorm';

import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import {
  consumeAuthenticatedInbound,
  type AuthenticatedInboundCapability,
  type AuthenticatedInboundSnapshot,
} from 'src/modules/inconnect-messaging/webhook-ingress/authenticated-inbound';
import { decodeReceiptIngressContract } from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';

export const RECEIPT_INGRESS_SCHEMA_SQL = `SELECT
  count(*) = 1 AS installed,
  COALESCE(bool_and(atttypid = 'pg_catalog.int4'::regtype AND NOT attnotnull
    AND NOT atthasdef), true)
    AND (count(*) = 0 OR (
      (SELECT count(*) FROM pg_catalog.pg_trigger
        WHERE tgrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
          AND NOT tgisinternal AND tgenabled IN ('O','A')
          AND cardinality(tgattr::smallint[]) = 0
          AND tgqual IS NULL
          AND ((tgname = 'TR_IM_INGRESS_RECEIPT_WRITE' AND tgtype = 31
            AND tgfoid = to_regprocedure('core.im_ingress_receipt_guard()'))
            OR (tgname = 'TR_IM_INGRESS_RECEIPT_TRUNCATE' AND tgtype = 34
            AND tgfoid = to_regprocedure('core.im_ingress_receipt_truncate_guard()')))) = 2
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
          AND conname = 'CHK_IM_INGRESS_VERSION' AND contype = 'c' AND convalidated)
    )) AS compatible
  FROM pg_catalog.pg_attribute
  WHERE attrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
    AND attname = 'ingressContractVersion' AND NOT attisdropped`;

export const RECEIPT_INGRESS_GATE_SQL = `SELECT
  to_jsonb(configuration)->>'attentionTrackingMode' AS mode
  FROM core."inconnectMessagingConfiguration" configuration
  WHERE "workspaceId" = $1::uuid FOR SHARE`;

export const RECEIPT_INGRESS_CONNECTION_SQL = `SELECT "id"
  FROM core."inconnectMessagingProviderConnection"
  WHERE "workspaceId" = $1::uuid AND "id" = $2::uuid
    AND "provider" = 'TWILIO' AND "channel" = 'WHATSAPP'
    AND "lifecycleStatus" = 'ENABLED' AND "inboundRoutingKey" = $3::text
    AND "encryptedCredentials" = $4::text AND "credentialsVersion" = $5::integer
    AND (SELECT count(*) FROM core."inconnectMessagingProviderConnection"
      WHERE "provider" = 'TWILIO' AND "channel" = 'WHATSAPP'
        AND "inboundRoutingKey" = $3::text) = 1`;

export const RECEIPT_INGRESS_INSERT_SQL = `INSERT INTO core."inconnectMessagingWebhookReceipt"
  ("workspaceId","providerConnectionId","eventKind","idempotencyKey","payloadHash",
   "firstReceivedAt","normalizedMetadata","ingressContractVersion","processingState",
   "leaseToken","leaseExpiresAt","attemptCount","error","processedAt")
  VALUES ($1::uuid,$2::uuid,'INBOUND_MESSAGE',$3::text,$4::varchar,
    $5::timestamptz,$6::jsonb,1,'RECEIVED',NULL,NULL,0,NULL,NULL)
  ON CONFLICT ("providerConnectionId","eventKind","idempotencyKey") DO NOTHING
  RETURNING "id"`;

export const RECEIPT_INGRESS_ORIGINAL_SQL = `SELECT "id", "workspaceId", "providerConnectionId",
  "eventKind", "idempotencyKey", "payloadHash", "firstReceivedAt"::text AS "firstReceivedAt",
  "normalizedMetadata", "ingressContractVersion"
  FROM core."inconnectMessagingWebhookReceipt"
  WHERE "workspaceId" = $1::uuid AND "providerConnectionId" = $2::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND "idempotencyKey" = $3::text FOR SHARE`;

const failReceipt = (): never => {
  throw new InconnectMessagingWebhookException('RECEIPT_NOT_PROCESSABLE', true);
};

const rowsOf = (value: unknown): Record<string, unknown>[] => {
  if (
    !Array.isArray(value) ||
    value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    return failReceipt();
  return value;
};

export type PersistAuthenticatedReceiptResult =
  | {
      preDdlSnapshot: AuthenticatedInboundSnapshot;
      receipt?: never;
      admission?: never;
    }
  | {
      preDdlSnapshot?: never;
      receipt: InconnectMessagingWebhookReceiptEntity;
      admission: 'NEW_V1' | 'DUPLICATE_V1' | 'DUPLICATE_LEGACY';
    };

// Internal DML helper, not an issuing API. Only the capability-consuming service
// calls it. T1 deliberately does not claim SQL-credential separation from this code.
export async function persistAuthenticatedReceipt(
  manager: EntityManager,
  capability: AuthenticatedInboundCapability,
): Promise<PersistAuthenticatedReceiptResult> {
  const snapshot = consumeAuthenticatedInbound(capability);
  if (snapshot.ingressContractVersion !== 1) return failReceipt();
  const schema = rowsOf(await manager.query(RECEIPT_INGRESS_SCHEMA_SQL));
  if (
    schema.length !== 1 ||
    typeof schema[0].installed !== 'boolean' ||
    schema[0].compatible !== true
  )
    return failReceipt();
  if (!schema[0].installed) return { preDdlSnapshot: snapshot };
  const gate = rowsOf(
    await manager.query(RECEIPT_INGRESS_GATE_SQL, [snapshot.workspaceId]),
  );
  // Receipt issuance is independent of attention activation. This slice only
  // supports DISABLED; no prepared/tracked worker is installed by R2.
  if (gate.length !== 1 || gate[0].mode !== 'DISABLED') return failReceipt();
  const connectionParameters = [
    snapshot.workspaceId,
    snapshot.providerConnectionId,
    snapshot.routingKey,
    snapshot.encryptedCredentials,
    snapshot.credentialsVersion,
  ];
  const revalidate = async () => {
    const connection = rowsOf(
      await manager.query(RECEIPT_INGRESS_CONNECTION_SQL, connectionParameters),
    );
    if (
      connection.length !== 1 ||
      connection[0].id !== snapshot.providerConnectionId
    )
      failReceipt();
  };
  await revalidate();
  const inserted = rowsOf(
    await manager.query(RECEIPT_INGRESS_INSERT_SQL, [
      snapshot.workspaceId,
      snapshot.providerConnectionId,
      snapshot.idempotencyKey,
      snapshot.payloadHash,
      snapshot.firstReceivedAt,
      snapshot.normalizedJson,
    ]),
  );
  if (inserted.length > 1) return failReceipt();
  // A fresh READ COMMITTED statement sees the winning original after conflict.
  // Never DO UPDATE, and never manufacture another identity to gain authority.
  const original = rowsOf(
    await manager.query(RECEIPT_INGRESS_ORIGINAL_SQL, [
      snapshot.workspaceId,
      snapshot.providerConnectionId,
      snapshot.idempotencyKey,
    ]),
  );
  if (original.length !== 1) return failReceipt();
  const row = original[0];
  if (row.payloadHash !== snapshot.payloadHash)
    throw new InconnectMessagingWebhookException('PAYLOAD_CONFLICT', false);
  const contract = decodeReceiptIngressContract(
    true,
    row.ingressContractVersion,
  );
  if (contract.kind !== 'LEGACY' && contract.kind !== 'SUPPORTED')
    return failReceipt();
  const normalized: Record<string, unknown> = JSON.parse(
    snapshot.normalizedJson,
  );
  // Arrival belongs to the first receipt. Retransmission does not replace it.
  if (typeof row.firstReceivedAt !== 'string') return failReceipt();
  const firstReceivedAt = new Date(row.firstReceivedAt).toISOString();
  normalized.serverReceivedAt = firstReceivedAt;
  if (normalized.timestampSource === 'SERVER')
    normalized.effectiveInboundAt = firstReceivedAt;
  if (
    typeof row.id !== 'string' ||
    row.workspaceId !== snapshot.workspaceId ||
    row.providerConnectionId !== snapshot.providerConnectionId ||
    row.eventKind !== 'INBOUND_MESSAGE' ||
    row.idempotencyKey !== snapshot.idempotencyKey ||
    !isDeepStrictEqual(row.normalizedMetadata, normalized) ||
    (inserted.length === 1 &&
      (inserted[0].id !== row.id || contract.kind !== 'SUPPORTED'))
  )
    return failReceipt();
  await revalidate();
  const receipt = await manager
    .getRepository(InconnectMessagingWebhookReceiptEntity)
    .findOne({
      where: { id: row.id, workspaceId: snapshot.workspaceId },
    });
  if (
    !receipt ||
    receipt.providerConnectionId !== snapshot.providerConnectionId ||
    receipt.payloadHash !== snapshot.payloadHash
  )
    return failReceipt();
  return {
    receipt,
    admission:
      inserted.length === 1
        ? ('NEW_V1' as const)
        : contract.kind === 'SUPPORTED'
          ? ('DUPLICATE_V1' as const)
          : ('DUPLICATE_LEGACY' as const),
  };
}
