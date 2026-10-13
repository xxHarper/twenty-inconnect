import { type DataSource, type QueryRunner } from 'typeorm';

// Trusted internal callers must use read-only verification and commands whose
// writes use only the supplied runner. This is not a sandbox for command code.
export type InstanceCommandConnectionVerification = {
  verifyConnection: (queryRunner: QueryRunner) => Promise<void>;
};

export type GuardedInstanceCommandOutcome =
  | 'not-started'
  | 'rolled-back'
  | 'unknown'
  | 'committed';

export type InstanceCommandErrorPhase =
  | 'verification'
  | 'execution'
  | 'rollback'
  | 'commit'
  | 'tracking'
  | 'cleanup';

export type InstanceCommandSecondaryError = {
  error: unknown;
  phase: InstanceCommandErrorPhase;
  source:
    | 'rollback'
    | 'failure-tracking'
    | 'execution-release'
    | 'failure-release'
    | 'cache-invalidation';
};

export class InstanceCommandConnectionError extends Error {
  public readonly cause: unknown;

  constructor(
    public readonly operationError: unknown,
    public readonly operationOutcome: GuardedInstanceCommandOutcome,
    public readonly failureTrackingOutcome:
      | 'not-written'
      | 'written'
      | 'unknown',
    public readonly secondaryError?: unknown,
    public readonly phase: InstanceCommandErrorPhase = 'verification',
    public readonly secondaryErrors: readonly InstanceCommandSecondaryError[] = [],
    public readonly executionPhase: InstanceCommandErrorPhase = phase,
  ) {
    super(
      `Guarded instance command stopped during ${phase}; operation=${operationOutcome}; failureTracking=${failureTrackingOutcome}`,
    );
    this.name = 'InstanceCommandConnectionError';
    this.cause = operationError;
  }
}

export const requireBoundedInstanceCommandPool = (
  dataSource: DataSource,
): void => {
  // Check the initialized pool, not just datasource options that extra can override.
  // pg-pool removes timed-out waiters; racing connect() would leave a queued lease.
  const driver = dataSource.driver as unknown as {
    master?: { options?: { connectionTimeoutMillis?: unknown } };
  };
  const timeout = driver.master?.options?.connectionTimeoutMillis;

  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > 30000
  ) {
    throw new Error(
      'Guarded instance commands require a pool acquisition timeout of 1..30000ms',
    );
  }
};

export const releaseInstanceCommandConnection = async (
  queryRunner: QueryRunner,
  physicalConnection: unknown,
): Promise<void> => {
  if (queryRunner.isReleased) return;
  if (queryRunner.isTransactionActive) {
    // Public pg Client.end() terminates an uncertain transaction before pool release.
    // Never return an active/poisoned session for another command to reuse.
    const currentConnection: unknown = await queryRunner.connect();

    for (const connection of new Set([physicalConnection, currentConnection])) {
      const client = connection as { end?: () => Promise<void> } | undefined;

      if (typeof client?.end !== 'function') {
        throw new Error(
          'Cannot safely close the active guarded transaction connection',
        );
      }
      await client.end();
    }
  }
  await queryRunner.release();
};

export const pinVerifiedInstanceCommandConnection = async (
  queryRunner: QueryRunner,
  verification: InstanceCommandConnectionVerification,
): Promise<() => Promise<void>> => {
  const physicalConnection: unknown = await queryRunner.connect();
  const verify = async () => {
    if (
      !physicalConnection ||
      queryRunner.isReleased ||
      queryRunner.manager.queryRunner !== queryRunner ||
      (await queryRunner.connect()) !== physicalConnection
    ) {
      throw new Error(
        'Verified instance command connection replaced or released',
      );
    }

    await verification.verifyConnection(queryRunner);

    if (
      queryRunner.isReleased ||
      queryRunner.manager.queryRunner !== queryRunner ||
      (await queryRunner.connect()) !== physicalConnection
    ) {
      throw new Error(
        'Instance command connection changed during verification',
      );
    }
  };

  await verify();

  return verify;
};
