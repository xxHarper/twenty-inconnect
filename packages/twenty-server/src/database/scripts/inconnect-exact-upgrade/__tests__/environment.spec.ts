import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArguments } from 'src/database/scripts/inconnect-exact-upgrade/cli';
import {
  configuredConnection,
  resolveEnvironment,
  validatePostgresEnvironment,
} from 'src/database/scripts/inconnect-exact-upgrade/environment';
import { APPROVED_COMMANDS } from 'src/database/scripts/inconnect-exact-upgrade/guards';

const local = 'postgresql://operator:secret@localhost:5432/default';

describe('explicit PostgreSQL environment contract', () => {
  it('should select dotenv fallback by NODE_ENV and retain process precedence including explicit emptiness', () => {
    const directory = mkdtempSync(join(tmpdir(), 'inconnect-env-'));
    try {
      writeFileSync(join(directory, '.env'), `PG_DATABASE_URL=${local}\n`);
      writeFileSync(
        join(directory, '.env.test'),
        'PG_DATABASE_URL=postgresql://tester:secret@localhost:55432/disposable\n',
      );
      expect(resolveEnvironment(directory, {}).PG_DATABASE_URL).toBe(local);
      expect(
        resolveEnvironment(directory, { NODE_ENV: 'test' }).PG_DATABASE_URL,
      ).toContain('55432');
      expect(
        resolveEnvironment(directory, {
          NODE_ENV: 'test',
          PG_DATABASE_URL: local,
        }).PG_DATABASE_URL,
      ).toBe(local);
      expect(() =>
        validatePostgresEnvironment(
          resolveEnvironment(directory, { PG_DATABASE_URL: '' }),
        ),
      ).toThrow();
      expect(() =>
        validatePostgresEnvironment(
          resolveEnvironment(directory, { NODE_ENV: 'test' }),
        ),
      ).toThrow('Only explicit');
      expect(() =>
        resolveEnvironment(directory, { NODE_ENV: 'production' }),
      ).toThrow('NODE_ENV');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGPORT',
    'PGHOST',
    'PGOPTIONS',
    'PGSSLMODE',
    'PGSERVICE',
  ])('should reject ambient %s before creating any connection', (key) => {
    expect(() =>
      validatePostgresEnvironment({
        PG_DATABASE_URL: local,
        [key]: 'unexpected',
      }),
    ).toThrow('overrides');
  });

  it.each([
    'postgresql://localhost:5432/default',
    'postgresql://operator@localhost:5432/default',
    'postgresql://operator:secret@localhost:5432/default?options=-c%20role=postgres',
  ])('should reject credential fallback or connection overrides', (url) => {
    expect(() => configuredConnection(url)).toThrow();
  });

  it('should pin explicit pg parameters and disallow any operational target option', () => {
    expect(configuredConnection(local)).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'default',
      user: 'operator',
      password: 'secret',
      ssl: false,
    });
    expect(() =>
      parseArguments([
        '--command',
        APPROVED_COMMANDS[0],
        '--expected-commit',
        'a'.repeat(40),
        '--target',
        'disposable',
      ]),
    ).toThrow();
  });
});
