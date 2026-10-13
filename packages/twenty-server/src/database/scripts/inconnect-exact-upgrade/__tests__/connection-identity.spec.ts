import {
  requireExtensions,
  verifySessionIdentity,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { EXPECTED_DATA_DIRECTORY } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import {
  validateDisposableContract,
  verifyDisposableSession,
} from 'src/database/scripts/inconnect-exact-upgrade/test-only-contract';

const expected = {
  database: 'default',
  host: '127.0.0.1/32',
  port: 5432,
  version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
  dataDirectory: EXPECTED_DATA_DIRECTORY,
  systemIdentifier: '123',
  currentUser: 'operator',
  sessionUser: 'operator',
  clientAddress: '127.0.0.1/32' as const,
};
const session = {
  ...expected,
  backendPid: 1234,
  backendStart: '2026-10-13 00:00:00+00',
};
const disposable = {
  connectionUrl:
    'postgresql://tester:secret@127.0.0.1:55432/inconnect_disposable_proof',
  localSystemIdentifier: '123',
  expected: {
    ...expected,
    port: 55432,
    database: 'inconnect_disposable_proof',
    dataDirectory: '/tmp/isolated-cluster',
    systemIdentifier: '456',
    currentUser: 'tester',
    sessionUser: 'tester',
  },
};

describe('session identity primitive; future writer hook remains blocked', () => {
  it.each([
    { host: '10.0.0.1/32' },
    { port: 5433 },
    { database: 'other' },
    { version: '18.7' },
    { dataDirectory: '/other' },
    { systemIdentifier: '999' },
    { currentUser: 'postgres' },
    { sessionUser: 'postgres' },
    { clientAddress: '10.0.0.2/32' },
  ])('should reject actual connected session mismatch %j', (change) => {
    expect(() =>
      verifySessionIdentity({ ...session, ...change }, expected),
    ).toThrow();
  });

  it('should verify each independent failure-tracking session against the full target and role', () => {
    const execution = verifySessionIdentity(session, expected);
    expect(
      verifySessionIdentity({ ...session, backendPid: 1235 }, expected)
        .backendPid,
    ).toBe(1235);
    expect(() =>
      verifySessionIdentity(
        { ...session, backendPid: 1235, currentUser: 'unexpected' },
        expected,
      ),
    ).toThrow('identity mismatch');
    expect(execution.backendPid).toBe(1234);
  });

  it.each([{ backendPid: 1235 }, { backendStart: '2026-10-13 00:01:00+00' }])(
    'should reject replacement/reconnect after retaining the original identity %j',
    (change) => {
      const retained = verifySessionIdentity(session, expected);
      expect(() =>
        verifySessionIdentity({ ...session, ...change }, expected, retained),
      ).toThrow('replacement/reconnect');
    },
  );

  it('should require extensions by SELECT catalog evidence without repairing absence', () => {
    expect(() => requireExtensions([], ['uuid-ossp'])).toThrow(
      'automatic installation is forbidden',
    );
    expect(requireExtensions([{ name: 'uuid-ossp' }], ['uuid-ossp'])).toEqual([
      'uuid-ossp',
    ]);
  });

  it('should validate a distinct disposable contract and its independently observed session', () => {
    expect(() =>
      verifyDisposableSession(disposable, {
        ...disposable.expected,
        backendPid: 5678,
        backendStart: session.backendStart,
      }),
    ).not.toThrow();
    expect(() => verifyDisposableSession(disposable, session)).toThrow();
  });

  it.each([
    { connectionUrl: 'postgresql://tester:secret@127.0.0.1:5432/default' },
    {
      connectionUrl:
        'postgresql://tester:secret@remote:55432/inconnect_disposable_proof',
    },
    {
      expected: {
        ...disposable.expected,
        dataDirectory: EXPECTED_DATA_DIRECTORY,
      },
    },
    { expected: { ...disposable.expected, systemIdentifier: '123' } },
  ])(
    'should prevent a test contract from reaching local default or another cluster %j',
    (change) => {
      expect(() =>
        validateDisposableContract({ ...disposable, ...change }),
      ).toThrow();
    },
  );
});
