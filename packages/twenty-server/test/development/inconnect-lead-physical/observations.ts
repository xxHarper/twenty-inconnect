import { z } from 'zod';

import {
  BLOCKED,
  compareOwnedPaths,
  decode,
  identifier,
  namespacesSchema,
  processIdentitySchema,
  requireLeadPhysical,
  uuid,
  validateManifest,
} from 'test/development/inconnect-lead-physical/contracts';

const isolationSchema = z.strictObject({
  bootId: uuid,
  runId: uuid,
  hostNamespaces: namespacesSchema,
  isolatedNamespaces: namespacesSchema,
  postmasterNamespaces: namespacesSchema,
  redisNamespaces: namespacesSchema.optional(),
  supervisor: processIdentitySchema,
  postmaster: processIdentitySchema,
  redis: processIdentitySchema.optional(),
  interfaces: z.array(z.string()),
  externalRoutes: z.array(z.string()),
  tcpListeners: z.array(
    z.strictObject({ address: z.literal('127.0.0.1'), port: z.number().int() }),
  ),
  visibleUnixSockets: z.array(z.string()),
  exposedHostPaths: z.array(z.string()),
  untrackedProcesses: z.array(z.number().int()),
});

// These comparisons cannot authenticate observations, collect kernel evidence,
// prove observation freshness, or grant a connection/write/cleanup capability.
export const compareIsolationCandidate = (
  input: unknown,
  observation: unknown,
) => {
  const manifest = validateManifest(input);
  const actual = decode(isolationSchema, observation);
  const sameNamespaces = (
    left: typeof actual.hostNamespaces,
    right: typeof actual.hostNamespaces,
  ) =>
    Object.keys(left).every(
      (key) =>
        left[key as keyof typeof left] === right[key as keyof typeof right],
    );
  const sameProcess = (
    left: typeof actual.supervisor,
    right: typeof actual.supervisor,
  ) =>
    left.pid === right.pid &&
    left.startTicks === right.startTicks &&
    left.executable === right.executable &&
    left.executableSha256 === right.executableSha256;
  const ports = actual.tcpListeners
    .map((item) => item.port)
    .sort((left, right) => left - right);
  const expectedPorts = [
    manifest.configuration.postgresPort,
    ...(manifest.redis ? [manifest.configuration.redisPort] : []),
  ].sort((left, right) => left - right);
  requireLeadPhysical(
    actual.bootId === manifest.configuration.bootId &&
      actual.runId === manifest.configuration.runId &&
      sameNamespaces(actual.hostNamespaces, manifest.hostNamespaces) &&
      sameNamespaces(actual.isolatedNamespaces, manifest.isolatedNamespaces) &&
      sameNamespaces(
        actual.postmasterNamespaces,
        manifest.isolatedNamespaces,
      ) &&
      (manifest.redis
        ? actual.redisNamespaces !== undefined &&
          sameNamespaces(actual.redisNamespaces, manifest.isolatedNamespaces)
        : actual.redisNamespaces === undefined) &&
      sameProcess(actual.supervisor, manifest.supervisor) &&
      sameProcess(actual.postmaster, manifest.postmaster) &&
      (manifest.redis
        ? actual.redis !== undefined &&
          sameProcess(actual.redis, manifest.redis)
        : actual.redis === undefined) &&
      actual.interfaces.length === 1 &&
      actual.interfaces[0] === 'lo' &&
      actual.externalRoutes.length === 0 &&
      actual.exposedHostPaths.length === 0 &&
      actual.untrackedProcesses.length === 0 &&
      JSON.stringify(ports) === JSON.stringify(expectedPorts) &&
      actual.visibleUnixSockets.length === 1 &&
      actual.visibleUnixSockets[0] ===
        `/lm/socket/.s.PGSQL.${manifest.configuration.postgresPort}`,
    'Isolation mismatch or reboot; stop and preserve resources',
  );
  return { comparison: 'MATCH', physicalExecution: BLOCKED } as const;
};

const sessionSchema = z.strictObject({
  database: z.string(),
  currentUser: z.string(),
  sessionUser: z.string(),
  serverAddress: z.literal('127.0.0.1'),
  serverPort: z.number().int(),
  dataDirectory: z.literal('/lm/data'),
  systemIdentifier: identifier,
  serverVersionNum: z.number().int(),
  postmasterStartedAt: z.string(),
  backendPid: z.number().int().positive(),
  backendStart: z.string().min(1),
});

const sessionPinSchema = z.strictObject({
  backendPid: z.number().int().positive(),
  backendStart: z.string().min(1),
});

type WriterBinding = {
  runner: object;
  manager: object;
  physicalClient: object;
  transactionActive: boolean;
};

// Object identity matters: a newly constructed manager with the same properties
// must not replace the original WorkspaceEntityManager or physical pool client.
export const compareWriterContinuityCandidate = (
  pinned: WriterBinding,
  actual: WriterBinding,
  pinnedSession: unknown,
  actualSession: unknown,
) => {
  const expected = decode(sessionPinSchema, pinnedSession);
  const observed = decode(sessionPinSchema, actualSession);
  requireLeadPhysical(
    [pinned.runner, pinned.manager, pinned.physicalClient].every(
      (value) => typeof value === 'object' && value !== null,
    ) &&
      pinned.runner === actual.runner &&
      pinned.manager === actual.manager &&
      pinned.physicalClient === actual.physicalClient &&
      actual.transactionActive === true &&
      expected.backendPid === observed.backendPid &&
      expected.backendStart === observed.backendStart,
    'Writer session, client, runner or original manager changed; writes remain blocked',
  );
  return { comparison: 'MATCH', physicalExecution: BLOCKED } as const;
};

export const compareSqlIdentityCandidate = (
  input: unknown,
  observation: unknown,
  stage: 'cluster-inspection' | 'application',
) => {
  const manifest = validateManifest(input);
  const actual = decode(sessionSchema, observation);
  requireLeadPhysical(
    (stage === 'cluster-inspection' || stage === 'application') &&
      actual.database ===
        (stage === 'cluster-inspection'
          ? 'postgres'
          : manifest.configuration.database) &&
      actual.currentUser === manifest.configuration.role &&
      actual.sessionUser === manifest.configuration.role &&
      actual.serverPort === manifest.configuration.postgresPort &&
      actual.systemIdentifier === manifest.systemIdentifier &&
      actual.serverVersionNum === manifest.serverVersionNum &&
      actual.postmasterStartedAt === manifest.postmasterStartedAt,
    'SQL identity differs from independent offline manifest; writes remain blocked',
  );
  return {
    comparison: 'MATCH',
    physicalExecution: BLOCKED,
    sessionPin: {
      backendPid: actual.backendPid,
      backendStart: actual.backendStart,
    },
  } as const;
};

const cleanupSchema = z.strictObject({
  runId: uuid,
  bootId: uuid,
  systemIdentifier: identifier,
  supervisor: processIdentitySchema,
  liveProcesses: z.array(processIdentitySchema),
  openConnections: z.number().int().nonnegative(),
  unresolvedCommit: z.boolean(),
  resources: z.array(
    z.strictObject({
      path: z.string(),
      device: identifier,
      inode: identifier,
      mountId: identifier,
    }),
  ),
});

export const compareCleanupCandidate = (
  input: unknown,
  paths: unknown,
  before: unknown,
  after: unknown,
) => {
  const manifest = validateManifest(input);
  compareOwnedPaths(manifest, paths);
  const created = decode(cleanupSchema, before);
  const final = decode(cleanupSchema, after);
  // Link resource identity to both creation and fresh path observations.
  const pathRows = decode(
    z.array(
      z.object({
        path: z.string(),
        device: identifier,
        inode: identifier,
        mountId: identifier,
      }),
    ),
    paths,
  );
  const normalized = (rows: typeof final.resources) =>
    [...rows].sort((left, right) => left.path.localeCompare(right.path));
  const sameResources = (
    left: typeof final.resources,
    right: typeof final.resources,
  ) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
  const resources = pathRows.filter(
    (row) => row.path !== '/' && row.path !== '/tmp',
  );
  for (const candidate of [created, final]) {
    requireLeadPhysical(
      candidate.runId === manifest.configuration.runId &&
        candidate.bootId === manifest.configuration.bootId &&
        candidate.systemIdentifier === manifest.systemIdentifier &&
        JSON.stringify(candidate.supervisor) ===
          JSON.stringify(manifest.supervisor) &&
        !candidate.unresolvedCommit &&
        sameResources(candidate.resources, resources),
      'Cleanup ownership ambiguous; preserve resources',
    );
  }
  requireLeadPhysical(
    final.liveProcesses.length === 0 &&
      final.openConnections === 0 &&
      sameResources(created.resources, final.resources),
    'Processes/connections remain; cleanup forbidden',
  );
  return {
    comparison: 'MATCH',
    physicalExecution: BLOCKED,
    deletionAuthorized: false,
  } as const;
};
