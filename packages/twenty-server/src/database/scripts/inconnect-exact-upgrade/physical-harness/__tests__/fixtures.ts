import { createHash } from 'node:crypto';

import { type TargetContract } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

export const TEST_PASSWORD = 'synthetic-secret-used-only-in-unit-tests';
export const makeTarget = (): TargetContract => ({
  schemaVersion: 1,
  runId: '60000000-0000-4000-8000-000000000001',
  host: '127.0.0.1',
  port: 55432,
  database: 'inconnect_disposable_pg1',
  role: 'inconnect_disposable_writer',
  expected: {
    database: 'inconnect_disposable_pg1',
    host: '127.0.0.1/32',
    port: 55432,
    version: '18.6',
    dataDirectory:
      '/tmp/inconnect-pg-60000000-0000-4000-8000-000000000001/data',
    systemIdentifier: '456',
    currentUser: 'inconnect_disposable_writer',
    sessionUser: 'inconnect_disposable_writer',
    clientAddress: '127.0.0.1/32',
  },
  evidence: {
    origin: 'independent-disposable-supervisor',
    controlDataSha256: 'a'.repeat(64),
    fixtureSha256: 'b'.repeat(64),
    reviewedCommit: 'c'.repeat(40),
    credentialSha256: createHash('sha256').update(TEST_PASSWORD).digest('hex'),
    defaultSystemIdentifier: '123',
    disposableSystemIdentifier: '456',
    resourceRoot: '/tmp/inconnect-pg-60000000-0000-4000-8000-000000000001',
    postmasterPid: 1234,
    postmasterStartTicks: '12345',
    hostNamespaces: {
      network: 'net:[1]',
      mount: 'mnt:[2]',
      process: 'pid:[3]',
    },
    isolatedNamespaces: {
      network: 'net:[4]',
      mount: 'mnt:[5]',
      process: 'pid:[6]',
    },
  },
});

export const makeIsolationObservation = () => {
  const target = makeTarget();
  return {
    harnessNamespaces: { ...target.evidence.isolatedNamespaces },
    postmasterNamespaces: { ...target.evidence.isolatedNamespaces },
    postmasterPid: target.evidence.postmasterPid,
    postmasterStartTicks: target.evidence.postmasterStartTicks,
    postmasterDataDirectory: target.expected.dataDirectory,
    interfaces: ['lo'],
    routes: [],
    listeningTcpPorts: [target.port],
    visiblePostgresSockets: [],
    databaseNames: ['postgres', 'template0', 'template1', target.database],
  };
};

export const makeCleanupObservation = () => {
  const target = makeTarget();
  return {
    resourceRootRealPath: target.evidence.resourceRoot,
    dataDirectoryRealPath: target.expected.dataDirectory,
    ownershipRunId: target.runId,
    ownershipSystemIdentifier: target.expected.systemIdentifier,
    ownedBySupervisor: true,
    hasSymlinksOrMounts: false,
    postmasterStopped: true,
    testProcessesStopped: true,
    connectionsClosed: true,
    remainingWriters: 0,
  };
};
