import { type QueryRunner } from 'typeorm';

import { INCONNECT_VOICE_HISTORY_UP } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1795521600000-create-inconnect-voice-history';
import { installVoiceHistoryOnRunner } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  readVoiceSchemaState,
  verifyInstalledVoiceSchema,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  VOICE_HISTORY_FOLLOWING_SLOW_NAME,
  VOICE_HISTORY_UPGRADE_NAME,
} from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

jest.mock('src/database/scripts/inconnect-voice-v12/voice-v12-schema', () => ({
  ...jest.requireActual(
    'src/database/scripts/inconnect-voice-v12/voice-v12-schema',
  ),
  readVoiceSchemaState: jest.fn(),
  verifyInstalledVoiceSchema: jest.fn(),
  verifyVoiceDependencies: jest.fn(),
}));

const memberWorkspace = '00000000-0000-4000-8000-000000000009';
const pid = 541;
const tracking = (name = VOICE_HISTORY_UPGRADE_NAME) =>
  [null, memberWorkspace].map((workspaceId) => ({
    name,
    status: 'completed',
    attempt: 1,
    executedByVersion: '2.32.0',
    workspaceId,
    errorMessage: null,
    isInitial:
      name === VOICE_HISTORY_FOLLOWING_SLOW_NAME && workspaceId !== null,
  }));

const scenario = ({
  held = false,
  already = false,
  drift = false,
  failTracking = false,
  wrongBackend = false,
  failCommit = false,
  failBackup = false,
}: {
  held?: boolean;
  already?: boolean;
  drift?: boolean;
  failTracking?: boolean;
  wrongBackend?: boolean;
  failCommit?: boolean;
  failBackup?: boolean;
} = {}) => {
  const events: string[] = [];
  const backup = jest.fn(async () => {
    events.push('backup');
    if (failBackup) throw new Error('Backup validation failed');
  });
  let recorded = already;
  let active = false;
  const runner = {
    get isTransactionActive() {
      return active;
    },
    startTransaction: jest.fn(async () => {
      active = true;
      events.push('begin');
    }),
    commitTransaction: jest.fn(async () => {
      if (failCommit) throw new Error('Connection lost during COMMIT');
      active = false;
      events.push('commit');
    }),
    rollbackTransaction: jest.fn(async () => {
      active = false;
      events.push('rollback');
    }),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_control_system'))
        return [{ matches: !wrongBackend, pid }];
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ owned: !held }];
      if (sql.startsWith('LOCK TABLE')) events.push('lock');
      if (sql.includes('SELECT id FROM core.workspace'))
        return [{ id: memberWorkspace }];
      if (sql.startsWith('WITH candidates AS')) {
        return tracking(
          drift && recorded
            ? VOICE_HISTORY_UPGRADE_NAME
            : VOICE_HISTORY_FOLLOWING_SLOW_NAME,
        );
      }
      if (sql.includes('WHERE name = $1 OR name LIKE'))
        return recorded ? tracking() : [];
      if (sql.includes('pg_export_snapshot'))
        return [{ snapshot: '00000001-00000003-1' }];
      if (INCONNECT_VOICE_HISTORY_UP.some((ddl) => sql === ddl))
        events.push('ddl');
      if (sql.startsWith('INSERT INTO core."upgradeMigration"')) {
        expect(active).toBe(true);
        expect(JSON.parse(String(params?.[0]))).toEqual(
          tracking().map(({ isInitial: _isInitial, ...row }) => row),
        );
        if (failTracking) throw new Error('Tracking rejected');
        recorded = true;
        events.push('tracking');
      }
      return [];
    }),
  };
  jest
    .mocked(readVoiceSchemaState)
    .mockResolvedValue(already ? 'present' : 'absent');
  jest.mocked(verifyInstalledVoiceSchema).mockResolvedValue(undefined);
  return {
    events,
    backup,
    runner,
    run: () =>
      installVoiceHistoryOnRunner(
        runner as unknown as QueryRunner,
        pid,
        backup,
      ),
  };
};

describe('Voice V1.2 dedicated install transaction', () => {
  it('backs up the pinned snapshot and commits exactly Voice DDL and native tracking together', async () => {
    const { events, run, runner, backup } = scenario();
    expect(await run()).toBe('installed');
    expect(backup).toHaveBeenCalledWith('00000001-00000003-1');
    expect(events).toEqual([
      'begin',
      'lock',
      'backup',
      'ddl',
      'ddl',
      'ddl',
      'ddl',
      'tracking',
      'commit',
    ]);
    expect(
      runner.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.startsWith('CREATE ')),
    ).toEqual(INCONNECT_VOICE_HISTORY_UP);
  });

  it.each([
    [{ wrongBackend: true }, 'Database identity', ['begin', 'rollback']],
    [{ held: true }, 'already running', ['begin', 'rollback']],
    [
      { failBackup: true },
      'Backup validation failed',
      ['begin', 'lock', 'backup', 'rollback'],
    ],
    [
      { failTracking: true },
      'Tracking rejected',
      ['begin', 'lock', 'backup', 'ddl', 'ddl', 'ddl', 'ddl', 'rollback'],
    ],
    [
      { drift: true },
      'would alter',
      [
        'begin',
        'lock',
        'backup',
        'ddl',
        'ddl',
        'ddl',
        'ddl',
        'tracking',
        'rollback',
      ],
    ],
  ] as const)(
    'denies invalid installations and rolls back %#',
    async (options, error, expected) => {
      const { events, run } = scenario(options);
      await expect(run()).rejects.toThrow(error);
      expect(events).toEqual(expected);
    },
  );

  it('checks installed tables and tracking and returns without backup or writes', async () => {
    const { events, run } = scenario({ already: true });
    expect(await run()).toBe('already-installed');
    expect(events).toEqual(['begin', 'lock', 'rollback']);
  });

  it('reports uncertain commit separately and never retries on the same connection', async () => {
    const { events, run, runner } = scenario({ failCommit: true });
    await expect(run()).rejects.toThrow('Commit was not confirmed');
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(events).toContain('rollback');
  });

  it('rejects a partial set of Voice relations from the catalog', async () => {
    const schema = jest.requireActual<
      typeof import('src/database/scripts/inconnect-voice-v12/voice-v12-schema')
    >('src/database/scripts/inconnect-voice-v12/voice-v12-schema');
    const runner = {
      query: jest.fn().mockResolvedValue([{ name: 'inconnectVoiceCall' }]),
    } as unknown as QueryRunner;
    await expect(schema.readVoiceSchemaState(runner)).rejects.toThrow(
      'Partial Voice schema',
    );
  });
});
