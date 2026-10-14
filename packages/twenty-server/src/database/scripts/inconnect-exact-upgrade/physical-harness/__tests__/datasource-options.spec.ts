import 'reflect-metadata';

import { DataSource, getMetadataArgsStorage } from 'typeorm';

import { UpgradeMigrationEntity } from 'src/engine/core-modules/upgrade/upgrade-migration.entity';
import {
  makeTarget,
  TEST_PASSWORD,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/__tests__/fixtures';
import { disposableDataSourceOptions } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/datasource-options';

describe('disposable datasource construction and intercepted TypeORM startup', () => {
  it('should bind every connection parameter explicitly without implicit DDL or alternate paths', () => {
    const options = disposableDataSourceOptions(
      makeTarget(),
      TEST_PASSWORD,
      { NODE_ENV: 'test' },
      [UpgradeMigrationEntity],
    );
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 55432,
      database: 'inconnect_disposable_pg1',
      username: 'inconnect_disposable_writer',
      password: TEST_PASSWORD,
      installExtensions: false,
      synchronize: false,
      migrationsRun: false,
      dropSchema: false,
      subscribers: [],
      migrations: [],
      cache: false,
      logging: false,
      ssl: false,
      poolSize: 1,
      extra: { connectionTimeoutMillis: 1000 },
    });
    expect(options).not.toHaveProperty('url');
    expect(options).not.toHaveProperty('replication');
  });
  it.each([undefined, 'postgresql://app:secret@127.0.0.1:5432/default', ''])(
    'should reject missing or hostile process target and never use dotenv fallback %s',
    (url) => {
      const environment = { NODE_ENV: 'test', PG_DATABASE_URL: url };
      if (url === undefined) {
        const options = disposableDataSourceOptions(
          makeTarget(),
          TEST_PASSWORD,
          environment,
          [UpgradeMigrationEntity],
        );
        expect(options.database).toBe(makeTarget().database);
      } else {
        expect(() =>
          disposableDataSourceOptions(
            makeTarget(),
            TEST_PASSWORD,
            environment,
            [UpgradeMigrationEntity],
          ),
        ).toThrow();
      }
      expect(() =>
        disposableDataSourceOptions(undefined, TEST_PASSWORD, environment, [
          UpgradeMigrationEntity,
        ]),
      ).toThrow();
    },
  );
  it('should reject metadata globs, empty graph and unexpected credentials', () => {
    for (const entities of [[], ['src/**/*.entity.ts']]) {
      expect(() =>
        disposableDataSourceOptions(
          makeTarget(),
          TEST_PASSWORD,
          { NODE_ENV: 'test' },
          entities,
        ),
      ).toThrow();
    }
    expect(() =>
      disposableDataSourceOptions(
        makeTarget(),
        'wrong-password',
        { NODE_ENV: 'test' },
        [UpgradeMigrationEntity],
      ),
    ).toThrow();
  });
  it('should run installed TypeORM initialization with real metadata and only intercepted SELECTs', async () => {
    const statements: string[] = [];
    const poolOptions: unknown[] = [];
    const client = {
      on: jest.fn(),
      removeListener: jest.fn(),
      query: (statement: string, callback?: (error: Error) => void) => {
        statements.push(statement);
        if (!/^SELECT\b/i.test(statement.trim())) {
          const error = new Error('Startup write forbidden');
          if (callback) {
            callback(error);
            return;
          }
          return Promise.reject(error);
        }
        if (statement.includes('version()'))
          return Promise.resolve({ rows: [{ version: 'PostgreSQL 18.6' }] });
        if (statement.includes('current_schema()'))
          return Promise.resolve({ rows: [{ current_schema: 'core' }] });
        if (statement.includes('current_database()'))
          return Promise.resolve({
            rows: [{ current_database: makeTarget().database }],
          });
        throw new Error('Unexpected startup SQL');
      },
    };
    // Supported driver injection belongs to this unit test only. No real pg Pool
    // or Client is constructed, and no TypeORM global prototype is modified.
    class Pool {
      on = jest.fn();
      constructor(options: unknown) {
        poolOptions.push(options);
      }
      connect(
        callback: (
          error: null,
          connected: typeof client,
          release: () => void,
        ) => void,
      ) {
        callback(null, client, () => undefined);
      }
      end(callback: (error: null) => void) {
        callback(null);
      }
    }
    const options = disposableDataSourceOptions(
      makeTarget(),
      TEST_PASSWORD,
      { NODE_ENV: 'test' },
      getMetadataArgsStorage().tables.map(({ target }) => target),
    );
    const dataSource = new DataSource({ ...options, driver: { Pool } });
    try {
      await dataSource.initialize();
      expect(dataSource.getMetadata(UpgradeMigrationEntity).tablePath).toBe(
        'core.upgradeMigration',
      );
      expect(poolOptions).toHaveLength(1);
      expect(poolOptions[0]).toMatchObject({
        host: '127.0.0.1',
        port: 55432,
        database: makeTarget().database,
      });
      expect(statements.length).toBeGreaterThan(0);
      expect(
        statements.every((statement) => /^SELECT\b/.test(statement.trim())),
      ).toBe(true);
      expect(
        statements.some((statement) =>
          /CREATE EXTENSION|ALTER|INSERT/.test(statement),
        ),
      ).toBe(false);
    } finally {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
  });
});
