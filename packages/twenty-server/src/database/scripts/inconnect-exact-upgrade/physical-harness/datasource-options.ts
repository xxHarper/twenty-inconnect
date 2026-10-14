import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import {
  validateDisposableCredential,
  validateHarnessEnvironment,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

// Pure factory: never imports the application datasource or initializes a pool.
export const disposableDataSourceOptions = (
  input: unknown,
  password: string,
  environment: Record<string, string | undefined>,
  entities: PostgresConnectionOptions['entities'],
  poolSize: 1 | 2 = 1,
): PostgresConnectionOptions => {
  validateHarnessEnvironment(environment);
  const contract = validateDisposableCredential(input, password);
  const explicitEntities = Array.isArray(entities) ? entities : [];
  requireCondition(
    explicitEntities.length > 0 &&
      explicitEntities.every((entity) => typeof entity === 'function') &&
      (poolSize === 1 || poolSize === 2),
    'Explicit real entity classes and bounded test pool required',
  );
  return {
    type: 'postgres',
    host: contract.host,
    port: contract.port,
    database: contract.database,
    username: contract.role,
    password,
    ssl: false,
    schema: 'core',
    entities: [...explicitEntities],
    installExtensions: false,
    uuidExtension: 'uuid-ossp',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    migrations: [],
    subscribers: [],
    cache: false,
    logging: false,
    poolSize,
    extra: {
      application_name: `inconnect-pg-${contract.runId}`,
      connectionTimeoutMillis: 1000,
      options:
        '-c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000',
    },
  };
};
