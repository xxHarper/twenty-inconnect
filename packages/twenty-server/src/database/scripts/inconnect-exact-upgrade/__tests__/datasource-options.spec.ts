import 'reflect-metadata';

import { DataSource, getMetadataArgsStorage } from 'typeorm';

import { reviewedDataSourceOptions } from 'src/database/scripts/inconnect-exact-upgrade/datasource-options';
import { UpgradeMigrationEntity } from 'src/engine/core-modules/upgrade/upgrade-migration.entity';

const environment = {
  PG_DATABASE_URL: 'postgresql://operator:secret@localhost:5432/default',
};

// The real TypeORM initialize/connect/metadata/afterConnect implementation runs.
// Its supported driver injection intercepts every network call in this test only.
const interceptedDriver = () => {
  const statements: string[] = [];
  const client = {
    on: jest.fn(),
    removeListener: jest.fn(),
    query: (statement: string, callback?: (error: Error) => void) => {
      statements.push(statement);
      if (!/^SELECT\b/i.test(statement.trim())) {
        const error = new Error('DDL/network forbidden');
        if (typeof callback === 'function') {
          callback(error);
          return;
        }
        return Promise.reject(error);
      }
      if (statement.includes('version()'))
        return Promise.resolve({
          rows: [{ version: 'PostgreSQL 18.6 on Linux' }],
        });
      if (statement.includes('current_schema()'))
        return Promise.resolve({ rows: [{ current_schema: 'core' }] });
      if (statement.includes('current_database()'))
        return Promise.resolve({ rows: [{ current_database: 'default' }] });
      throw new Error('Unexpected startup query');
    },
  };
  class Pool {
    on = jest.fn();
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
  return { driver: { Pool }, statements };
};

describe('actual TypeORM startup with all network calls intercepted', () => {
  it('should build real entity metadata and initialize without extensions, migrations or schema writes', async () => {
    expect(UpgradeMigrationEntity).toBeDefined();
    const interception = interceptedDriver();
    const options = reviewedDataSourceOptions(
      environment,
      getMetadataArgsStorage().tables.map(({ target }) => target),
    );
    const dataSource = new DataSource({
      ...options,
      driver: interception.driver,
    });
    try {
      await dataSource.initialize();
      expect(
        dataSource.entityMetadatas.find(
          ({ target }) => target === UpgradeMigrationEntity,
        ),
      ).toBeDefined();
      expect(
        dataSource.entityMetadatas.some(({ generatedColumns }) =>
          generatedColumns.some(
            ({ generationStrategy }) => generationStrategy === 'uuid',
          ),
        ),
      ).toBe(true);
      expect(interception.statements.length).toBeGreaterThan(0);
      expect(
        interception.statements.every((statement) =>
          /^SELECT\b/.test(statement.trim()),
        ),
      ).toBe(true);
      expect(options).toMatchObject({
        installExtensions: false,
        synchronize: false,
        migrationsRun: false,
        dropSchema: false,
        subscribers: [],
        migrations: [],
        cache: false,
      });
    } finally {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
  });

  it('should detect and reject the implicit CREATE EXTENSION regression in the installed driver', async () => {
    const interception = interceptedDriver();
    const dataSource = new DataSource({
      ...reviewedDataSourceOptions(
        environment,
        getMetadataArgsStorage().tables.map(({ target }) => target),
      ),
      installExtensions: true,
      driver: interception.driver,
    });
    try {
      await dataSource.initialize();
      // TypeORM catches extension-install errors; throwing alone is insufficient.
      expect(
        interception.statements.some((statement) =>
          statement.startsWith('CREATE EXTENSION'),
        ),
      ).toBe(true);
    } finally {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
  });
});
