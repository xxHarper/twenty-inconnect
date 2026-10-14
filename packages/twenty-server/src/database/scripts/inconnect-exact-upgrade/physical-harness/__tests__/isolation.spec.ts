import {
  makeTarget,
  makeIsolationObservation,
  makeCleanupObservation,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/__tests__/fixtures';
import {
  planOwnedCleanup,
  requirePhysicalExecutionSafety,
  validateIsolationObservation,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/isolation';

describe('future isolation and cleanup evidence linkage (no process control)', () => {
  it('should accept only the same owned disposable postmaster and sealed namespaces', () => {
    expect(() =>
      validateIsolationObservation(makeTarget(), makeIsolationObservation()),
    ).not.toThrow();
  });
  it.each([
    { interfaces: ['lo', 'eth0'] },
    { routes: ['default via host'] },
    { listeningTcpPorts: [55432, 5432] },
    { listeningTcpPorts: [5432] },
    { visiblePostgresSockets: ['/var/run/postgresql/.s.PGSQL.5432'] },
    { postmasterPid: 9999 },
    { postmasterStartTicks: '99999' },
    { postmasterDataDirectory: '/var/lib/postgresql/18/main' },
    { databaseNames: ['postgres', 'template0', 'template1', 'default'] },
    {
      databaseNames: [
        'postgres',
        'template0',
        'template1',
        'inconnect_disposable_pg1',
        'application',
      ],
    },
    { harnessNamespaces: makeTarget().evidence.hostNamespaces },
    { postmasterNamespaces: makeTarget().evidence.hostNamespaces },
  ])('should reject loss of isolation %j', (patch) => {
    expect(() =>
      validateIsolationObservation(makeTarget(), {
        ...makeIsolationObservation(),
        ...patch,
      }),
    ).toThrow();
  });
  it('should reject shared host namespaces even with otherwise distinct database identity', () => {
    const target = makeTarget();
    target.evidence.isolatedNamespaces.network =
      target.evidence.hostNamespaces.network;
    expect(() =>
      validateIsolationObservation(target, makeIsolationObservation()),
    ).toThrow();
  });
  it('should propose only the owned test root after shutdown evidence', () => {
    expect(planOwnedCleanup(makeTarget(), makeCleanupObservation())).toBe(
      makeTarget().evidence.resourceRoot,
    );
  });
  it.each([
    { resourceRootRealPath: '/var/lib/postgresql/18/main' },
    { dataDirectoryRealPath: '/var/lib/postgresql/18/main' },
    { resourceRootRealPath: '/tmp' },
    { ownershipSystemIdentifier: '123' },
    { ownershipRunId: '60000000-0000-4000-8000-000000000002' },
    { hasSymlinksOrMounts: true },
    { ownedBySupervisor: false },
    { postmasterStopped: false },
    { testProcessesStopped: false },
    { connectionsClosed: false },
    { remainingWriters: 1 },
  ])(
    'should preserve resources when cleanup ownership is uncertain %j',
    (patch) => {
      expect(() =>
        planOwnedCleanup(makeTarget(), {
          ...makeCleanupObservation(),
          ...patch,
        }),
      ).toThrow();
    },
  );
  it('should remain blocked even when structural isolation evidence is complete', () => {
    validateIsolationObservation(makeTarget(), makeIsolationObservation());
    expect(() => requirePhysicalExecutionSafety()).toThrow(
      'PG0: physical execution BLOCKED',
    );
  });
});
