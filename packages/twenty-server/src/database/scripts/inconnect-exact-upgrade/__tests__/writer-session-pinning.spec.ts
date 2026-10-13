import { EventEmitter } from 'node:events';

import { DataSource } from 'typeorm';

import {
  createSessionConnectionVerification,
  SESSION_IDENTITY_SQL,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { pinVerifiedInstanceCommandConnection } from 'src/engine/core-modules/upgrade/types/instance-command-connection-verification';

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

// Supported pg driver injection prevents every network call. The installed
// PostgresQueryRunner implementation owns acquisition, queries and release.
const createInterceptedDataSource = () => {
  const client = Object.assign(new EventEmitter(), {
    query: jest.fn(async (statement: string) => {
      if (!/^SELECT\b/.test(statement.trim()))
        throw new Error('Writes forbidden');
      if (statement === SESSION_IDENTITY_SQL)
        return {
          rows: [
            {
              ...expected,
              backendPid: 101,
              backendStart: '2026-10-13 01:00:00+00',
            },
          ],
        };
      if (statement.includes('version()'))
        return { rows: [{ version: 'PostgreSQL 18.6' }] };
      if (statement.includes('current_schema()'))
        return { rows: [{ current_schema: 'core' }] };
      if (statement.includes('current_database()'))
        return { rows: [{ current_database: expected.database }] };
      return { rows: [] };
    }),
  });
  const acquire = jest.fn();
  const release = jest.fn();
  class Pool {
    on = jest.fn();
    connect(
      callback: (
        error: null,
        connected: typeof client,
        releaseClient: typeof release,
      ) => void,
    ) {
      acquire();
      callback(null, client, release);
    }
    end(callback: (error: null) => void) {
      callback(null);
    }
  }
  const dataSource = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 55432,
    database: expected.database,
    username: 'tester',
    password: 'test-only',
    driver: { Pool },
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    subscribers: [],
    entities: [],
    migrations: [],
    cache: false,
  });
  return { dataSource, client, acquire, release };
};

describe('installed TypeORM physical-client retention (network intercepted)', () => {
  it('should retain the verified client for repeated queries until release', async () => {
    const fixture = createInterceptedDataSource();
    await fixture.dataSource.initialize();
    const runner = fixture.dataSource.createQueryRunner();
    try {
      const verify = await pinVerifiedInstanceCommandConnection(
        runner,
        createSessionConnectionVerification(expected),
      );
      const acquisitionCount = fixture.acquire.mock.calls.length;
      const client = await runner.connect();
      await runner.query('SELECT 1');
      await verify();
      expect(await runner.connect()).toBe(client);
      expect(fixture.acquire).toHaveBeenCalledTimes(acquisitionCount);
      expect(runner.manager.queryRunner).toBe(runner);
    } finally {
      await runner.release();
      await fixture.dataSource.destroy();
    }
  });

  it('should release a broken client and reject further queries without reacquiring', async () => {
    const fixture = createInterceptedDataSource();
    await fixture.dataSource.initialize();
    const runner = fixture.dataSource.createQueryRunner();
    try {
      const verify = await pinVerifiedInstanceCommandConnection(
        runner,
        createSessionConnectionVerification(expected),
      );
      const acquisitionCount = fixture.acquire.mock.calls.length;
      fixture.client.emit('error', new Error('connection lost'));
      expect(runner.isReleased).toBe(true);
      await expect(runner.query('SELECT 1')).rejects.toThrow(
        'already released',
      );
      await expect(verify()).rejects.toThrow('replaced or released');
      expect(fixture.acquire).toHaveBeenCalledTimes(acquisitionCount);
      expect(fixture.release).toHaveBeenLastCalledWith(expect.any(Error));
    } finally {
      await runner.release();
      await fixture.dataSource.destroy();
    }
  });
});
