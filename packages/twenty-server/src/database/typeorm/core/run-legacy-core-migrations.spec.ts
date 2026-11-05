import { DataSource, EntitySchema, type DataSourceOptions } from 'typeorm';

import { SetupMetadataTables1700140427984 } from 'src/database/typeorm/core/legacy-typeorm-migrations-do-not-add/common/1700140427984-setupMetadataTables';
import { runLegacyCoreMigrations } from 'src/database/typeorm/core/run-legacy-core-migrations';

const METADATA_TABLE = '_typeorm_generated_columns_and_materialized_views';
const TRACKING_TABLE = '_typeorm_migrations';
const SETUP_MIGRATION = new SetupMetadataTables1700140427984().name;

const generatedColumnEntity = new EntitySchema({
  name: 'GeneratedColumnFixture',
  columns: {
    id: { type: 'integer', primary: true },
    normalized: { type: 'integer', generatedType: 'STORED', asExpression: '1' },
  },
});

const interceptPostgres = ({
  metadataExists = false,
  setupRecorded = false,
}: {
  metadataExists?: boolean;
  setupRecorded?: boolean;
} = {}) => {
  const statements: string[] = [];
  const trackingInserts: unknown[][] = [];
  const duplicateRelation = new Error('Simulated duplicate metadata relation');
  const relations = new Set([
    ...(metadataExists ? [METADATA_TABLE] : []),
    ...(setupRecorded ? [TRACKING_TABLE] : []),
  ]);
  const closePool = jest.fn();

  // The injected pool captures all SQL emitted by the installed TypeORM driver.
  // Only the two relations and the legacy tracking read need modeled results.
  const client = {
    on: jest.fn(),
    removeListener: jest.fn(),
    query: async (statement: string, parameters: unknown[] = []) => {
      const sql = statement.trim();

      statements.push(sql);
      if (sql.includes('version()')) {
        return { rows: [{ version: 'PostgreSQL 16.0' }] };
      }
      if (sql.includes('current_database()')) {
        return { rows: [{ current_database: 'install_f1_fixture' }] };
      }
      if (sql.includes('current_schema()')) {
        return { rows: [{ current_schema: 'public' }] };
      }
      if (
        sql.startsWith('SELECT') &&
        sql.includes('information_schema.tables')
      ) {
        return {
          rows: [...relations]
            .filter((table) => sql.includes(`table_name = '${table}'`))
            .map(() => ({})),
        };
      }
      if (sql.startsWith('SELECT') && sql.includes(TRACKING_TABLE)) {
        return {
          rows: setupRecorded
            ? [{ id: 1, timestamp: '1700140427984', name: SETUP_MIGRATION }]
            : [],
        };
      }
      if (sql.startsWith('INSERT INTO') && sql.includes(TRACKING_TABLE)) {
        trackingInserts.push(parameters);
      }
      if (sql.startsWith(`CREATE TABLE "core"."${METADATA_TABLE}"`)) {
        if (relations.has(METADATA_TABLE)) {
          throw duplicateRelation;
        }
        relations.add(METADATA_TABLE);
      }

      return { rows: [], rowCount: 0 };
    },
  };

  class Pool {
    on = jest.fn();

    connect(
      callback: (
        error: null,
        connection: typeof client,
        release: () => void,
      ) => void,
    ) {
      callback(null, client, () => undefined);
    }

    end(callback: (error: null) => void) {
      closePool();
      callback(null);
    }
  }

  const options: DataSourceOptions = {
    type: 'postgres',
    driver: { Pool },
    schema: 'core',
    metadataTableName: METADATA_TABLE,
    migrationsTableName: TRACKING_TABLE,
    migrations: [SetupMetadataTables1700140427984],
    entities: [generatedColumnEntity],
    installExtensions: false,
  };

  return { closePool, duplicateRelation, options, statements, trackingInserts };
};

describe('runLegacyCoreMigrations', () => {
  it('reproduces the collision with the ordinary entity-aware TypeORM migration path', async () => {
    const { duplicateRelation, options, statements, trackingInserts } =
      interceptPostgres();
    const dataSource = await new DataSource(options).initialize();

    try {
      await expect(
        dataSource.runMigrations({ transaction: 'each' }),
      ).rejects.toMatchObject({ driverError: duplicateRelation });
    } finally {
      await dataSource.destroy();
    }

    const metadataCreates = statements.filter((sql) =>
      sql.startsWith(`CREATE TABLE "core"."${METADATA_TABLE}"`),
    );

    expect(metadataCreates).toHaveLength(2);
    expect(statements.indexOf(metadataCreates[0])).toBeLessThan(
      statements.indexOf('START TRANSACTION'),
    );
    expect(statements.indexOf(metadataCreates[1])).toBeGreaterThan(
      statements.indexOf('START TRANSACTION'),
    );
    expect(statements).toContain('ROLLBACK');
    expect(trackingInserts).toEqual([]);
  });

  it('lets the historical migration create the relation and record its own completion', async () => {
    const { closePool, options, statements, trackingInserts } =
      interceptPostgres();

    await expect(runLegacyCoreMigrations(options)).resolves.toMatchObject([
      { name: SETUP_MIGRATION },
    ]);

    const metadataCreates = statements.filter((sql) =>
      sql.startsWith(`CREATE TABLE "core"."${METADATA_TABLE}"`),
    );
    const trackingInsert = statements.findIndex((sql) =>
      sql.startsWith(`INSERT INTO "core"."${TRACKING_TABLE}"`),
    );

    expect(metadataCreates).toHaveLength(1);
    expect(statements.indexOf(metadataCreates[0])).toBeGreaterThan(
      statements.indexOf('START TRANSACTION'),
    );
    expect(trackingInsert).toBeGreaterThan(
      statements.indexOf(metadataCreates[0]),
    );
    expect(statements.indexOf('COMMIT')).toBeGreaterThan(trackingInsert);
    expect(trackingInserts).toEqual([[1700140427984, SETUP_MIGRATION]]);
    expect(options.entities).toEqual([generatedColumnEntity]);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('leaves the metadata relation and tracking untouched on an installed database', async () => {
    const { closePool, options, statements, trackingInserts } =
      interceptPostgres({ metadataExists: true, setupRecorded: true });

    await expect(runLegacyCoreMigrations(options)).resolves.toEqual([]);

    expect(statements.every((sql) => sql.startsWith('SELECT'))).toBe(true);
    expect(trackingInserts).toEqual([]);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('fails and rolls back if the relation exists without setup tracking', async () => {
    const {
      closePool,
      duplicateRelation,
      options,
      statements,
      trackingInserts,
    } = interceptPostgres({ metadataExists: true });

    await expect(runLegacyCoreMigrations(options)).rejects.toMatchObject({
      driverError: duplicateRelation,
    });

    expect(statements).toContain('ROLLBACK');
    expect(trackingInserts).toEqual([]);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
