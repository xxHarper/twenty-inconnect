import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import {
  configuredConnection,
  validatePostgresEnvironment,
} from 'src/database/scripts/inconnect-exact-upgrade/environment';

// Future adapter and network-blocked unit tests share this closed option set.
// No arbitrary options spread, replication, globs, cache or lifecycle bootstrap.
export const reviewedDataSourceOptions = (
  environment: Record<string, string | undefined>,
  entities: PostgresConnectionOptions['entities'],
): PostgresConnectionOptions => {
  requireCondition(
    Array.isArray(entities) &&
      entities.every((entity) => typeof entity === 'function'),
    'Explicit entity classes required; metadata globs and alternate mappings are forbidden',
  );
  validatePostgresEnvironment(environment);
  const connection = configuredConnection(
    environment.PG_DATABASE_URL as string,
  );

  return {
    type: 'postgres',
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.user,
    password: connection.password,
    ssl: false,
    schema: 'core',
    entities,
    installExtensions: false,
    uuidExtension: 'uuid-ossp',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    migrations: [],
    subscribers: [],
    cache: false,
    logging: false,
    poolSize: 2,
    extra: {
      application_name: 'inconnect-exact-upgrade-runner',
      connectionTimeoutMillis: 5000,
      options:
        '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
    },
  };
};
