import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  decode,
  requireLeadPhysical,
  validateConfiguration,
  validateManifest,
} from 'test/development/inconnect-lead-physical/contracts';

const secretSchema = z.strictObject({
  postgres: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[^\x00-\x20\x7f]+$/),
  redis: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[^\x00-\x20\x7f]+$/),
});

// Reject even explicitly empty inherited URLs/loader hooks. This is not process.env.
export const rejectInheritedEnvironment = (
  input: Record<string, string | undefined>,
): void => {
  const allowed: Record<string, string> = {
    NODE_ENV: 'test',
    LANG: 'C',
    LC_ALL: 'C',
  };
  requireLeadPhysical(
    Object.entries(input).every(
      ([key, value]) =>
        value === undefined ||
        (Object.prototype.hasOwnProperty.call(allowed, key) &&
          allowed[key] === value),
    ),
    'Inherited environment rejected; supply only the explicit PHYS-P1 allowlist',
  );
};

export const buildApplicationEnvironmentCandidate = (
  input: unknown,
  credentials: unknown,
) => {
  const configuration = validateConfiguration(input);
  const secrets = decode(secretSchema, credentials);
  const postgres = `postgresql://${configuration.role}:${encodeURIComponent(secrets.postgres)}@127.0.0.1:${configuration.postgresPort}/${configuration.database}`;
  const redis = `redis://:${encodeURIComponent(secrets.redis)}@127.0.0.1:${configuration.redisPort}/0`;
  // Secret-bearing return value is for a future private exec channel, never logs.
  return Object.freeze({
    NODE_ENV: 'test',
    LANG: 'C',
    LC_ALL: 'C',
    HOME: '/lm/home',
    PG_DATABASE_URL: postgres,
    PG_DATABASE_REPLICA_URL: postgres,
    REDIS_URL: redis,
    REDIS_QUEUE_URL: redis,
    PG_POOL_MAX_CONNECTIONS: '2',
    IS_CONFIG_VARIABLES_IN_DB_ENABLED: 'false',
    INCONNECT_RECORD_ACCESS_SOURCE_MODE: 'database',
    TELEMETRY_ENABLED: 'false',
  });
};

const datasourceSchema = z.strictObject({
  url: z.string(),
  synchronize: z.literal(false),
  migrationsRun: z.literal(false),
  dropSchema: z.literal(false),
  installExtensions: z.literal(false),
});
const effectiveSchema = z.strictObject({
  core: datasourceSchema,
  raw: datasourceSchema,
  workspace: datasourceSchema,
  workspaceReplica: datasourceSchema,
  redisUrl: z.string(),
  redisQueueUrl: z.string(),
  dotenvVisible: z.literal(false),
  configSource: z.literal('explicit-environment'),
  jobsExplorerRegistered: z.literal(false),
  workersRegistered: z.literal(false),
});

export const compareEffectiveConfiguration = (
  input: unknown,
  credentials: unknown,
  effectiveInput: unknown,
): void => {
  const manifest = validateManifest(input);
  const secrets = decode(secretSchema, credentials);
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  requireLeadPhysical(
    manifest.redis !== undefined &&
      hash(secrets.postgres) === manifest.postgresCredentialSha256 &&
      hash(secrets.redis) === manifest.redisCredentialSha256,
    'Credentials differ from independently provisioned disposable credentials',
  );
  const expected = buildApplicationEnvironmentCandidate(
    manifest.configuration,
    secrets,
  );
  const actual = decode(effectiveSchema, effectiveInput);
  requireLeadPhysical(
    [actual.core, actual.raw, actual.workspace, actual.workspaceReplica].every(
      (source) => source.url === expected.PG_DATABASE_URL,
    ) &&
      actual.redisUrl === expected.REDIS_URL &&
      actual.redisQueueUrl === expected.REDIS_QUEUE_URL,
    'Effective connection mismatch; bootstrap and writes remain blocked',
  );
};
