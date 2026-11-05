import { DataSource, type DataSourceOptions } from 'typeorm';

export const runLegacyCoreMigrations = async (options: DataSourceOptions) => {
  if (options.type !== 'postgres') {
    throw new Error('Legacy Core migrations require PostgreSQL');
  }

  // These frozen migrations issue SQL directly. Without runtime entities,
  // TypeORM leaves creation of the metadata table to SetupMetadataTables.
  const migrationDataSource = new DataSource({
    ...options,
    entities: [],
    subscribers: [],
    cache: false,
    poolSize: 1,
    installExtensions: false,
    dropSchema: false,
    synchronize: false,
    migrationsRun: false,
  });

  await migrationDataSource.initialize();
  try {
    return await migrationDataSource.runMigrations({ transaction: 'each' });
  } finally {
    await migrationDataSource.destroy();
  }
};
