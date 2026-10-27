import {
  compareOwnedPaths,
  validateConfiguration,
  validateManifest,
} from 'test/development/inconnect-lead-physical/contracts';
import {
  buildApplicationEnvironmentCandidate,
  compareEffectiveConfiguration,
  rejectInheritedEnvironment,
} from 'test/development/inconnect-lead-physical/environment';
import {
  buildServiceCandidates,
  buildSupervisorCandidate,
  inspectLauncherRequest,
  requirePhysicalExecution,
} from 'test/development/inconnect-lead-physical/launcher';
import {
  configuration,
  credentials,
  effective,
  manifest,
  paths,
} from 'test/development/inconnect-lead-physical/__tests__/fixtures';

describe('PHYS-P1 configuration boundary', () => {
  it.each([
    {},
    { ...configuration(), runId: undefined },
    { ...configuration(), force: true },
    { ...configuration(), memoryMiB: 8192 },
    { ...configuration(), deadlineSeconds: 0 },
  ])('rejects incomplete/expanded or unbounded configuration %#', (input) => {
    expect(() => validateConfiguration(input)).toThrow();
  });

  it.each([
    '/tmp/other',
    '/var/lib/postgresql/18/main',
    `${configuration().resourceRoot}/../other`,
    `${configuration().resourceRoot}/`,
    `${configuration().resourceRoot}//`,
  ])('rejects non-exclusive roots %#', (resourceRoot) => {
    expect(() =>
      validateConfiguration({ ...configuration(), resourceRoot }),
    ).toThrow();
  });

  it.each([
    { database: 'default' },
    { role: 'postgres' },
    { postgresPort: 5432 },
    { redisPort: 6379 },
    { redisPort: configuration().postgresPort },
  ])('rejects normal identities or overlapping ports %#', (override) => {
    expect(() =>
      validateConfiguration({ ...configuration(), ...override }),
    ).toThrow();
  });

  it.each([
    'PG_DATABASE_URL',
    'PG_DATABASE_REPLICA_URL',
    'REDIS_URL',
    'REDIS_QUEUE_URL',
    'PGHOST',
    'PGSERVICEFILE',
    'PGPASSFILE',
    'DATABASE_URL',
    'NODE_OPTIONS',
    'NODE_PATH',
    'DOTENV_CONFIG_PATH',
    'PATH',
    'HOME',
    'INCONNECT_EXECUTE',
    'FORCE',
  ])('rejects inherited %s even when empty', (key) => {
    expect(() => rejectInheritedEnvironment({ [key]: '' })).toThrow();
  });

  it('constructs a fresh environment, explicit replica and queue URLs', () => {
    const environment = buildApplicationEnvironmentCandidate(
      configuration(),
      credentials(),
    );
    expect(
      environment.PG_DATABASE_URL === environment.PG_DATABASE_REPLICA_URL,
    ).toBe(true);
    expect(environment.REDIS_URL === environment.REDIS_QUEUE_URL).toBe(true);
    expect(Object.keys(environment)).not.toContain('NODE_OPTIONS');
    expect(environment.HOME).toBe('/lm/home');
    expect(() =>
      rejectInheritedEnvironment({ NODE_ENV: 'test', LANG: 'C', LC_ALL: 'C' }),
    ).not.toThrow();
  });

  it.each(['core', 'raw', 'workspace', 'workspaceReplica'] as const)(
    'rejects a fallback in %s without echoing credentials',
    (source) => {
      const actual = effective();
      actual[source].url =
        'postgresql://secret:do-not-echo@127.0.0.1:5432/default';
      expect(() =>
        compareEffectiveConfiguration(manifest(), credentials(), actual),
      ).toThrow('Effective connection mismatch');
    },
  );

  it.each(['redisUrl', 'redisQueueUrl'] as const)(
    'rejects fallback in %s',
    (source) => {
      const actual = effective();
      actual[source] = 'redis://127.0.0.1:6379/0';
      expect(() =>
        compareEffectiveConfiguration(manifest(), credentials(), actual),
      ).toThrow();
    },
  );

  it.each([
    { dotenvVisible: true },
    { workspaceReplica: undefined },
    { workersRegistered: true },
    { jobsExplorerRegistered: true },
    { core: { ...effective().core, installExtensions: true } },
    { raw: { ...effective().raw, replication: {} } },
  ])('rejects hidden bootstrap behavior %#', (override) => {
    expect(() =>
      compareEffectiveConfiguration(manifest(), credentials(), {
        ...effective(),
        ...override,
      }),
    ).toThrow();
  });

  it('compares independently pinned credentials and rejects malformed secrets safely', () => {
    expect(() =>
      compareEffectiveConfiguration(manifest(), credentials(), effective()),
    ).not.toThrow();
    expect(() =>
      compareEffectiveConfiguration(
        manifest(),
        { ...credentials(), redis: 'x'.repeat(40) },
        effective(),
      ),
    ).toThrow();
    expect(() =>
      buildApplicationEnvironmentCandidate(configuration(), {
        ...credentials(),
        postgres: 'secret\n',
      }),
    ).toThrow('Invalid PHYS-P1 contract');
  });

  it('rejects a shared cluster, namespace, pid or unknown manifest authority', () => {
    const expected = manifest();
    for (const override of [
      { systemIdentifier: expected.excludedSystemIdentifier },
      {
        isolatedNamespaces: {
          ...expected.isolatedNamespaces,
          user: expected.hostNamespaces.user,
        },
      },
      { redis: { ...expected.redis, pid: expected.postmaster.pid } },
      { origin: 'sql-observed' },
      { approved: true },
    ])
      expect(() => validateManifest({ ...expected, ...override })).toThrow();
  });

  it('requires complete canonical path observations and rejects symlinks/foreign mounts/aliases', () => {
    expect(() => compareOwnedPaths(manifest(), paths())).not.toThrow();
    expect(() => compareOwnedPaths(manifest(), paths().slice(1))).toThrow();
    for (const override of [
      { kind: 'symlink' },
      { realPath: '/var/lib/postgresql/18/main' },
      { uid: 0 },
      { mountId: '99' },
      { inode: '1' },
      { path: `${configuration().resourceRoot}/../data` },
    ]) {
      const actual = paths();
      Object.assign(actual[3], override);
      expect(() => compareOwnedPaths(manifest(), actual)).toThrow();
    }
  });

  it('builds argument arrays without shell expansion or secrets and keeps all gates closed', () => {
    const plan = buildSupervisorCandidate(configuration(), {});
    expect(plan.shell).toBe(false);
    expect(plan.arguments).toContain('--unshare-user');
    expect(plan.arguments).toContain('--unshare-net');
    expect(plan.arguments).toContain('--unshare-pid');
    expect(plan.arguments).toContain('--die-with-parent');
    expect(plan.arguments.slice(-2)).toEqual(['--', '/usr/bin/true']);
    expect(plan.arguments).not.toContain('--share-net');
    expect(plan.limitsEnforced).toBe(false);
    expect(buildServiceCandidates(configuration()).physicalExecution).toBe(
      'BLOCKED',
    );
    expect(
      JSON.stringify(buildServiceCandidates(configuration())).includes(
        credentials().postgres,
      ),
    ).toBe(false);
    expect(inspectLauncherRequest(['--describe']).physicalExecution).toBe(
      'BLOCKED',
    );
    for (const arguments_ of [[], ['--execute'], ['--describe', '--force']])
      expect(() => inspectLauncherRequest(arguments_)).toThrow('BLOCKED');
    expect(() => requirePhysicalExecution()).toThrow('BLOCKED');
    expect(() =>
      buildSupervisorCandidate(
        { ...configuration(), resourceRoot: '/tmp/$(touch injected)' },
        {},
      ),
    ).toThrow();
  });
});
