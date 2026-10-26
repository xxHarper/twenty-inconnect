import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { type DataSource } from 'typeorm';

import { readAdmissionSqlState } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-admission-diagnostic';
import { AttentionReadFailure } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { AttentionWriteFailure } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-session';
import { DurableInboundAttentionPreparationFailure } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/prepare-durable-inbound-attention-write';
import { prepareTrackedInbound } from './prepare-tracked-inbound';
import {
  type PreparedTrackedInbound,
  type TrackedInboundClaim,
  TrackedInboundFailure,
} from './tracked-inbound-contract';

export const INBOUND_SESSION_SETTINGS = [
  "SET LOCAL statement_timeout = '10000ms'",
  "SET LOCAL lock_timeout = '2000ms'",
  'SET LOCAL row_security = off',
] as const;

export class TrackedInboundExecutionFailure extends Error {
  constructor(
    readonly disposition: 'RETRY' | 'INTERVENTION' | 'COMMIT_INDETERMINATE',
    readonly category: string,
    readonly sqlState?: string,
    readonly connectionCode?: string,
  ) {
    super(category);
  }
}

const errorIdentity = (
  error: unknown,
): { code?: string; constraint?: string; connectionCode?: string } => {
  if (
    error instanceof AttentionReadFailure ||
    error instanceof AttentionWriteFailure
  )
    return { code: error.failure.sqlState };
  if (error instanceof DurableInboundAttentionPreparationFailure)
    return {
      code: readAdmissionSqlState(error.failure) ?? error.failure.sqlState,
    };
  if (error === null || typeof error !== 'object') return {};
  const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  const constraint: unknown = Object.getOwnPropertyDescriptor(
    error,
    'constraint',
  )?.value;
  return {
    code:
      typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
    constraint: typeof constraint === 'string' ? constraint : undefined,
    connectionCode:
      typeof code === 'string' &&
      [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ECONNRESET',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'EAI_AGAIN',
      ].includes(code)
        ? code
        : undefined,
  };
};

// A transaction owner for the prepared unit. Not registered with Nest or BullMQ.
// The existing transport remains the only inbox/outbox/media transport.
export const executeTrackedInbound = async (
  dataSource: DataSource,
  supplied: TrackedInboundClaim,
): Promise<
  Omit<PreparedTrackedInbound, 'status'> & { status: 'COMMITTED' }
> => {
  const claim = { ...supplied };
  let uniqueRetryUsed = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const queryRunner = dataSource.createQueryRunner('master');
    const originalManager = queryRunner.manager;
    let beginAttempted = false;
    let commitAttempted = false;
    let failure: unknown;
    let rollbackConfirmed = false;
    try {
      await queryRunner.connect();
      beginAttempted = true;
      await queryRunner.startTransaction('READ COMMITTED');
      for (const statement of INBOUND_SESSION_SETTINGS)
        await queryRunner.query(statement);
      if (queryRunner.manager !== originalManager)
        throw new TrackedInboundFailure('ORIGINAL_MANAGER_REPLACED');
      const prepared = await prepareTrackedInbound({ queryRunner, claim });
      if (queryRunner.manager !== originalManager)
        throw new TrackedInboundFailure('ORIGINAL_MANAGER_REPLACED');
      commitAttempted = true;
      await queryRunner.commitTransaction();
      return { ...prepared, status: 'COMMITTED' };
    } catch (error) {
      failure = error;
      // A best-effort rollback after a COMMIT error does not disambiguate it.
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
          rollbackConfirmed = true;
        } catch {
          /* Reconciliation is required. */
        }
      } else rollbackConfirmed = !beginAttempted;
    } finally {
      // Release errors after a successful commit cannot turn it into a retry.
      try {
        await queryRunner.release();
      } catch {
        /* The pool owns connection disposal. */
      }
    }
    const identity = errorIdentity(failure);
    if (commitAttempted || !rollbackConfirmed)
      throw new TrackedInboundExecutionFailure(
        'COMMIT_INDETERMINATE',
        'RECONCILIATION_REQUIRED',
        identity.code,
        identity.connectionCode,
      );
    const knownUnique =
      identity.code === '23505' &&
      identity.constraint === 'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE';
    const acquisitionTransient =
      !beginAttempted && identity.connectionCode !== undefined;
    const retry =
      acquisitionTransient ||
      identity.code === '40P01' ||
      identity.code === '40001' ||
      (knownUnique && !uniqueRetryUsed);
    if (knownUnique) uniqueRetryUsed = true;
    if (retry && attempt < 3) {
      await delay(randomInt(5, 26));
      continue;
    }
    const transient =
      retry ||
      ['55P03', '57014', '08006', '08003'].includes(identity.code ?? '') ||
      (failure instanceof TrackedInboundFailure &&
        [
          'LEASE_LOST',
          'TRACKING_NOT_READY',
          'EPOCH_NOT_READY',
          'CONNECTION_NOT_READY',
        ].includes(failure.category));
    throw new TrackedInboundExecutionFailure(
      transient ? 'RETRY' : 'INTERVENTION',
      failure instanceof TrackedInboundFailure
        ? failure.category
        : 'CAUSAL_UNIT_REJECTED',
      identity.code,
      identity.connectionCode,
    );
  }
  throw new TrackedInboundExecutionFailure('RETRY', 'RETRY_BUDGET_EXHAUSTED');
};

export const requestCommittedInboundWork = async (
  result: Awaited<ReturnType<typeof executeTrackedInbound>>,
  dependencies: {
    requestPublication: (
      event: PreparedTrackedInbound['publicationRequests'][number],
    ) => Promise<unknown>;
    requestMedia: (identity: {
      workspaceId: string;
      providerConnectionId: string;
      providerMessageId: string;
    }) => Promise<unknown>;
  },
) => {
  if (result.status !== 'COMMITTED') throw new Error('Commit required');
  // Each durable mechanism recovers independently if its immediate request fails.
  const publication = await Promise.allSettled(
    result.publicationRequests.map(async (event) =>
      dependencies.requestPublication(event),
    ),
  );
  const media = await Promise.allSettled([
    Promise.resolve().then(() =>
      dependencies.requestMedia({
        workspaceId: result.workspaceId,
        providerConnectionId: result.providerConnectionId,
        providerMessageId: result.providerMessageId,
      }),
    ),
  ]);
  return { publication, media };
};
