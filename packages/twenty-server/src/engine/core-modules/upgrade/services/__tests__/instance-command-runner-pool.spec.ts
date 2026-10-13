import { EventEmitter } from 'node:events';

import { Pool as PostgresPool, type PoolConfig, type PoolClient } from 'pg';
import { DataSource, type QueryRunner, type Repository } from 'typeorm';

import {
  createSessionConnectionVerification,
  SESSION_IDENTITY_SQL,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { type UpgradeStatusService } from 'src/engine/core-modules/upgrade/services/upgrade-status.service';
import { UpgradeMigrationEntity } from 'src/engine/core-modules/upgrade/upgrade-migration.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceVersionService } from 'src/engine/workspace-manager/workspace-version/services/workspace-version.service';

const expected = {
  database: 'inconnect_disposable_pool_test',
  host: '127.0.0.1/32',
  port: 55432,
  version: '18.6',
  dataDirectory: '/test-only/no-cluster',
  systemIdentifier: '456',
  currentUser: 'tester',
  sessionUser: 'tester',
  clientAddress: '127.0.0.1/32' as const,
};

// Installed pg-pool manages the real wait queue/timeouts; only Client transport is
// substituted. Installed TypeORM owns connect/BEGIN/COMMIT/ROLLBACK/release.
const createFixture = async () => {
  const events: string[] = [];
  const clients: TestClient[] = [];
  const runners: QueryRunner[] = [];
  const releaseCalls: number[] = [];
  const savedRows: unknown[][] = [];
  let pool: Pool | undefined;
  let mismatchFailureSession = false;
  let failTracking = false;
  let failRollback = false;
  let beforeFailureAcquisition: (() => void) | undefined;
  const operationError = new Error('registered up failure');
  const trackingError = new Error('FAILED batch failure');
  const rollbackError = new Error('ROLLBACK acknowledgement lost');

  class TestClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    identity = { ...expected, backendPid: 101, backendStart: 'test-start' };
    constructor() {
      super();
      clients.push(this);
    }
    connect(callback: (error?: Error) => void) {
      callback();
    }
    async query(statement: string) {
      if (statement.includes('version()'))
        return { rows: [{ version: 'PostgreSQL 18.6' }] };
      if (statement.includes('current_schema()'))
        return { rows: [{ current_schema: 'core' }] };
      if (
        statement.includes('current_database()') &&
        statement !== SESSION_IDENTITY_SQL
      )
        return { rows: [{ current_database: expected.database }] };
      if (statement === SESSION_IDENTITY_SQL) {
        events.push(`verify:${runners.length}`);
        return { rows: [{ ...this.identity }] };
      }
      events.push(statement);
      if (statement === 'ROLLBACK' && failRollback) throw rollbackError;
      return { rows: [], rowCount: 0 };
    }
    async end(callback?: () => void) {
      if (this._ending) {
        callback?.();
        return;
      }
      this._ending = true;
      events.push('client:end');
      this.emit('end');
      callback?.();
    }
  }
  class Pool extends PostgresPool {
    constructor(options: PoolConfig) {
      super({ ...options, Client: TestClient } as unknown as PoolConfig);
      pool = this;
    }
  }
  const dataSource = new DataSource({
    type: 'postgres',
    driver: { Pool },
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    subscribers: [],
    entities: [],
    migrations: [],
    cache: false,
    poolSize: 1,
    extra: { connectionTimeoutMillis: 30 },
  });
  await dataSource.initialize();
  events.length = 0;
  const createRunner = dataSource.createQueryRunner.bind(dataSource);
  jest.spyOn(dataSource, 'createQueryRunner').mockImplementation(() => {
    if (runners.length === 1) beforeFailureAcquisition?.();
    const runner = createRunner();
    runners.push(runner);
    const ordinal = runners.length;
    const release = runner.release.bind(runner);
    jest.spyOn(runner, 'release').mockImplementation(async () => {
      events.push(`release:${ordinal}`);
      releaseCalls.push(ordinal);
      await release();
      if (ordinal === 1 && mismatchFailureSession)
        clients[0].identity.currentUser = 'wrong-role';
    });
    const trackingRepository = {
      count: async () => 2,
      save: async (rows: unknown[]) => {
        savedRows.push(rows);
        if (ordinal === 1) return;
        // Model repository.save's transaction ownership while exercising the
        // actual tracking service's batches and the installed QueryRunner.
        await runner.startTransaction();
        events.push('FAILED:save');
        if (failTracking) {
          await runner.rollbackTransaction();
          throw trackingError;
        }
        await runner.commitTransaction();
      },
    };
    jest.spyOn(runner.manager, 'getRepository').mockImplementation((entity) => {
      const repository =
        entity === UpgradeMigrationEntity
          ? trackingRepository
          : {
              find: async () =>
                Array.from({ length: 1001 }, (_, index) => ({
                  id: `workspace-${index}`,
                })),
            };
      return repository as unknown as ReturnType<
        typeof runner.manager.getRepository
      >;
    });
    return runner;
  });
  const invalidate = jest.fn().mockResolvedValue(undefined);
  const service = new InstanceCommandRunnerService(
    dataSource,
    { get: () => '2.32.0' } as unknown as TwentyConfigService,
    new UpgradeMigrationService({
      findOne: async () => null,
    } as unknown as Repository<UpgradeMigrationEntity>),
    new WorkspaceVersionService({} as Repository<WorkspaceEntity>),
    {
      invalidateInstanceAndAllWorkspacesStatus: invalidate,
    } as unknown as UpgradeStatusService,
  );
  const verification = createSessionConnectionVerification(expected);
  const run = () =>
    service.runFastInstanceCommand({
      name: 'test-registered-command',
      command: {
        up: async () => {
          throw operationError;
        },
        down: async () => undefined,
      },
      connectionVerification: verification,
    });
  if (!pool) throw new Error('Test pool not initialized');
  return {
    dataSource,
    pool,
    clients,
    runners,
    events,
    releaseCalls,
    savedRows,
    invalidate,
    run,
    operationError,
    trackingError,
    rollbackError,
    mismatchFailureSession: () => {
      mismatchFailureSession = true;
    },
    failTracking: () => {
      failTracking = true;
    },
    failRollback: () => {
      failRollback = true;
    },
    beforeFailureAcquisition: (callback: () => void) => {
      beforeFailureAcquisition = callback;
    },
  };
};

describe('actual guarded runner with installed one-slot pg-pool (no network)', () => {
  beforeEach(() => jest.useRealTimers());
  afterEach(() => jest.useFakeTimers());

  it('should release A and reacquire its physical client as independently verified B without a timeout', async () => {
    const fixture = await createFixture();
    try {
      await expect(fixture.run()).resolves.toEqual({
        status: 'failed',
        error: fixture.operationError,
      });
      expect(fixture.clients).toHaveLength(1);
      expect(fixture.events.indexOf('release:1')).toBeLessThan(
        fixture.events.indexOf('verify:2'),
      );
      expect(fixture.events).toContain('verify:2');
      expect(fixture.releaseCalls).toEqual([1, 2]);
      expect(fixture.savedRows.map((rows) => rows.length)).toEqual([1000, 2]);
      expect(fixture.savedRows[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'failed',
            attempt: 3,
            workspaceId: null,
          }),
          expect.objectContaining({
            status: 'failed',
            attempt: 3,
            workspaceId: 'workspace-0',
          }),
        ]),
      );
      expect(
        fixture.events.filter((event) => event === 'START TRANSACTION'),
      ).toHaveLength(3);
      expect(fixture.events.filter((event) => event === 'COMMIT')).toHaveLength(
        2,
      );
      expect(fixture.pool.waitingCount).toBe(0);
      expect(fixture.pool.idleCount).toBe(1);
      expect(fixture.dataSource.driver).toMatchObject({
        connectedQueryRunners: [],
      });
    } finally {
      await fixture.dataSource.destroy();
    }
  }, 2000);

  it('should reject an unverified B even when it reuses the same pooled physical client', async () => {
    const fixture = await createFixture();
    fixture.mismatchFailureSession();
    try {
      await expect(fixture.run()).resolves.toMatchObject({
        status: 'failed',
        error: {
          operationError: fixture.operationError,
          operationOutcome: 'rolled-back',
          failureTrackingOutcome: 'not-written',
        },
      });
      expect(fixture.clients).toHaveLength(1);
      expect(fixture.savedRows).toHaveLength(0);
      expect(fixture.releaseCalls).toEqual([1, 2]);
      expect(fixture.pool.waitingCount).toBe(0);
      expect(fixture.pool.idleCount).toBe(1);
    } finally {
      await fixture.dataSource.destroy();
    }
  }, 2000);

  it('should settle when another consumer exhausts the pool before B and remove the timed-out waiter', async () => {
    const fixture = await createFixture();
    // Hold the only lease after A's normal release. No release is used to unblock B.
    let competingClient: PoolClient | undefined;
    fixture.beforeFailureAcquisition(() => {
      void fixture.pool.connect().then((client) => {
        competingClient = client;
      });
    });
    try {
      await expect(fixture.run()).resolves.toMatchObject({
        status: 'failed',
        error: {
          cause: fixture.operationError,
          operationOutcome: 'rolled-back',
          failureTrackingOutcome: 'not-written',
          secondaryError: expect.objectContaining({
            message: 'timeout exceeded when trying to connect',
          }),
        },
      });
      expect(fixture.savedRows).toHaveLength(0);
      expect(fixture.pool.waitingCount).toBe(0);
      expect(fixture.releaseCalls).toEqual([1, 2]);
      expect(fixture.invalidate).toHaveBeenCalledTimes(1);
    } finally {
      // Cleanup only after the runner has already settled with the timeout.
      competingClient?.release();
      await fixture.dataSource.destroy();
    }
  }, 2000);

  it('should end the active client after rollback failure before releasing the runner and skip B', async () => {
    const fixture = await createFixture();
    fixture.failRollback();
    try {
      await expect(fixture.run()).resolves.toMatchObject({
        status: 'failed',
        error: {
          operationError: fixture.operationError,
          secondaryError: fixture.rollbackError,
          operationOutcome: 'unknown',
          failureTrackingOutcome: 'not-written',
        },
      });
      expect(fixture.events.indexOf('ROLLBACK')).toBeLessThan(
        fixture.events.indexOf('client:end'),
      );
      expect(fixture.events.indexOf('client:end')).toBeLessThan(
        fixture.events.indexOf('release:1'),
      );
      expect(fixture.releaseCalls).toEqual([1]);
      expect(fixture.runners).toHaveLength(1);
      expect(fixture.pool.totalCount).toBe(0);
      expect(fixture.dataSource.driver).toMatchObject({
        connectedQueryRunners: [],
      });
    } finally {
      await fixture.dataSource.destroy();
    }
  }, 2000);

  it('should preserve FAILED batch failure and release B after its save transaction rolls back', async () => {
    const fixture = await createFixture();
    fixture.failTracking();
    try {
      await expect(fixture.run()).resolves.toMatchObject({
        status: 'failed',
        error: {
          operationError: fixture.operationError,
          secondaryError: fixture.trackingError,
          operationOutcome: 'rolled-back',
          failureTrackingOutcome: 'unknown',
        },
      });
      expect(fixture.events.lastIndexOf('ROLLBACK')).toBeLessThan(
        fixture.events.indexOf('release:2'),
      );
      expect(fixture.releaseCalls).toEqual([1, 2]);
      expect(fixture.pool.idleCount).toBe(1);
    } finally {
      await fixture.dataSource.destroy();
    }
  }, 2000);
});
