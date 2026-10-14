import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { APPROVED_COMMANDS } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { requireExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';
import {
  makeTarget,
  TEST_PASSWORD,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/__tests__/fixtures';
import { previewPhysicalHarness } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/entrypoint';
import { createPhysicalRunner } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/real-runner';
import { runPhysicalRegisteredStep } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/registered-step';

// Loading a runtime network dependency fails this suite; preview and the real
// blocked adapters must stop before any such import, not merely avoid its use.
jest.mock('pg', () => {
  throw new Error('PG0 network dependency forbidden');
});
jest.mock('typeorm', () => {
  throw new Error('PG0 datasource dependency forbidden');
});

describe('PG0 static-only entrypoint and unreachable physical adapters', () => {
  it.each(APPROVED_COMMANDS)(
    'should preview exactly %s without services or IO',
    (command) => {
      expect(
        previewPhysicalHarness(['--preview', '--command', command]),
      ).toMatchObject({
        phase: 'PG0',
        physicalExecution: 'BLOCKED',
        command,
        databaseCalls: 0,
        redisCalls: 0,
      });
    },
  );
  it.each(
    [
      [],
      ['--preview'],
      ['--preview', '--command', '*'],
      ['--preview', '--command', '5698'],
      [
        '--preview',
        '--command',
        APPROVED_COMMANDS[0],
        '--command',
        APPROVED_COMMANDS[1],
      ],
      ['--preview', '--command', APPROVED_COMMANDS[0], '--port', '5432'],
      ['--preview', '--command', APPROVED_COMMANDS[0], '--database', 'default'],
      ['--force'],
      ['--unsafe'],
      ['--host', 'localhost'],
    ].map((arguments_) => ({ arguments_ })),
  )(
    'should reject arbitrary or multi-command requests %j',
    ({ arguments_ }) => {
      expect(() => previewPhysicalHarness(arguments_)).toThrow();
    },
  );
  it('should reject physical execution before any inspector or runner call even with valid input', async () => {
    const runner = { runFastInstanceCommand: jest.fn() };
    const inspect = jest.fn();
    await expect(
      runPhysicalRegisteredStep(
        makeTarget(),
        APPROVED_COMMANDS[0],
        runner,
        inspect,
      ),
    ).rejects.toThrow('PG0: physical execution BLOCKED');
    expect(inspect).not.toHaveBeenCalled();
    expect(runner.runFastInstanceCommand).not.toHaveBeenCalled();
    await expect(
      createPhysicalRunner(makeTarget(), TEST_PASSWORD, { NODE_ENV: 'test' }),
    ).rejects.toThrow('PG0: physical execution BLOCKED');
  });
  it('should reject execution switches and preserve the unmocked operational gate', () => {
    expect(() =>
      previewPhysicalHarness(['--execute', '--command', APPROVED_COMMANDS[0]]),
    ).toThrow('PG0: physical execution BLOCKED');
    expect(() => requireExecutionSafety()).toThrow('Execution BLOCKED');
  });
  it('should execute only static preview in a separate Node process despite hostile application dotenv/environment', () => {
    const launcher = resolve(
      __dirname,
      '../../../../../../scripts/inconnect-exact-upgrade-physical-test.cjs',
    );
    const directory = mkdtempSync(resolve(tmpdir(), 'inconnect-pg0-env-'));
    const hostileUrl =
      'postgresql://hostile:do-not-print@127.0.0.1:5432/default';
    try {
      for (const name of ['.env', '.env.test']) {
        writeFileSync(
          resolve(directory, name),
          `PG_DATABASE_URL=${hostileUrl}\nREDIS_URL=redis://hostile\n`,
        );
      }
      for (const environment of [
        { NODE_ENV: 'test' },
        { NODE_ENV: 'test', PG_DATABASE_URL: hostileUrl },
      ]) {
        const output = execFileSync(
          process.execPath,
          [launcher, '--preview', '--command', APPROVED_COMMANDS[0]],
          {
            env: environment,
            cwd: directory,
            encoding: 'utf8',
            timeout: 10000,
          },
        );
        expect(JSON.parse(output)).toMatchObject({
          physicalExecution: 'BLOCKED',
          databaseCalls: 0,
          redisCalls: 0,
        });
        expect(output).not.toContain('do-not-print');
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it('should keep fixture installation separate and fabricate no migration success history', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../fixtures/pre-5698.sql'),
      'utf8',
    );
    expect(fixture).toContain('CREATE TABLE core."upgradeMigration"');
    expect(fixture).toContain('"isInitial" boolean NOT NULL DEFAULT false');
    expect(fixture).not.toMatch(
      /INSERT INTO core\."upgradeMigration"|_typeorm_migrations|CREATE EXTENSION|autoCreateEnabled|automationUserWorkspaceId/,
    );
    expect(fixture).not.toMatch(
      /DROP DATABASE|ALTER SYSTEM|COPY |dblink|postgres_fdw/i,
    );
  });
});
