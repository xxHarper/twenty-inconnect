import { posix } from 'node:path';

import { z } from 'zod';

export const BLOCKED = 'BLOCKED' as const;

export const requireLeadPhysical = (
  condition: boolean,
  message: string,
): void => {
  if (!condition) throw new Error(message);
};

// Fixed diagnostics deliberately omit malformed input, URLs and credentials.
export const decode = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
): TValue => {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Invalid PHYS-P1 contract');
  return result.data;
};

export const identifier = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const uuid = z
  .string()
  .uuid()
  .regex(/^[a-f0-9-]{36}$/);

const configurationSchema = z.strictObject({
  runId: uuid,
  bootId: uuid,
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  resourceRoot: z.string(),
  database: z.string(),
  role: z.string(),
  postgresPort: z.number().int().min(1024).max(65535),
  redisPort: z.number().int().min(1024).max(65535),
  memoryMiB: z.number().int().min(256).max(4096),
  processLimit: z.number().int().min(4).max(64),
  deadlineSeconds: z.number().int().min(1).max(600),
});

export type LeadPhysicalConfiguration = z.infer<typeof configurationSchema>;

export const validateConfiguration = (
  input: unknown,
): LeadPhysicalConfiguration => {
  const configuration = decode(configurationSchema, input);
  const suffix = configuration.runId.replace(/-/g, '');
  requireLeadPhysical(
    configuration.resourceRoot ===
      `/tmp/inconnect-lead-phys-${configuration.runId}` &&
      configuration.database === `inconnect_lm_${suffix}` &&
      configuration.role === `lm_${suffix}` &&
      ![5432, 6379].includes(configuration.postgresPort) &&
      ![5432, 6379, configuration.postgresPort].includes(
        configuration.redisPort,
      ),
    'Run-specific root, database, role and private distinct ports required',
  );
  return configuration;
};

export const namespacesSchema = z.strictObject({
  user: z.string().regex(/^user:\[[1-9][0-9]*\]$/),
  network: z.string().regex(/^net:\[[1-9][0-9]*\]$/),
  mount: z.string().regex(/^mnt:\[[1-9][0-9]*\]$/),
  process: z.string().regex(/^pid:\[[1-9][0-9]*\]$/),
});

export const processIdentitySchema = z.strictObject({
  pid: z.number().int().min(2),
  startTicks: identifier,
  executable: z.string(),
  executableSha256: digest,
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  origin: z.literal('independent-supervisor-offline-control'),
  configuration: configurationSchema,
  hostNamespaces: namespacesSchema,
  isolatedNamespaces: namespacesSchema,
  ownerUid: z.number().int().positive(),
  supervisor: processIdentitySchema,
  postmaster: processIdentitySchema,
  redis: processIdentitySchema.optional(),
  systemIdentifier: identifier,
  excludedSystemIdentifier: identifier,
  controlDataSha256: digest,
  postgresCredentialSha256: digest,
  redisCredentialSha256: digest,
  postmasterStartedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/),
  serverVersionNum: z.number().int().min(180000).max(189999),
});

export type LeadPhysicalManifest = z.infer<typeof manifestSchema>;

// A matching JSON manifest is only a candidate. PHYS-P1 has no trusted observer.
export const validateManifest = (input: unknown): LeadPhysicalManifest => {
  const manifest = decode(manifestSchema, input);
  validateConfiguration(manifest.configuration);
  requireLeadPhysical(
    Object.keys(manifest.hostNamespaces).every((key) => {
      const namespace = key as keyof typeof manifest.hostNamespaces;
      return (
        manifest.hostNamespaces[namespace] !==
        manifest.isolatedNamespaces[namespace]
      );
    }) &&
      manifest.systemIdentifier !== manifest.excludedSystemIdentifier &&
      new Set([
        manifest.supervisor.pid,
        manifest.postmaster.pid,
        ...(manifest.redis ? [manifest.redis.pid] : []),
      ]).size === (manifest.redis ? 3 : 2) &&
      manifest.supervisor.executable === '/usr/bin/bwrap' &&
      manifest.postmaster.executable ===
        '/usr/lib/postgresql/18/bin/postgres' &&
      (!manifest.redis ||
        manifest.redis.executable === '/usr/bin/redis-server'),
    'Independent cluster, namespaces and distinct pinned process identities required',
  );
  return manifest;
};

export const ownedPaths = (input: unknown): string[] => {
  const { resourceRoot } = validateConfiguration(input);
  return ['', '/data', '/socket', '/redis', '/secrets', '/home'].map(
    (suffix) => `${resourceRoot}${suffix}`,
  );
};

const pathObservationSchema = z.strictObject({
  path: z.string(),
  realPath: z.string(),
  kind: z.enum(['directory', 'symlink', 'file']),
  uid: z.number().int().nonnegative(),
  device: identifier,
  inode: identifier,
  mountId: identifier,
});

// Future collection must use pinned directory handles/openat no-follow semantics;
// checking strings/lstat once does not protect a later path-based deletion.
export const compareOwnedPaths = (
  input: unknown,
  observations: unknown,
): void => {
  const manifest = validateManifest(input);
  const expected = ['/', '/tmp', ...ownedPaths(manifest.configuration)];
  const actual = decode(z.array(pathObservationSchema), observations);
  const root = actual.find(
    (item) => item.path === manifest.configuration.resourceRoot,
  );
  requireLeadPhysical(
    actual.length === expected.length &&
      new Set(actual.map((item) => item.path)).size === expected.length &&
      new Set(actual.map((item) => `${item.device}:${item.inode}`)).size ===
        actual.length &&
      root !== undefined &&
      actual.every(
        (item) =>
          expected.includes(item.path) &&
          item.path === posix.normalize(item.path) &&
          item.realPath === item.path &&
          item.kind === 'directory' &&
          (item.path === '/' ||
            item.path === '/tmp' ||
            (item.uid === manifest.ownerUid &&
              item.mountId === root.mountId &&
              item.device === root.device)),
      ),
    'Complete canonical non-symlink owned paths required; preserve resources',
  );
};
