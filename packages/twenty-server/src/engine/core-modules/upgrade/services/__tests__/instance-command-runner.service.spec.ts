import { type DataSource, type QueryRunner, type Repository } from 'typeorm';

import {
  createSessionConnectionVerification,
  SESSION_IDENTITY_SQL,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { type UpgradeStatusService } from 'src/engine/core-modules/upgrade/services/upgrade-status.service';
import { InstanceCommandConnectionError } from 'src/engine/core-modules/upgrade/types/instance-command-connection-verification';
import { UpgradeMigrationEntity } from 'src/engine/core-modules/upgrade/upgrade-migration.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceVersionService } from 'src/engine/workspace-manager/workspace-version/services/workspace-version.service';

const expected = {
  database: 'inconnect_disposable_proof',
  host: '127.0.0.1/32',
  port: 55432,
  version: '18.6',
  dataDirectory: '/tmp/isolated-cluster',
  systemIdentifier: '456',
  currentUser: 'tester',
  sessionUser: 'tester',
  clientAddress: '127.0.0.1/32' as const,
};

const createFixture = () => {
  const events: string[] = [];
  const createRunner = (label: string, backendPid: number) => {
    const state = {
      physicalConnection: {
        end: jest.fn(async () => {
          events.push(`${label}:end`);
        }),
      },
      identity: {
        ...expected,
        backendPid,
        backendStart: '2026-10-13 01:00:00+00',
      },
    };
    const trackingRepository = {
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (_rows: unknown[]) => {
        events.push(`${label}:save`);
      }),
    };
    const workspaceRepository = {
      find: jest.fn().mockResolvedValue([{ id: 'workspace' }]),
    };
    const runner = {
      isTransactionActive: false,
      isReleased: false,
      connect: jest.fn(async () => state.physicalConnection),
      query: jest.fn(async (sql: string) => {
        events.push(
          `${label}:${sql === SESSION_IDENTITY_SQL ? 'verify' : 'mutation'}`,
        );
        return sql === SESSION_IDENTITY_SQL ? [{ ...state.identity }] : [];
      }),
      startTransaction: jest.fn(async () => {
        events.push(`${label}:begin`);
        runner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(async () => {
        events.push(`${label}:commit`);
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(async () => {
        events.push(`${label}:rollback`);
        runner.isTransactionActive = false;
      }),
      release: jest.fn(async () => {
        events.push(`${label}:release`);
      }),
      manager: {
        queryRunner: undefined as QueryRunner | undefined,
        getRepository: jest.fn((entity: unknown) => {
          if (entity === UpgradeMigrationEntity) return trackingRepository;
          if (entity === WorkspaceEntity) return workspaceRepository;
          throw new Error('Unexpected repository');
        }),
      },
    };
    runner.manager.queryRunner = runner as unknown as QueryRunner;

    return { runner, state, trackingRepository, workspaceRepository };
  };
  const execution = createRunner('execution', 101);
  const failure = createRunner('failure', 102);
  const unboundTracking = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const unboundWorkspace = {
    find: jest.fn().mockResolvedValue([{ id: 'workspace' }]),
  };
  const dataSource = {
    options: { type: 'postgres' },
    subscribers: [] as unknown[],
    driver: {
      master: { options: { connectionTimeoutMillis: 5000 as unknown } },
    },
    createQueryRunner: jest
      .fn()
      .mockReturnValueOnce(execution.runner)
      .mockReturnValueOnce(failure.runner),
  };
  const invalidate = jest.fn().mockResolvedValue(undefined);
  const service = new InstanceCommandRunnerService(
    dataSource as unknown as DataSource,
    { get: () => '2.32.0' } as unknown as TwentyConfigService,
    new UpgradeMigrationService(
      unboundTracking as unknown as Repository<UpgradeMigrationEntity>,
    ),
    new WorkspaceVersionService(
      unboundWorkspace as unknown as Repository<WorkspaceEntity>,
    ),
    {
      invalidateInstanceAndAllWorkspacesStatus: invalidate,
    } as unknown as UpgradeStatusService,
  );
  const command = {
    up: jest.fn(async (queryRunner: QueryRunner) => {
      await queryRunner.query('TEST_MUTATION');
    }),
    down: jest.fn(),
  };
  const verification = createSessionConnectionVerification(expected);
  const run = (guarded = true) =>
    service.runFastInstanceCommand({
      command,
      name: 'registered-command',
      ...(guarded ? { connectionVerification: verification } : {}),
    });

  return {
    events,
    execution,
    failure,
    unboundTracking,
    unboundWorkspace,
    dataSource,
    invalidate,
    command,
    run,
  };
};

describe('actual Fast runner verified writer contract (no PostgreSQL)', () => {
  it('should verify before BEGIN and up and save completion on the same runner', async () => {
    const fixture = createFixture();
    await expect(fixture.run()).resolves.toEqual({ status: 'success' });
    expect(fixture.events).toEqual([
      'execution:verify',
      'execution:begin',
      'execution:verify',
      'execution:mutation',
      'execution:verify',
      'execution:verify',
      'execution:save',
      'execution:verify',
      'execution:commit',
      'execution:release',
    ]);
    expect(fixture.command.up).toHaveBeenCalledWith(fixture.execution.runner);
    expect(fixture.execution.trackingRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: null,
        status: 'completed',
        attempt: 3,
      }),
      expect.objectContaining({
        workspaceId: 'workspace',
        status: 'completed',
        attempt: 3,
      }),
    ]);
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
    expect(fixture.unboundWorkspace.find).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { database: 'default' },
    { currentUser: 'postgres' },
    { sessionUser: 'postgres' },
    { host: 'other' },
    { port: 5432 },
    { version: 'other' },
    { dataDirectory: '/other' },
    { systemIdentifier: '123' },
  ])(
    'should prevent up and all tracking on actual identity mismatch %j',
    async (change) => {
      const fixture = createFixture();
      Object.assign(fixture.execution.state.identity, change);
      const result = await fixture.run();
      expect(result).toMatchObject({
        status: 'failed',
        error: {
          operationOutcome: 'not-started',
          failureTrackingOutcome: 'not-written',
        },
      });
      expect(fixture.command.up).not.toHaveBeenCalled();
      expect(fixture.execution.runner.startTransaction).not.toHaveBeenCalled();
      expect(fixture.execution.trackingRepository.save).not.toHaveBeenCalled();
      expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
      expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
    },
  );

  it('should fail closed when identity evidence cannot be queried', async () => {
    const fixture = createFixture();
    fixture.execution.runner.query.mockRejectedValue(
      new Error('permission denied'),
    );
    await expect(fixture.run()).resolves.toMatchObject({ status: 'failed' });
    expect(fixture.command.up).not.toHaveBeenCalled();
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
  });

  it('should detect backend replacement between verification and transaction start', async () => {
    const fixture = createFixture();
    fixture.execution.runner.startTransaction.mockImplementation(async () => {
      fixture.execution.runner.isTransactionActive = true;
      fixture.execution.state.identity.backendPid++;
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: { operationOutcome: 'not-started' },
    });
    expect(fixture.command.up).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should reject replacement of the physical client without claiming rollback', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.state.physicalConnection = { end: jest.fn() };
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationOutcome: 'unknown',
        failureTrackingOutcome: 'not-written',
      },
    });
    expect(fixture.execution.runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fixture.execution.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should keep final state unknown when the backend changes after up on the retained client', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.state.identity.backendPid++;
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationOutcome: 'unknown',
        failureTrackingOutcome: 'not-written',
      },
    });
    expect(fixture.execution.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should avoid writes after the execution client is released during up', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.runner.isReleased = true;
      throw new Error('connection lost');
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: { operationOutcome: 'unknown' },
    });
    expect(fixture.execution.runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should reject a command that ends the runner transaction before tracking', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.runner.isTransactionActive = false;
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: { operationOutcome: 'unknown' },
    });
    expect(fixture.execution.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should verify a separate FAILED tracking session and preserve original error', async () => {
    const fixture = createFixture();
    const error = new Error('up failed');
    fixture.command.up.mockRejectedValue(error);
    await expect(fixture.run()).resolves.toEqual({ status: 'failed', error });
    expect(fixture.events).toEqual([
      'execution:verify',
      'execution:begin',
      'execution:verify',
      'execution:rollback',
      'execution:verify',
      'execution:release',
      'failure:verify',
      'failure:verify',
      'failure:save',
      'failure:release',
    ]);
    expect(fixture.failure.trackingRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: null,
        status: 'failed',
        attempt: 3,
        errorMessage: expect.stringContaining('up failed'),
      }),
      expect.objectContaining({
        workspaceId: 'workspace',
        status: 'failed',
        attempt: 3,
      }),
    ]);
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
  });

  it.each([
    { currentUser: 'postgres' },
    { sessionUser: 'postgres' },
    { database: 'default' },
  ])(
    'should never write FAILED on a mismatched independent session %j',
    async (change) => {
      const fixture = createFixture();
      const error = new Error('up failed');
      fixture.command.up.mockRejectedValue(error);
      Object.assign(fixture.failure.state.identity, change);
      const result = await fixture.run();
      expect(result).toMatchObject({
        status: 'failed',
        error: {
          operationError: error,
          operationOutcome: 'rolled-back',
          failureTrackingOutcome: 'not-written',
        },
      });
      expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
      expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
      expect(fixture.failure.runner.release).toHaveBeenCalled();
    },
  );

  it('should retain operation and rollback errors and avoid FAILED after rollback error', async () => {
    const fixture = createFixture();
    const error = new Error('up failed');
    const rollbackError = new Error('rollback lost');
    fixture.command.up.mockRejectedValue(error);
    fixture.execution.runner.rollbackTransaction.mockRejectedValue(
      rollbackError,
    );
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationError: error,
        secondaryError: rollbackError,
        operationOutcome: 'unknown',
      },
    });
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should reject failure-session replacement during workspace lookup before saving', async () => {
    const fixture = createFixture();
    fixture.command.up.mockRejectedValue(new Error('up failed'));
    fixture.failure.workspaceRepository.find.mockImplementation(async () => {
      fixture.failure.state.identity.backendPid++;
      return [{ id: 'workspace' }];
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationOutcome: 'rolled-back',
        failureTrackingOutcome: 'not-written',
      },
    });
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'should keep COMMIT uncertainty even if transactionActive=%s',
    async (active) => {
      const fixture = createFixture();
      const error = new Error('COMMIT acknowledgement lost');
      fixture.execution.runner.commitTransaction.mockImplementation(
        async () => {
          fixture.execution.runner.isTransactionActive = active;
          throw error;
        },
      );
      await expect(fixture.run()).resolves.toMatchObject({
        status: 'failed',
        error: {
          operationError: error,
          operationOutcome: 'unknown',
          failureTrackingOutcome: 'not-written',
        },
      });
      expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
      expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
    },
  );

  it('should roll back completion tracking failure and track it on a verified independent runner', async () => {
    const fixture = createFixture();
    const error = new Error('completion tracking failed');
    fixture.execution.trackingRepository.save.mockRejectedValue(error);
    await expect(fixture.run()).resolves.toEqual({ status: 'failed', error });
    expect(fixture.execution.runner.commitTransaction).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).toHaveBeenCalled();
  });

  it('should preserve original error and unknown FAILED result when tracking save fails', async () => {
    const fixture = createFixture();
    const error = new Error('up failed');
    const trackingError = new Error('tracking commit lost');
    fixture.command.up.mockRejectedValue(error);
    fixture.failure.trackingRepository.save.mockRejectedValue(trackingError);
    const result = await fixture.run();
    expect(result).toMatchObject({
      status: 'failed',
      error: {
        operationError: error,
        secondaryError: trackingError,
        operationOutcome: 'rolled-back',
        failureTrackingOutcome: 'unknown',
      },
    });
    expect(result.status === 'failed' && result.error).toBeInstanceOf(
      InstanceCommandConnectionError,
    );
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
  });

  it('should preserve committed outcome and invalidate cache despite release failure', async () => {
    const fixture = createFixture();
    fixture.execution.runner.release.mockRejectedValue(
      new Error('release failed'),
    );
    await expect(fixture.run()).rejects.toMatchObject({
      operationOutcome: 'committed',
    });
    expect(fixture.invalidate).toHaveBeenCalled();
  });

  it('should preserve success despite status cache failure', async () => {
    const fixture = createFixture();
    fixture.invalidate.mockRejectedValue(new Error('cache unavailable'));
    await expect(fixture.run()).resolves.toEqual({ status: 'success' });
  });

  it('should skip an already completed command without acquiring writers', async () => {
    const fixture = createFixture();
    fixture.unboundTracking.findOne.mockResolvedValue({ status: 'completed' });
    await expect(fixture.run()).resolves.toEqual({
      status: 'already-executed',
    });
    expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('should reject subscriber lifecycle writes before acquiring a guarded runner', async () => {
    const fixture = createFixture();
    fixture.dataSource.subscribers.push({});
    await expect(fixture.run()).rejects.toThrow(
      'without replication or subscribers',
    );
    expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('should reject query-result caching that could turn read-only prechecks into implicit writes', async () => {
    const fixture = createFixture();
    Object.assign(fixture.dataSource.options, {
      cache: { alwaysEnabled: true },
    });
    await expect(fixture.run()).rejects.toThrow('query-result cache');
    expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(fixture.unboundTracking.findOne).not.toHaveBeenCalled();
  });

  it('should bind every FAILED save batch to the separately verified runner', async () => {
    const fixture = createFixture();
    fixture.command.up.mockRejectedValue(new Error('up failed'));
    fixture.failure.workspaceRepository.find.mockResolvedValue(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `workspace-${index}`,
      })),
    );
    await expect(fixture.run()).resolves.toMatchObject({ status: 'failed' });
    expect(fixture.failure.trackingRepository.save).toHaveBeenCalledTimes(2);
    expect(
      fixture.failure.trackingRepository.save.mock.calls[0][0],
    ).toHaveLength(1000);
    expect(
      fixture.failure.trackingRepository.save.mock.calls[1][0],
    ).toHaveLength(2);
    expect(fixture.execution.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.unboundTracking.save).not.toHaveBeenCalled();
  });

  it('should settle FAILED tracking with a one-slot pool without external release', async () => {
    const fixture = createFixture();
    const error = new Error('up failed');
    fixture.command.up.mockRejectedValue(error);
    let retained = true;
    fixture.execution.runner.release.mockImplementation(async () => {
      fixture.events.push('execution:release');
      retained = false;
    });
    fixture.failure.runner.connect.mockImplementation(async () => {
      if (retained)
        throw new Error('one-slot acquisition timed out while A retained');
      return fixture.execution.state.physicalConnection;
    });
    await expect(fixture.run()).resolves.toEqual({ status: 'failed', error });
    expect(fixture.events.indexOf('execution:release')).toBeLessThan(
      fixture.events.indexOf('failure:verify'),
    );
    expect(fixture.failure.trackingRepository.save).toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.failure.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should preserve operation and tracking errors when B release also fails', async () => {
    const fixture = createFixture();
    const operationError = new Error('original up stack');
    const trackingError = new Error('FAILED tracking stack');
    const releaseError = new Error('B release stack');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.trackingRepository.save.mockRejectedValue(trackingError);
    fixture.failure.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      cause: operationError,
      operationError,
      secondaryError: trackingError,
      secondaryErrors: [
        { source: 'failure-tracking', error: trackingError, phase: 'tracking' },
        { source: 'failure-release', error: releaseError, phase: 'cleanup' },
      ],
      executionPhase: 'execution',
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'unknown',
    });
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.failure.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.invalidate).toHaveBeenCalledTimes(1);
  });

  it('should preserve rollback and original errors when A release also fails', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const rollbackError = new Error('rollback failed');
    const releaseError = new Error('A release failed');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.execution.runner.rollbackTransaction.mockRejectedValue(
      rollbackError,
    );
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      cause: operationError,
      secondaryError: rollbackError,
      secondaryErrors: [
        { source: 'rollback', error: rollbackError, phase: 'rollback' },
        { source: 'execution-release', error: releaseError, phase: 'cleanup' },
      ],
      executionPhase: 'execution',
      operationOutcome: 'unknown',
      failureTrackingOutcome: 'not-written',
    });
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should stop before B acquisition when A release fails after rollback', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const releaseError = new Error('A release failed');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationError,
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { source: 'execution-release', error: releaseError, phase: 'cleanup' },
      ],
    });
    expect(fixture.dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should preserve acquisition failure before B verification with no unverified write', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const acquisitionError = new Error('pool unavailable');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.runner.connect.mockRejectedValue(acquisitionError);
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        cause: operationError,
        executionPhase: 'execution',
        operationOutcome: 'rolled-back',
        failureTrackingOutcome: 'not-written',
        secondaryErrors: [
          {
            error: acquisitionError,
            source: 'failure-tracking',
            phase: 'verification',
          },
        ],
      },
    });
    expect(fixture.failure.runner.query).not.toHaveBeenCalled();
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.failure.runner.release).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 0, -1, Infinity, NaN, '5000', 1.5, 30001])(
    'should reject an unbounded or unsupported actual pool timeout %s before acquiring or reading',
    async (timeout) => {
      const fixture = createFixture();
      fixture.dataSource.driver.master.options.connectionTimeoutMillis =
        timeout;
      await expect(fixture.run()).rejects.toThrow('pool acquisition timeout');
      expect(fixture.unboundTracking.findOne).not.toHaveBeenCalled();
      expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
    },
  );

  it('should keep ordinary execution compatible with an unbounded pool', async () => {
    const fixture = createFixture();
    fixture.dataSource.driver.master.options.connectionTimeoutMillis = 0;
    await expect(fixture.run(false)).resolves.toEqual({ status: 'success' });
  });

  it('should prevent the former operation plus tracking plus A cleanup combination by releasing A first', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const trackingError = new Error('tracking would fail');
    const releaseError = new Error('A cleanup failed');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.trackingRepository.save.mockRejectedValue(trackingError);
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      cause: operationError,
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { error: releaseError, source: 'execution-release', phase: 'cleanup' },
      ],
    });
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.invalidate).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'should preserve ambiguous COMMIT and A cleanup errors when active=%s',
    async (active) => {
      const fixture = createFixture();
      const commitError = new Error('COMMIT acknowledgement lost');
      const releaseError = new Error('A cleanup failed');
      fixture.execution.runner.commitTransaction.mockImplementation(
        async () => {
          fixture.execution.runner.isTransactionActive = active;
          throw commitError;
        },
      );
      fixture.execution.runner.release.mockRejectedValue(releaseError);
      await expect(fixture.run()).rejects.toMatchObject({
        cause: commitError,
        operationError: commitError,
        executionPhase: 'commit',
        operationOutcome: 'unknown',
        failureTrackingOutcome: 'not-written',
        secondaryErrors: [
          {
            error: releaseError,
            source: 'execution-release',
            phase: 'cleanup',
          },
        ],
      });
      expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
      expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    },
  );

  it('should preserve acknowledged COMMIT despite cleanup and cache failures', async () => {
    const fixture = createFixture();
    const releaseError = new Error('A release failed');
    const cacheError = new Error('cache failed');
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    fixture.invalidate.mockRejectedValue(cacheError);
    await expect(fixture.run()).rejects.toMatchObject({
      executionPhase: 'commit',
      operationOutcome: 'committed',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { error: releaseError, source: 'execution-release', phase: 'cleanup' },
        { error: cacheError, source: 'cache-invalidation', phase: 'cleanup' },
      ],
    });
    expect(fixture.execution.runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should retain all original references and stacks across tracking, B release and cache errors', async () => {
    const fixture = createFixture();
    const operationError = new Error('up original');
    const trackingError = new Error('FAILED original');
    const releaseError = new Error('B original');
    const cacheError = new Error('cache original');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.trackingRepository.save.mockRejectedValue(trackingError);
    fixture.failure.runner.release.mockRejectedValue(releaseError);
    fixture.invalidate.mockRejectedValue(cacheError);
    const result: unknown = await fixture
      .run()
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(InstanceCommandConnectionError);
    const error = result as InstanceCommandConnectionError;
    expect(error.operationError).toBe(operationError);
    expect(error.cause).toBe(operationError);
    expect(error.secondaryError).toBe(trackingError);
    expect(error.secondaryErrors.map((entry) => entry.error)).toEqual([
      trackingError,
      releaseError,
      cacheError,
    ]);
    expect(error.secondaryErrors[0].error).toBe(trackingError);
    expect(error.secondaryErrors[1].error).toBe(releaseError);
    expect(error.secondaryErrors[2].error).toBe(cacheError);
    expect(operationError.stack).toContain('up original');
    expect(trackingError.stack).toContain('FAILED original');
    expect(error.operationOutcome).toBe('rolled-back');
    expect(error.failureTrackingOutcome).toBe('unknown');
  });

  it('should retain acknowledged FAILED tracking when B cleanup fails', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const releaseError = new Error('B cleanup failed');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationError,
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'written',
      secondaryErrors: [
        { error: releaseError, source: 'failure-release', phase: 'cleanup' },
      ],
    });
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.failure.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should retain verification and B release failures without an unverified B write', async () => {
    const fixture = createFixture();
    fixture.command.up.mockRejectedValue(new Error('up failed'));
    fixture.failure.state.identity.currentUser = 'wrong-role';
    const releaseError = new Error('B release failed');
    fixture.failure.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        {
          source: 'failure-tracking',
          phase: 'verification',
          error: expect.any(Error),
        },
        { source: 'failure-release', phase: 'cleanup', error: releaseError },
      ],
    });
    expect(fixture.failure.trackingRepository.save).not.toHaveBeenCalled();
  });

  it('should verify A continuity after rollback before permitting FAILED tracking', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.state.identity.backendPid++;
      throw new Error('connection replaced during up');
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationOutcome: 'unknown',
        failureTrackingOutcome: 'not-written',
      },
    });
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should preserve NOT_STARTED and cleanup error when acquiring A fails', async () => {
    const fixture = createFixture();
    const acquisitionError = new Error('A acquisition failed');
    const releaseError = new Error('A cleanup failed');
    fixture.execution.runner.connect.mockRejectedValue(acquisitionError);
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationError: acquisitionError,
      executionPhase: 'verification',
      operationOutcome: 'not-started',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { error: releaseError, source: 'execution-release', phase: 'cleanup' },
      ],
    });
    expect(fixture.command.up).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
  });

  it('should never release an active transaction into the pool when client termination fails', async () => {
    const fixture = createFixture();
    const rollbackError = new Error('rollback failed');
    const terminationError = new Error('cannot terminate client');
    fixture.command.up.mockRejectedValue(new Error('up failed'));
    fixture.execution.runner.rollbackTransaction.mockRejectedValue(
      rollbackError,
    );
    fixture.execution.state.physicalConnection.end.mockRejectedValue(
      terminationError,
    );
    await expect(fixture.run()).rejects.toMatchObject({
      operationOutcome: 'unknown',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { error: rollbackError, source: 'rollback', phase: 'rollback' },
        {
          error: terminationError,
          source: 'execution-release',
          phase: 'cleanup',
        },
      ],
    });
    expect(fixture.execution.runner.release).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledTimes(1);
  });

  it('should avoid a second release when TypeORM already released the broken A client', async () => {
    const fixture = createFixture();
    fixture.command.up.mockImplementation(async () => {
      fixture.execution.runner.isReleased = true;
      throw new Error('TypeORM auto-released client');
    });
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: { operationOutcome: 'unknown' },
    });
    expect(fixture.execution.runner.release).not.toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
  });

  it('should preserve ordinary release exception propagation and cache ordering', async () => {
    const fixture = createFixture();
    const releaseError = new Error('ordinary release failed');
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run(false)).rejects.toBe(releaseError);
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.execution.runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fixture.invalidate).not.toHaveBeenCalled();
  });

  it('should retain completion tracking as the original execution phase across rollback and cleanup faults', async () => {
    const fixture = createFixture();
    const trackingError = new Error('completion save failed');
    const rollbackError = new Error('rollback failed');
    const releaseError = new Error('A release failed');
    fixture.execution.trackingRepository.save.mockRejectedValue(trackingError);
    fixture.execution.runner.rollbackTransaction.mockRejectedValue(
      rollbackError,
    );
    fixture.execution.runner.release.mockRejectedValue(releaseError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationError: trackingError,
      executionPhase: 'tracking',
      operationOutcome: 'unknown',
      failureTrackingOutcome: 'not-written',
      secondaryErrors: [
        { error: rollbackError, source: 'rollback', phase: 'rollback' },
        { error: releaseError, source: 'execution-release', phase: 'cleanup' },
      ],
    });
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
  });

  it('should report UNKNOWN if rollback fails before the registered operation starts', async () => {
    const fixture = createFixture();
    const beginError = new Error('BEGIN acknowledgement lost');
    const rollbackError = new Error('ROLLBACK acknowledgement lost');
    fixture.execution.runner.startTransaction.mockImplementation(async () => {
      fixture.execution.runner.isTransactionActive = true;
      throw beginError;
    });
    fixture.execution.runner.rollbackTransaction.mockRejectedValue(
      rollbackError,
    );
    await expect(fixture.run()).resolves.toMatchObject({
      status: 'failed',
      error: {
        operationError: beginError,
        secondaryError: rollbackError,
        operationOutcome: 'unknown',
        failureTrackingOutcome: 'not-written',
      },
    });
    expect(fixture.command.up).not.toHaveBeenCalled();
    expect(
      fixture.execution.state.physicalConnection.end,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
  });

  it('should retain operation, tracking, B rollback, B release and cache failures independently', async () => {
    const fixture = createFixture();
    const operationError = new Error('up failed');
    const trackingError = new Error('FAILED save failed');
    const rollbackError = new Error('B rollback failed');
    const releaseError = new Error('B release failed');
    const cacheError = new Error('cache failed');
    fixture.command.up.mockRejectedValue(operationError);
    fixture.failure.trackingRepository.save.mockImplementation(async () => {
      fixture.failure.runner.isTransactionActive = true;
      throw trackingError;
    });
    fixture.failure.runner.rollbackTransaction.mockRejectedValue(rollbackError);
    fixture.failure.runner.release.mockRejectedValue(releaseError);
    fixture.invalidate.mockRejectedValue(cacheError);
    await expect(fixture.run()).rejects.toMatchObject({
      operationError,
      cause: operationError,
      executionPhase: 'execution',
      operationOutcome: 'rolled-back',
      failureTrackingOutcome: 'unknown',
      secondaryErrors: [
        { error: trackingError, source: 'failure-tracking', phase: 'tracking' },
        { error: rollbackError, source: 'rollback', phase: 'rollback' },
        { error: releaseError, source: 'failure-release', phase: 'cleanup' },
        { error: cacheError, source: 'cache-invalidation', phase: 'cleanup' },
      ],
    });
    expect(fixture.failure.state.physicalConnection.end).toHaveBeenCalledTimes(
      1,
    );
    expect(fixture.failure.runner.release).toHaveBeenCalledTimes(1);
    expect(fixture.execution.runner.release).toHaveBeenCalledTimes(1);
  });

  it('should preserve ordinary success with no verification queries', async () => {
    const fixture = createFixture();
    await expect(fixture.run(false)).resolves.toEqual({ status: 'success' });
    expect(fixture.events).toEqual([
      'execution:begin',
      'execution:mutation',
      'execution:save',
      'execution:commit',
      'execution:release',
    ]);
  });

  it('should preserve ordinary repository-owned failure tracking', async () => {
    const fixture = createFixture();
    const error = new Error('up failed');
    fixture.command.up.mockRejectedValue(error);
    await expect(fixture.run(false)).resolves.toEqual({
      status: 'failed',
      error,
    });
    expect(fixture.unboundTracking.save).toHaveBeenCalled();
    expect(fixture.unboundWorkspace.find).toHaveBeenCalled();
    expect(fixture.failure.runner.connect).not.toHaveBeenCalled();
  });

  it.each(['rollback', 'tracking'] as const)(
    'should preserve ordinary %s exception propagation',
    async (stage) => {
      const fixture = createFixture();
      fixture.command.up.mockRejectedValue(new Error('up failed'));
      const error = new Error('secondary failure');
      if (stage === 'rollback')
        fixture.execution.runner.rollbackTransaction.mockRejectedValue(error);
      else fixture.unboundTracking.save.mockRejectedValue(error);
      await expect(fixture.run(false)).rejects.toBe(error);
      expect(fixture.execution.runner.release).toHaveBeenCalled();
      expect(fixture.invalidate).toHaveBeenCalled();
    },
  );
});
