// Factories throw only if the isolated tooling tries to load these dependencies.
jest.mock('node:child_process', () => {
  throw new Error('Process control forbidden');
});
jest.mock('node:fs', () => {
  throw new Error('Filesystem access forbidden');
});
jest.mock('node:net', () => {
  throw new Error('Network access forbidden');
});
jest.mock('node:tls', () => {
  throw new Error('Network access forbidden');
});
jest.mock('node:dgram', () => {
  throw new Error('Network access forbidden');
});
jest.mock('pg', () => {
  throw new Error('PostgreSQL forbidden');
});
jest.mock('ioredis', () => {
  throw new Error('Redis forbidden');
});
jest.mock('typeorm', () => {
  throw new Error('Database infrastructure forbidden');
});

describe('inert lifecycle tooling import boundary', () => {
  it('should import every implementation module without process, filesystem or network dependencies', () => {
    const before = { ...process.env };

    jest.isolateModules(() => {
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types');
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/ownership');
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/readiness');
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/finalization');
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry');
      require('src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/evidence');
    });
    expect(process.env).toEqual(before);
  });
});
