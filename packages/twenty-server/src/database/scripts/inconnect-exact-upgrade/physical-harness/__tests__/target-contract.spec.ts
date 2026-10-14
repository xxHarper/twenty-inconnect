import { createSessionConnectionVerification } from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { type QueryRunner } from 'typeorm';

import {
  makeTarget,
  TEST_PASSWORD,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/__tests__/fixtures';
import {
  isolatedChildEnvironment,
  validateDisposableCredential,
  validateHarnessEnvironment,
  validateTargetContract,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

describe('independent disposable target guards (no network)', () => {
  it('should accept structurally linked evidence without granting execution authority', () => {
    expect(validateTargetContract(makeTarget())).toEqual(makeTarget());
    expect(validateDisposableCredential(makeTarget(), TEST_PASSWORD)).toEqual(
      makeTarget(),
    );
  });

  it.each([
    ['database', 'default'],
    ['port', 5432],
    ['host', 'localhost'],
    ['host', '/var/run/postgresql'],
    ['host', 'staging.example'],
    ['role', 'postgres'],
  ])('should reject forbidden %s %s', (key, value) => {
    expect(() =>
      validateTargetContract({ ...makeTarget(), [key]: value }),
    ).toThrow();
  });

  it.each([
    ['dataDirectory', '/var/lib/postgresql/18/main'],
    [
      'dataDirectory',
      '/tmp/inconnect-pg-60000000-0000-4000-8000-000000000001/../data',
    ],
    ['database', 'default'],
    ['port', 5432],
    ['systemIdentifier', '123'],
    ['currentUser', 'postgres'],
    ['sessionUser', 'other_role'],
  ])('should reject expected identity drift in %s', (key, value) => {
    const target = makeTarget();
    expect(() =>
      validateTargetContract({
        ...target,
        expected: { ...target.expected, [key]: value },
      }),
    ).toThrow();
  });

  it('should reject a copied default cluster even with a new name, port and directory', () => {
    const target = makeTarget();
    target.expected.systemIdentifier = '123';
    target.evidence.disposableSystemIdentifier = '123';
    expect(() => validateTargetContract(target)).toThrow(
      'independently isolated',
    );
  });

  it.each([undefined, {}, { origin: 'observed-from-tested-session' }])(
    'should reject missing independent evidence',
    (evidence) => {
      expect(() =>
        validateTargetContract({ ...makeTarget(), evidence }),
      ).toThrow('independent');
    },
  );

  it('should reject unexpected credentials without printing the supplied secret', () => {
    const password = 'unexpected-secret-must-not-appear-in-an-error';
    try {
      validateDisposableCredential(makeTarget(), password);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(String(error)).toContain('Unexpected disposable credential');
      expect(String(error)).not.toContain(password);
    }
  });

  it.each([
    'PG_DATABASE_URL',
    'PG_DATABASE_REPLICA_URL',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGSERVICE',
    'PGOPTIONS',
    'PGSSLMODE',
    'PG_POOL_MAX_CONNECTIONS',
    'REDIS_URL',
    'DATABASE_URL',
    'DOTENV_CONFIG_PATH',
    'TS_NODE_PROJECT',
    'NODE_OPTIONS',
    'NODE_PATH',
    'INCONNECT_F13C_POSTGRES_URL',
  ])('should reject inherited %s including explicit empty values', (key) => {
    for (const value of ['hostile-default-target', '']) {
      expect(() =>
        validateHarnessEnvironment({ NODE_ENV: 'test', [key]: value }),
      ).toThrow();
    }
  });

  it.each([undefined, 'development', 'production', 'staging'])(
    'should reject NODE_ENV %s',
    (NODE_ENV) => {
      expect(() => validateHarnessEnvironment({ NODE_ENV })).toThrow();
    },
  );

  it('should build an environment without inheriting host variables or dotenv fallback', () => {
    expect(isolatedChildEnvironment()).toEqual({
      NODE_ENV: 'test',
      LANG: 'C',
      LC_ALL: 'C',
    });
    expect(Object.isFrozen(isolatedChildEnvironment())).toBe(true);
    expect(() =>
      validateHarnessEnvironment({ NODE_ENV: 'test' }),
    ).not.toThrow();
  });

  it.each([
    'database',
    'host',
    'port',
    'version',
    'dataDirectory',
    'systemIdentifier',
    'currentUser',
    'sessionUser',
    'clientAddress',
  ])(
    'should reject every actual writer identity mismatch in %s',
    async (key) => {
      const target = makeTarget();
      const row = {
        ...target.expected,
        backendPid: 100,
        backendStart: '2026-10-14 00:00:00+00',
        [key]: key === 'port' ? 5432 : 'mismatch',
      };
      const queryRunner = {
        query: jest.fn().mockResolvedValue([row]),
      } as unknown as QueryRunner;
      await expect(
        createSessionConnectionVerification(target.expected).verifyConnection(
          queryRunner,
        ),
      ).rejects.toThrow();
    },
  );

  it('should pin each writer separately and reject backend replacement', async () => {
    const target = makeTarget();
    const verification = createSessionConnectionVerification(target.expected);
    const row = {
      ...target.expected,
      backendPid: 100,
      backendStart: 'first-start',
    };
    const query = jest.fn().mockResolvedValue([row]);
    const first = { query } as unknown as QueryRunner;
    await verification.verifyConnection(first);
    await verification.verifyConnection({
      query: jest.fn().mockResolvedValue([{ ...row, backendPid: 101 }]),
    } as unknown as QueryRunner);
    query.mockResolvedValue([{ ...row, backendPid: 101 }]);
    await expect(verification.verifyConnection(first)).rejects.toThrow(
      'replacement',
    );
  });
});
