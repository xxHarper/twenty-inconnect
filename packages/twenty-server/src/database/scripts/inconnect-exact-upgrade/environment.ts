import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';

import {
  requireCondition,
  validateConfiguredTarget,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

export const resolveEnvironment = (
  serverRoot: string,
  processEnvironment: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  requireCondition(
    [undefined, 'development', 'test'].includes(processEnvironment.NODE_ENV),
    'Unsupported NODE_ENV; only local development or test inspection is supported',
  );
  const path = resolve(
    serverRoot,
    processEnvironment.NODE_ENV === 'test' ? '.env.test' : '.env',
  );
  const environment = existsSync(path) ? parse(readFileSync(path)) : {};

  // Undefined means absent. Empty explicit values remain authoritative and fail.
  for (const [key, value] of Object.entries(processEnvironment)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
};

export const configuredConnection = (connectionString: string) => {
  validateConfiguredTarget(connectionString);
  const target = new URL(connectionString);
  const user = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);

  requireCondition(
    /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user) && password.length > 0,
    'Explicit intended PostgreSQL role and password are required; credential fallback is forbidden',
  );
  return {
    host: '127.0.0.1',
    port: 5432,
    database: 'default',
    user,
    password,
    ssl: false as const,
  };
};

export const validatePostgresEnvironment = (
  environment: Record<string, string | undefined>,
): void => {
  const overrides = [
    'PGHOST',
    'PGHOSTADDR',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGSERVICE',
    'PGSERVICEFILE',
    'PGPASSFILE',
    'PGOPTIONS',
    'PGSSLMODE',
    'PGSSLROOTCERT',
    'PGSSLCERT',
    'PGSSLKEY',
    'PGAPPNAME',
    'PGCONNECT_TIMEOUT',
    'PGBINARY',
    'PGCLIENT_ENCODING',
    'PGREPLICATION',
    'PGCHANNELBINDING',
    'PGTARGETSESSIONATTRS',
  ];

  requireCondition(
    overrides.every((key) => environment[key] === undefined),
    'Ambient PostgreSQL connection overrides are forbidden',
  );
  requireCondition(
    Boolean(environment.PG_DATABASE_URL) &&
      !environment.PG_DATABASE_REPLICA_URL,
    'Explicit primary configuration required; replica configuration is forbidden',
  );
  configuredConnection(environment.PG_DATABASE_URL as string);
};
