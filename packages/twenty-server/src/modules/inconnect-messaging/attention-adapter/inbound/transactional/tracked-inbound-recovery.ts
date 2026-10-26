import { randomUUID } from 'node:crypto';

import { type DataSource } from 'typeorm';

import { type TrackedInboundClaim } from './tracked-inbound-contract';

// Transport-only transaction: ends before Configuration/Conversation locks.
// No lease extension, fake claim, or PROCESSED -> PROCESSING transition exists.
export const INBOUND_CLAIM_SQL = `WITH candidate AS (
  SELECT "id" FROM core."inconnectMessagingWebhookReceipt"
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND "ingressContractVersion" = 1
    AND ("processingState" = 'RECEIVED' OR
      ("processingState" = 'PROCESSING' AND "leaseExpiresAt" <= clock_timestamp()))
    AND "attemptCount" < 10 FOR UPDATE
), claimed AS (
  UPDATE core."inconnectMessagingWebhookReceipt" w SET "processingState" = 'PROCESSING',
    "leaseToken" = $4::uuid, "leaseExpiresAt" = clock_timestamp() + interval '5 minutes',
    "attemptCount" = "attemptCount" + 1, "error" = NULL, "updatedAt" = statement_timestamp()
  FROM candidate WHERE w."id" = candidate."id"
    AND (w."processingState" = 'RECEIVED' OR
      (w."processingState" = 'PROCESSING' AND w."leaseExpiresAt" <= clock_timestamp())) RETURNING w."id"
) SELECT "id" FROM claimed`;

export const claimTrackedInbound = async (
  dataSource: DataSource,
  identity: Omit<TrackedInboundClaim, 'leaseToken'>,
): Promise<TrackedInboundClaim | null> => {
  const captured = { ...identity, leaseToken: randomUUID() };
  return dataSource.transaction('READ COMMITTED', async (manager) => {
    const rows: unknown = await manager.query(INBOUND_CLAIM_SQL, [
      captured.receiptId,
      captured.workspaceId,
      captured.providerConnectionId,
      captured.leaseToken,
    ]);
    if (!Array.isArray(rows) || rows.length > 1)
      throw new Error('Incomplete claim');
    if (rows.length === 0) return null;
    if (rows[0]?.id !== captured.receiptId)
      throw new Error('Contradictory claim');
    return captured;
  });
};

export const INBOUND_RELEASE_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingWebhookReceipt" SET
    "processingState" = CASE WHEN $5::boolean AND "attemptCount" < 10 THEN 'RECEIVED' ELSE 'FAILED' END,
    "leaseToken" = NULL, "leaseExpiresAt" = NULL, "error" = jsonb_build_object('category',$6::text),
    "updatedAt" = statement_timestamp()
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "processingState" = 'PROCESSING' AND "leaseToken" = $4::uuid RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_EXHAUSTED_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingWebhookReceipt" SET "processingState" = 'FAILED',
    "leaseToken" = NULL, "leaseExpiresAt" = NULL, "error" = jsonb_build_object('category','CAUSAL_RETRY_EXHAUSTED'),
    "updatedAt" = statement_timestamp()
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND "ingressContractVersion" = 1 AND "attemptCount" >= 10
    AND ("processingState" = 'RECEIVED' OR ("processingState" = 'PROCESSING' AND "leaseExpiresAt" <= clock_timestamp()))
  RETURNING "id"
) SELECT "id" FROM written`;

// Call only after a confirmed rollback, never after an indeterminate commit.
export const releaseTrackedInbound = async (
  dataSource: DataSource,
  claim: TrackedInboundClaim,
  retry: boolean,
  category: 'CAUSAL_UNIT_RETRY' | 'CAUSAL_UNIT_INTERVENTION',
): Promise<boolean> => {
  const rows: unknown = await dataSource.query(INBOUND_RELEASE_SQL, [
    claim.receiptId,
    claim.workspaceId,
    claim.providerConnectionId,
    claim.leaseToken,
    retry,
    category,
  ]);
  if (!Array.isArray(rows) || rows.length > 1)
    throw new Error('Incomplete release');
  if (rows.length === 0) return false;
  if (rows[0]?.id !== claim.receiptId) throw new Error('Contradictory release');
  return true;
};
