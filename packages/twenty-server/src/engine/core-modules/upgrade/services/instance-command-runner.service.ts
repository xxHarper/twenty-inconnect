import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type QueryRunner } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { UpgradeStatusService } from 'src/engine/core-modules/upgrade/services/upgrade-status.service';
import {
  type GuardedInstanceCommandOutcome,
  type InstanceCommandConnectionVerification,
  type InstanceCommandSecondaryError,
  InstanceCommandConnectionError,
  pinVerifiedInstanceCommandConnection,
  releaseInstanceCommandConnection,
  requireBoundedInstanceCommandPool,
} from 'src/engine/core-modules/upgrade/types/instance-command-connection-verification';
import { WorkspaceVersionService } from 'src/engine/workspace-manager/workspace-version/services/workspace-version.service';

type RunSingleMigrationResult =
  | { status: 'success' }
  | { status: 'already-executed' }
  | { status: 'failed'; error: unknown };

@Injectable()
export class InstanceCommandRunnerService {
  private readonly logger = new Logger(InstanceCommandRunnerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly upgradeMigrationService: UpgradeMigrationService,
    private readonly workspaceVersionService: WorkspaceVersionService,
    private readonly upgradeStatusService: UpgradeStatusService,
  ) {}

  async runFastInstanceCommand({
    command,
    name,
    connectionVerification,
  }: {
    command: FastInstanceCommand;
    name: string;
    connectionVerification?: InstanceCommandConnectionVerification;
  }): Promise<RunSingleMigrationResult> {
    // Subscriber callbacks can acquire unrelated repositories even during BEGIN.
    // Guarded execution supports only the audited direct PostgreSQL lifecycle.
    if (
      connectionVerification &&
      (this.dataSource.options.type !== 'postgres' ||
        ('replication' in this.dataSource.options &&
          this.dataSource.options.replication) ||
        this.dataSource.subscribers.length > 0 ||
        this.dataSource.options.cache ||
        this.dataSource.queryResultCache)
    ) {
      throw new Error(
        'Guarded instance commands require PostgreSQL without replication or subscribers or query-result cache',
      );
    }

    if (connectionVerification)
      requireBoundedInstanceCommandPool(this.dataSource);

    const executedByVersion =
      this.twentyConfigService.get('APP_VERSION') ?? 'unknown';

    const isAlreadyCompleted =
      await this.upgradeMigrationService.isLastAttemptCompleted({
        name,
        workspaceId: null,
      });

    if (isAlreadyCompleted) {
      this.logger.log(`${name} already executed, skipping`);

      return { status: 'already-executed' };
    }

    if (connectionVerification) {
      return this.runGuardedFastInstanceCommand({
        command,
        name,
        executedByVersion,
        connectionVerification,
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      await command.up(queryRunner);

      const workspaceIds =
        await this.workspaceVersionService.getProvisionedWorkspaceIds({
          queryRunner,
        });

      await this.upgradeMigrationService.recordUpgradeMigration({
        name,
        workspaceIds,
        isInstance: true,
        status: 'completed',
        executedByVersion,
        queryRunner,
      });

      await queryRunner.commitTransaction();

      this.logger.log(`${name} executed successfully`);

      return { status: 'success' };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      const workspaceIds =
        await this.workspaceVersionService.getProvisionedWorkspaceIds();

      await this.upgradeMigrationService.recordUpgradeMigration({
        name,
        workspaceIds,
        isInstance: true,
        status: 'failed',
        executedByVersion,
        error,
      });

      this.logger.error(
        `${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );

      return { status: 'failed', error };
    } finally {
      await queryRunner.release();
      await this.safeInvalidateUpgradeStatusCache();
    }
  }

  private async runGuardedFastInstanceCommand({
    command,
    name,
    executedByVersion,
    connectionVerification,
  }: {
    command: FastInstanceCommand;
    name: string;
    executedByVersion: string;
    connectionVerification: InstanceCommandConnectionVerification;
  }): Promise<RunSingleMigrationResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    const secondaryErrors: InstanceCommandSecondaryError[] = [];
    let physicalConnection: unknown;
    let verifyConnection: (() => Promise<void>) | undefined;
    let operationStarted = false;
    let commitAttempted = false;
    let sessionVerified = false;
    let operationOutcome: GuardedInstanceCommandOutcome = 'not-started';
    let operationError: unknown;
    let failed = false;
    let phase: InstanceCommandConnectionError['phase'] = 'verification';
    let executionPhase: InstanceCommandConnectionError['phase'] = phase;
    let failureTrackingOutcome: InstanceCommandConnectionError['failureTrackingOutcome'] =
      'not-written';
    let cleanupFailed = false;

    try {
      physicalConnection = await queryRunner.connect();
      const verifyPinnedConnection = await pinVerifiedInstanceCommandConnection(
        queryRunner,
        connectionVerification,
      );
      sessionVerified = true;
      verifyConnection = async () => {
        const previousPhase = phase;
        phase = 'verification';
        sessionVerified = false;
        await verifyPinnedConnection();
        sessionVerified = true;
        phase = previousPhase;
      };

      phase = 'execution';
      await queryRunner.startTransaction();
      await verifyConnection();
      operationStarted = true;
      operationOutcome = 'unknown';
      await command.up(queryRunner);
      await verifyConnection();
      if (!queryRunner.isTransactionActive) {
        throw new Error('Guarded command ended the runner-owned transaction');
      }
      const workspaceIds =
        await this.workspaceVersionService.getProvisionedWorkspaceIds({
          queryRunner,
        });
      await verifyConnection();
      phase = 'tracking';
      await this.upgradeMigrationService.recordUpgradeMigration({
        name,
        workspaceIds,
        isInstance: true,
        status: 'completed',
        executedByVersion,
        queryRunner,
      });
      await verifyConnection();
      phase = 'commit';
      commitAttempted = true;
      await queryRunner.commitTransaction();
      operationOutcome = 'committed';
      this.logger.log(`${name} executed successfully`);
    } catch (error) {
      failed = true;
      operationError = error;
      executionPhase = phase;
      try {
        if (queryRunner.isTransactionActive) {
          if (
            queryRunner.isReleased ||
            (await queryRunner.connect()) !== physicalConnection
          ) {
            throw new Error('Cannot verify rollback connection continuity');
          }
          await queryRunner.rollbackTransaction();
          if (queryRunner.isTransactionActive)
            throw new Error('Rollback did not end the guarded transaction');
          // Lost COMMIT acknowledgement remains unknown even after ROLLBACK.
          if (!commitAttempted && operationStarted && sessionVerified) {
            await verifyConnection?.();
            operationOutcome = 'rolled-back';
          }
        }
      } catch (rollbackError) {
        if (
          queryRunner.isTransactionActive ||
          operationStarted ||
          commitAttempted
        )
          operationOutcome = 'unknown';
        secondaryErrors.push({
          error: rollbackError,
          source: 'rollback',
          phase: 'rollback',
        });
      }
    }

    // Finish A before creating B: this also works when the pool has one slot.
    try {
      await releaseInstanceCommandConnection(queryRunner, physicalConnection);
    } catch (releaseError) {
      cleanupFailed = true;
      secondaryErrors.push({
        error: releaseError,
        source: 'execution-release',
        phase: 'cleanup',
      });
    }

    if (failed && operationOutcome === 'rolled-back' && !cleanupFailed) {
      const tracking = await this.recordGuardedFailure({
        name,
        executedByVersion,
        error: operationError,
        connectionVerification,
        secondaryErrors,
      });
      failureTrackingOutcome = tracking.outcome;
      cleanupFailed = tracking.cleanupFailed;
    }

    // Cache failures remain warning-only, but join an existing failure chain.
    const cacheErrors: unknown[] = [];
    await this.safeInvalidateUpgradeStatusCache(cacheErrors);
    if (failed || cleanupFailed) {
      secondaryErrors.push(
        ...cacheErrors.map(
          (error): InstanceCommandSecondaryError => ({
            error,
            source: 'cache-invalidation',
            phase: 'cleanup',
          }),
        ),
      );
    }

    if (
      cleanupFailed ||
      (failed &&
        (operationOutcome !== 'rolled-back' || secondaryErrors.length > 0))
    ) {
      const error = new InstanceCommandConnectionError(
        operationError,
        operationOutcome,
        failureTrackingOutcome,
        secondaryErrors[0]?.error,
        secondaryErrors[secondaryErrors.length - 1]?.phase ?? executionPhase,
        secondaryErrors,
        failed ? executionPhase : phase,
      );
      // Retain the existing cleanup exception contract while preserving all earlier errors.
      if (cleanupFailed) throw error;
      return { status: 'failed', error };
    }
    return failed
      ? { status: 'failed', error: operationError }
      : { status: 'success' };
  }

  private async recordGuardedFailure({
    name,
    executedByVersion,
    error,
    connectionVerification,
    secondaryErrors,
  }: {
    name: string;
    executedByVersion: string;
    error: unknown;
    connectionVerification: InstanceCommandConnectionVerification;
    secondaryErrors: InstanceCommandSecondaryError[];
  }): Promise<{
    outcome: InstanceCommandConnectionError['failureTrackingOutcome'];
    cleanupFailed: boolean;
  }> {
    let failureRunner: QueryRunner | undefined;
    let physicalConnection: unknown;
    let outcome: InstanceCommandConnectionError['failureTrackingOutcome'] =
      'not-written';
    let phase: InstanceCommandConnectionError['phase'] = 'verification';
    let cleanupFailed = false;

    try {
      failureRunner = this.dataSource.createQueryRunner();
      physicalConnection = await failureRunner.connect();
      const verifyConnection = await pinVerifiedInstanceCommandConnection(
        failureRunner,
        connectionVerification,
      );
      phase = 'tracking';
      const workspaceIds =
        await this.workspaceVersionService.getProvisionedWorkspaceIds({
          queryRunner: failureRunner,
        });
      phase = 'verification';
      await verifyConnection();
      phase = 'tracking';
      outcome = 'unknown';
      // Keep repository.save's existing per-batch transactions, attempts and workspace rows.
      await this.upgradeMigrationService.recordUpgradeMigration({
        name,
        workspaceIds,
        isInstance: true,
        status: 'failed',
        executedByVersion,
        error,
        queryRunner: failureRunner,
      });
      outcome = 'written';
      this.logger.error(
        `${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    } catch (trackingError) {
      secondaryErrors.push({
        error: trackingError,
        source: 'failure-tracking',
        phase,
      });
    }
    if (failureRunner) {
      try {
        // save() normally rolls back itself. If it cannot, try before terminating the client.
        if (failureRunner.isTransactionActive && !failureRunner.isReleased) {
          try {
            if ((await failureRunner.connect()) !== physicalConnection)
              throw new Error(
                'Cannot verify tracking rollback connection continuity',
              );
            await failureRunner.rollbackTransaction();
          } catch (rollbackError) {
            secondaryErrors.push({
              error: rollbackError,
              source: 'rollback',
              phase: 'rollback',
            });
          }
        }
        await releaseInstanceCommandConnection(
          failureRunner,
          physicalConnection,
        );
      } catch (releaseError) {
        cleanupFailed = true;
        secondaryErrors.push({
          error: releaseError,
          source: 'failure-release',
          phase: 'cleanup',
        });
      }
    }
    return { outcome, cleanupFailed };
  }

  private async safeInvalidateUpgradeStatusCache(
    errors?: unknown[],
  ): Promise<void> {
    try {
      await this.upgradeStatusService.invalidateInstanceAndAllWorkspacesStatus();
    } catch (error) {
      errors?.push(error);
      this.logger.warn(
        `Failed to invalidate upgrade-status cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async runSlowInstanceCommand({
    command,
    name,
    skipDataMigration,
  }: {
    command: SlowInstanceCommand;
    name: string;
    skipDataMigration?: boolean;
  }): Promise<RunSingleMigrationResult> {
    const isAlreadyCompleted =
      await this.upgradeMigrationService.isLastAttemptCompleted({
        name,
        workspaceId: null,
      });

    if (isAlreadyCompleted) {
      this.logger.log(`${name} already executed, skipping`);

      return { status: 'already-executed' };
    }

    if (!skipDataMigration) {
      const executedByVersion =
        this.twentyConfigService.get('APP_VERSION') ?? 'unknown';

      try {
        this.logger.log(`${name} starting data migration...`);
        await command.runDataMigration(this.dataSource);
        this.logger.log(`${name} data migration completed`);
      } catch (error) {
        const workspaceIds =
          await this.workspaceVersionService.getProvisionedWorkspaceIds();

        await this.upgradeMigrationService.recordUpgradeMigration({
          name,
          workspaceIds,
          isInstance: true,
          status: 'failed',
          executedByVersion,
          error,
        });

        this.logger.error(
          `${name} data migration failed`,
          error instanceof Error ? error.stack : String(error),
        );

        await this.safeInvalidateUpgradeStatusCache();

        return { status: 'failed', error };
      }
    }

    return this.runFastInstanceCommand({
      command,
      name,
    });
  }
}
