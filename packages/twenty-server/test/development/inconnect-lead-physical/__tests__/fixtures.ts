import { createHash } from 'node:crypto';

import {
  type LeadPhysicalConfiguration,
  type LeadPhysicalManifest,
  ownedPaths,
} from 'test/development/inconnect-lead-physical/contracts';
import { buildApplicationEnvironmentCandidate } from 'test/development/inconnect-lead-physical/environment';

export const configuration = (): LeadPhysicalConfiguration => ({
  runId: '10000000-0000-4000-8000-000000000001',
  bootId: '20000000-0000-4000-8000-000000000001',
  reviewedCommit: 'c67d3bd4ddb6d8c417b97ec57bc06cd3df619d54',
  resourceRoot: '/tmp/inconnect-lead-phys-10000000-0000-4000-8000-000000000001',
  database: 'inconnect_lm_10000000000040008000000000000001',
  role: 'lm_10000000000040008000000000000001',
  postgresPort: 55439,
  redisPort: 56379,
  memoryMiB: 1024,
  processLimit: 32,
  deadlineSeconds: 120,
});

// Deterministic synthetic credentials only; never used with a real service.
export const credentials = () => ({
  postgres: 'p'.repeat(40),
  redis: 'r'.repeat(40),
});

export const manifest = () =>
  ({
    schemaVersion: 1,
    origin: 'independent-supervisor-offline-control',
    configuration: configuration(),
    hostNamespaces: {
      user: 'user:[1]',
      network: 'net:[2]',
      mount: 'mnt:[3]',
      process: 'pid:[4]',
    },
    isolatedNamespaces: {
      user: 'user:[11]',
      network: 'net:[12]',
      mount: 'mnt:[13]',
      process: 'pid:[14]',
    },
    ownerUid: 1000,
    supervisor: {
      pid: 100,
      startTicks: '100',
      executable: '/usr/bin/bwrap',
      executableSha256: 'a'.repeat(64),
    },
    postmaster: {
      pid: 101,
      startTicks: '101',
      executable: '/usr/lib/postgresql/18/bin/postgres',
      executableSha256: 'b'.repeat(64),
    },
    redis: {
      pid: 102,
      startTicks: '102',
      executable: '/usr/bin/redis-server',
      executableSha256: 'c'.repeat(64),
    },
    systemIdentifier: '7000000000000000001',
    excludedSystemIdentifier: '7000000000000000002',
    controlDataSha256: 'd'.repeat(64),
    postgresCredentialSha256: createHash('sha256')
      .update(credentials().postgres)
      .digest('hex'),
    redisCredentialSha256: createHash('sha256')
      .update(credentials().redis)
      .digest('hex'),
    postmasterStartedAt: '2026-10-27T18:00:00.123456Z',
    serverVersionNum: 180006,
  }) satisfies LeadPhysicalManifest;

export const paths = () =>
  ['/', '/tmp', ...ownedPaths(configuration())].map((path, index) => ({
    path,
    realPath: path,
    kind: 'directory',
    uid: path === '/' || path === '/tmp' ? 0 : 1000,
    device: '1',
    inode: String(index + 1),
    mountId: '1',
  }));

export const isolation = () => {
  const expected = manifest();
  return {
    bootId: expected.configuration.bootId,
    runId: expected.configuration.runId,
    hostNamespaces: expected.hostNamespaces,
    isolatedNamespaces: expected.isolatedNamespaces,
    postmasterNamespaces: expected.isolatedNamespaces,
    redisNamespaces: expected.isolatedNamespaces,
    supervisor: expected.supervisor,
    postmaster: expected.postmaster,
    redis: expected.redis,
    interfaces: ['lo'],
    externalRoutes: [] as string[],
    tcpListeners: [
      { address: '127.0.0.1', port: configuration().postgresPort },
      { address: '127.0.0.1', port: configuration().redisPort },
    ],
    visibleUnixSockets: [`/lm/socket/.s.PGSQL.${configuration().postgresPort}`],
    exposedHostPaths: [] as string[],
    untrackedProcesses: [] as number[],
  };
};

export const session = () => ({
  database: configuration().database,
  currentUser: configuration().role,
  sessionUser: configuration().role,
  serverAddress: '127.0.0.1',
  serverPort: configuration().postgresPort,
  dataDirectory: '/lm/data',
  systemIdentifier: manifest().systemIdentifier,
  serverVersionNum: manifest().serverVersionNum,
  postmasterStartedAt: manifest().postmasterStartedAt,
  backendPid: 5,
  backendStart: '2026-10-27T18:00:01.123456Z',
});

export const cleanup = () => ({
  runId: configuration().runId,
  bootId: configuration().bootId,
  systemIdentifier: manifest().systemIdentifier,
  supervisor: manifest().supervisor,
  liveProcesses: [],
  openConnections: 0,
  unresolvedCommit: false,
  resources: paths()
    .slice(2)
    .map(({ path, device, inode, mountId }) => ({
      path,
      device,
      inode,
      mountId,
    })),
});

export const effective = () => {
  const environment = buildApplicationEnvironmentCandidate(
    configuration(),
    credentials(),
  );
  const source = {
    url: environment.PG_DATABASE_URL,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    installExtensions: false,
  };
  return {
    core: { ...source },
    raw: { ...source },
    workspace: { ...source },
    workspaceReplica: { ...source },
    redisUrl: environment.REDIS_URL,
    redisQueueUrl: environment.REDIS_QUEUE_URL,
    dotenvVisible: false,
    configSource: 'explicit-environment',
    jobsExplorerRegistered: false,
    workersRegistered: false,
  };
};
