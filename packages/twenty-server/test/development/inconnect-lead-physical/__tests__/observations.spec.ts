import {
  compareCleanupCandidate,
  compareIsolationCandidate,
  compareSqlIdentityCandidate,
  compareWriterContinuityCandidate,
} from 'test/development/inconnect-lead-physical/observations';
import {
  cleanup,
  isolation,
  manifest,
  paths,
  session,
} from 'test/development/inconnect-lead-physical/__tests__/fixtures';

describe('PHYS-P1 observations never authorize execution', () => {
  it('rejects replaced clients/runners/managers and backend PID/start reuse', () => {
    const pinned = {
      runner: {},
      manager: {},
      physicalClient: {},
      transactionActive: true,
    };
    const sessionPin = {
      backendPid: 5,
      backendStart: '2026-10-27T18:00:01.123456Z',
    };
    expect(
      compareWriterContinuityCandidate(pinned, pinned, sessionPin, sessionPin)
        .physicalExecution,
    ).toBe('BLOCKED');
    for (const override of [
      { runner: {} },
      { manager: {} },
      { physicalClient: {} },
      { transactionActive: false },
    ]) {
      expect(() =>
        compareWriterContinuityCandidate(
          pinned,
          { ...pinned, ...override },
          sessionPin,
          sessionPin,
        ),
      ).toThrow();
    }
    for (const override of [
      { backendPid: 6 },
      { backendStart: '2026-10-27T18:00:01.123Z' },
    ]) {
      expect(() =>
        compareWriterContinuityCandidate(pinned, pinned, sessionPin, {
          ...sessionPin,
          ...override,
        }),
      ).toThrow();
    }
  });
  it.each([undefined, {}, { approved: true }])(
    'rejects absent/partial isolation %#',
    (observation) => {
      expect(() =>
        compareIsolationCandidate(manifest(), observation),
      ).toThrow();
    },
  );

  it.each([
    { bootId: '30000000-0000-4000-8000-000000000001' },
    { isolatedNamespaces: manifest().hostNamespaces },
    { postmasterNamespaces: manifest().hostNamespaces },
    { redisNamespaces: manifest().hostNamespaces },
    { interfaces: ['lo', 'eth0'] },
    { externalRoutes: ['default via host'] },
    {
      tcpListeners: [
        ...isolation().tcpListeners,
        { address: '127.0.0.1', port: 5432 },
      ],
    },
    {
      visibleUnixSockets: [
        ...isolation().visibleUnixSockets,
        '/var/run/postgresql/.s.PGSQL.5432',
      ],
    },
    { exposedHostPaths: ['/home/alberto/.pgpass'] },
    { untrackedProcesses: [999] },
    { postmaster: { ...manifest().postmaster, startTicks: '999' } },
    { redis: { ...manifest().redis, executableSha256: 'e'.repeat(64) } },
  ])('rejects reboot, leaks or replaced processes %#', (override) => {
    expect(() =>
      compareIsolationCandidate(manifest(), { ...isolation(), ...override }),
    ).toThrow();
  });

  it('keeps a fully consistent but untrusted observation blocked', () => {
    expect(compareIsolationCandidate(manifest(), isolation())).toEqual({
      comparison: 'MATCH',
      physicalExecution: 'BLOCKED',
    });
  });

  it('admits a cluster-only candidate without requiring a Redis startup for A0', () => {
    const { redis: _redisManifest, ...cluster } = manifest();
    const {
      redis: _redisObservation,
      redisNamespaces: _redisNamespaces,
      ...actual
    } = isolation();
    actual.tcpListeners = actual.tcpListeners.slice(0, 1);
    expect(compareIsolationCandidate(cluster, actual).physicalExecution).toBe(
      'BLOCKED',
    );
    expect(() => compareIsolationCandidate(cluster, isolation())).toThrow();
  });

  it.each([
    { database: 'default' },
    { currentUser: 'postgres' },
    { sessionUser: 'postgres' },
    { serverPort: 5432 },
    { serverAddress: '::1' },
    { dataDirectory: '/var/lib/postgresql/18/main' },
    { systemIdentifier: manifest().excludedSystemIdentifier },
    { serverVersionNum: 180005 },
    { postmasterStartedAt: '2026-10-27T18:00:00.123Z' },
    { systemIdentifier: Number(manifest().systemIdentifier) },
    { backendPid: undefined },
  ])('rejects SQL target drift and precision loss %#', (override) => {
    expect(() =>
      compareSqlIdentityCandidate(
        manifest(),
        { ...session(), ...override },
        'application',
      ),
    ).toThrow();
  });

  it('separates initial cluster inspection from the application database', () => {
    expect(
      compareSqlIdentityCandidate(manifest(), session(), 'application')
        .physicalExecution,
    ).toBe('BLOCKED');
    expect(() =>
      compareSqlIdentityCandidate(manifest(), session(), 'cluster-inspection'),
    ).toThrow();
    expect(
      compareSqlIdentityCandidate(
        manifest(),
        { ...session(), database: 'postgres' },
        'cluster-inspection',
      ).physicalExecution,
    ).toBe('BLOCKED');
  });

  it.each([
    { runId: '30000000-0000-4000-8000-000000000001' },
    { bootId: '30000000-0000-4000-8000-000000000001' },
    { systemIdentifier: manifest().excludedSystemIdentifier },
    { supervisor: { ...manifest().supervisor, startTicks: '999' } },
    { liveProcesses: [manifest().postmaster] },
    { openConnections: 1 },
    { unresolvedCommit: true },
    { resources: [] },
    {
      resources: [
        { ...cleanup().resources[0], path: '/tmp/foreign' },
        ...cleanup().resources.slice(1),
      ],
    },
    {
      resources: [
        { ...cleanup().resources[0], inode: '999' },
        ...cleanup().resources.slice(1),
      ],
    },
  ])(
    'forbids cleanup without current exclusive ownership/quiescence %#',
    (override) => {
      expect(() =>
        compareCleanupCandidate(manifest(), paths(), cleanup(), {
          ...cleanup(),
          ...override,
        }),
      ).toThrow();
    },
  );

  it('rejects forged creation inventory, missing path evidence and duplicate resources', () => {
    expect(() =>
      compareCleanupCandidate(manifest(), [], cleanup(), cleanup()),
    ).toThrow();
    expect(() =>
      compareCleanupCandidate(
        manifest(),
        paths(),
        { ...cleanup(), resources: [] },
        cleanup(),
      ),
    ).toThrow();
    expect(() =>
      compareCleanupCandidate(manifest(), paths(), cleanup(), {
        ...cleanup(),
        resources: [...cleanup().resources, cleanup().resources[0]],
      }),
    ).toThrow();
  });

  it('never returns deletion permission even when candidate identities match', () => {
    expect(
      compareCleanupCandidate(manifest(), paths(), cleanup(), cleanup()),
    ).toEqual({
      comparison: 'MATCH',
      physicalExecution: 'BLOCKED',
      deletionAuthorized: false,
    });
  });
});
