import { type DataSource } from 'typeorm';
import { rowUuid } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { readObject } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';

import {
  executeTrackedInbound,
  INBOUND_SESSION_SETTINGS,
  requestCommittedInboundWork,
  TrackedInboundExecutionFailure,
} from './execute-tracked-inbound';
import {
  claimTrackedInbound,
  INBOUND_EXHAUSTED_SQL,
  releaseTrackedInbound,
} from './tracked-inbound-recovery';
import { reconcileTrackedInbound } from './reconcile-tracked-inbound';
import { type TrackedInboundClaim } from './tracked-inbound-contract';

export const INBOUND_RECOVERY_STATE_SQL = `SELECT "processingState", "leaseToken", "leaseExpiresAt" > clock_timestamp() AS "leaseValid",
  "attemptCount" FROM core."inconnectMessagingWebhookReceipt"
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND "ingressContractVersion" = 1`;

export const INBOUND_JOB_IDENTITY_SQL = `SELECT "id" AS "receiptId", "workspaceId", "providerConnectionId"
  FROM core."inconnectMessagingWebhookReceipt" w WHERE "id" = $1::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND to_jsonb(w)->'ingressContractVersion' = '1'::jsonb`;

// Matches the existing BullMQ job's only input. This is not registered by R4.
// Scope is loaded from the durable receipt, never passed through the job payload.
export const processTrackedInboundJob = async (
  dataSource: DataSource,
  receiptId: string,
  dependencies: Parameters<typeof requestCommittedInboundWork>[1],
) => {
  const rows: unknown = await dataSource.query(INBOUND_JOB_IDENTITY_SQL, [
    receiptId,
  ]);
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new TrackedInboundExecutionFailure(
      'INTERVENTION',
      'RECEIPT_NOT_FOUND_OR_UNACCREDITED',
    );
  const identity = readObject(
    { receiptId: rowUuid, workspaceId: rowUuid, providerConnectionId: rowUuid },
    rows[0],
  );
  if (identity.receiptId !== receiptId)
    throw new TrackedInboundExecutionFailure(
      'INTERVENTION',
      'RECEIPT_IDENTITY_MISMATCH',
    );
  return processTrackedInboundReceipt(dataSource, identity, dependencies);
};

// Source worker composition for the existing receiptId transport, deliberately
// unregistered. The active worker's release boundary rejects ENABLED until the
// ingress/cutover and global revocation/custody obligations are accepted.
export const processTrackedInboundReceipt = async (
  dataSource: DataSource,
  identity: Omit<TrackedInboundClaim, 'leaseToken'>,
  dependencies: Parameters<typeof requestCommittedInboundWork>[1],
) => {
  const captured = { ...identity };
  const claim = await claimTrackedInbound(dataSource, captured);
  if (claim === null) {
    const rows: unknown = await dataSource.query(INBOUND_RECOVERY_STATE_SQL, [
      captured.receiptId,
      captured.workspaceId,
      captured.providerConnectionId,
    ]);
    if (!Array.isArray(rows) || rows.length !== 1)
      throw new TrackedInboundExecutionFailure(
        'INTERVENTION',
        'RECEIPT_NOT_FOUND_OR_UNACCREDITED',
      );
    if (
      rows[0]?.processingState === 'PROCESSING' &&
      rows[0]?.leaseToken !== null &&
      rows[0]?.leaseValid === true
    )
      return { status: 'BUSY' as const };
    if (rows[0]?.processingState !== 'PROCESSED') {
      if (
        Number.isSafeInteger(rows[0]?.attemptCount) &&
        rows[0].attemptCount >= 10 &&
        (rows[0].processingState === 'RECEIVED' ||
          (rows[0].processingState === 'PROCESSING' &&
            rows[0].leaseValid === false))
      ) {
        const exhausted: unknown = await dataSource.query(
          INBOUND_EXHAUSTED_SQL,
          [
            captured.receiptId,
            captured.workspaceId,
            captured.providerConnectionId,
          ],
        );
        if (
          !Array.isArray(exhausted) ||
          exhausted.length > 1 ||
          (exhausted.length === 1 && exhausted[0]?.id !== captured.receiptId)
        )
          throw new TrackedInboundExecutionFailure(
            'INTERVENTION',
            'INCOMPLETE_EXHAUSTION',
          );
      }
      throw new TrackedInboundExecutionFailure(
        'INTERVENTION',
        'RECEIPT_REQUIRES_REVIEW',
      );
    }
    const runner = dataSource.createQueryRunner('master');
    try {
      await runner.connect();
      await runner.startTransaction('READ COMMITTED');
      for (const statement of INBOUND_SESSION_SETTINGS)
        await runner.query(statement);
      const reconciled = await reconcileTrackedInbound(runner, captured);
      await runner.commitTransaction();
      const recovery = await requestCommittedInboundWork(
        { ...reconciled, status: 'COMMITTED' },
        dependencies,
      );
      return { status: 'RECONCILED' as const, recovery };
    } catch (error) {
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch {
          /* No write success is asserted. */
        }
      }
      throw error;
    } finally {
      try {
        await runner.release();
      } catch {
        /* Connection disposal belongs to the pool. */
      }
    }
  }
  let committed: Awaited<ReturnType<typeof executeTrackedInbound>>;
  try {
    committed = await executeTrackedInbound(dataSource, claim);
  } catch (error) {
    if (
      error instanceof TrackedInboundExecutionFailure &&
      error.disposition !== 'COMMIT_INDETERMINATE'
    ) {
      await releaseTrackedInbound(
        dataSource,
        claim,
        error.disposition === 'RETRY',
        error.disposition === 'RETRY'
          ? 'CAUSAL_UNIT_RETRY'
          : 'CAUSAL_UNIT_INTERVENTION',
      );
    }
    // Ambiguity leaves transport untouched. Recovery must inspect PROCESSED and
    // originals, or obtain a legitimate expired-lease takeover, never a new key.
    throw error;
  }
  const recovery = await requestCommittedInboundWork(committed, dependencies);
  return { status: 'COMMITTED' as const, recovery };
};
