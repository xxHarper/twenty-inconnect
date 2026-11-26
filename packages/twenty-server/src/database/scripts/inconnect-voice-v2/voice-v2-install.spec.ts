import { type QueryRunner } from 'typeorm';

import { AddInconnectVoiceInboundSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795694400000-add-inconnect-voice-inbound';
import { verifyVoiceDatabaseIdentity } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  readVoiceV14State,
  VOICE_V14_INSTANCE,
  VOICE_V14_REFRESH,
} from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';
import {
  inspectVoiceV2,
  installVoiceV2,
  VOICE_V2_INSTANCE,
} from 'src/database/scripts/inconnect-voice-v2/voice-v2-install';
import { VOICE_HISTORY_UPGRADE_NAME } from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

jest.mock('src/database/scripts/inconnect-voice-v12/voice-v12-install', () => ({
  ...jest.requireActual(
    'src/database/scripts/inconnect-voice-v12/voice-v12-install',
  ),
  verifyVoiceDatabaseIdentity: jest.fn(),
}));
jest.mock('src/database/scripts/inconnect-voice-v12/voice-v12-schema', () => ({
  ...jest.requireActual(
    'src/database/scripts/inconnect-voice-v12/voice-v12-schema',
  ),
  verifyInstalledVoiceSchema: jest.fn(),
  verifyVoiceDependencies: jest.fn(),
}));

const workspace = '00000000-0000-4000-8000-000000000002';
const pid = 10;
const inventory = { calls: 12, legs: 24, durationSeconds: '390', active: 0 };
const row = (name: string, workspaceId: string | null) => ({
  name,
  workspaceId,
  status: 'completed',
  attempt: 1,
  executedByVersion: '2.32.0',
  errorMessage: null,
  isInitial: false,
});

const setup = ({
  installed = false,
  partial = false,
  wrongCursor = false,
  alias = false,
  idle = true,
  active = 0,
  drift = false,
  failDdl = false,
} = {}) => {
  let tracked = installed || partial;
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes(' AS alias')) return [{ alias }];
    if (sql.includes('AS locked')) return [{ locked: true }];
    if (sql.includes('AS idle')) return [{ idle }];
    if (sql.includes('AS "standardApps"'))
      return [{ id: workspace, standardApps: 1, compatible: true }];
    if (sql.includes('AS "aliasConflict"')) return [{ aliasConflict: false }];
    if (sql.includes('WHERE name=$1')) {
      const [name] = parameters as [string];
      if (name === VOICE_V2_INSTANCE && !tracked) return [];
      if (name === VOICE_V2_INSTANCE && partial) return [row(name, null)];
      if (name === VOICE_V14_REFRESH) return [row(name, workspace)];
      if (
        [
          VOICE_HISTORY_UPGRADE_NAME,
          VOICE_V14_INSTANCE,
          VOICE_V2_INSTANCE,
        ].includes(name)
      )
        return [row(name, null), row(name, workspace)];
    }
    if (sql.includes('AS "permissionArbiter"'))
      return [
        {
          nullable: 2,
          pair: true,
          actorIndex: true,
          flagCount: 2,
          correctFlags: 2,
          active,
          partial: 0,
          permissionArbiter: true,
        },
      ];
    if (sql.includes('FROM candidates'))
      return [
        row(
          tracked && !wrongCursor ? VOICE_V2_INSTANCE : VOICE_V14_INSTANCE,
          null,
        ),
        row(
          tracked && !wrongCursor ? VOICE_V2_INSTANCE : VOICE_V14_REFRESH,
          workspace,
        ),
      ];
    if (sql.includes('AS calls'))
      return [
        sql.includes('string_agg')
          ? { calls: tracked && drift ? 'changed' : 'same' }
          : { ...inventory, active },
      ];
    if (sql.includes(' AS valid')) return [{ valid: true }];
    if (sql.includes('pg_export_snapshot'))
      return [{ snapshot: '00000001-00000001-1' }];
    if (sql.includes('INSERT INTO core."upgradeMigration"')) tracked = true;
    if (failDdl && sql.startsWith('DO ')) throw new Error('DDL failed');
    return [];
  });
  const transaction = {
    query,
    isTransactionActive: true,
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(),
  };
  return { ...transaction, runner: transaction as unknown as QueryRunner };
};

describe('Dedicated Voice V2 Slow installer', () => {
  beforeEach(() => {
    jest.mocked(verifyVoiceDatabaseIdentity).mockResolvedValue(pid);
    jest.mocked(verifyVoiceDependencies).mockResolvedValue(undefined);
    jest.mocked(verifyInstalledVoiceSchema).mockResolvedValue(undefined);
  });

  it('validates both actual cursor contracts and installs only the selected Slow', async () => {
    const { runner, query, commitTransaction, rollbackTransaction } = setup();
    const phases: string[] = [];
    const data = jest
      .spyOn(
        AddInconnectVoiceInboundSlowInstanceCommand.prototype,
        'runDataMigration',
      )
      .mockImplementationOnce(async () => {
        phases.push('data');
      });
    try {
      const backup = jest.fn(async () => {
        expect(
          query.mock.calls.some(([sql]) => sql.startsWith('ALTER TABLE')),
        ).toBe(false);
        phases.push('backup');
      });
      await expect(
        installVoiceV2(runner, pid, workspace, backup),
      ).resolves.toEqual({ state: 'installed', ...inventory });
      expect(phases).toEqual(['backup', 'data']);
      expect(backup).toHaveBeenCalledWith('00000001-00000001-1');
      expect(
        query.mock.calls.filter(([sql]) => /^(DO|ALTER TABLE)/.test(sql)),
      ).toHaveLength(3);
      const write = query.mock.calls.find(([sql]) =>
        sql.startsWith('INSERT INTO core."upgradeMigration"'),
      );
      expect(JSON.parse(String(write?.[1]?.[0]))).toEqual(
        [null, workspace].map((workspaceId) => ({
          name: VOICE_V2_INSTANCE,
          workspaceId,
          status: 'completed',
          attempt: 1,
          executedByVersion: '2.32.0',
          errorMessage: null,
        })),
      );
      expect(verifyInstalledVoiceSchema).toHaveBeenCalledWith(runner, '1.4');
      expect(verifyInstalledVoiceSchema).toHaveBeenCalledWith(runner, '2');
      expect(commitTransaction).toHaveBeenCalledTimes(1);
      expect(rollbackTransaction).not.toHaveBeenCalled();
    } finally {
      data.mockRestore();
    }
  });

  it.each([
    [{ idle: false }, 'other database clients'],
    [{ active: 1 }, 'active Voice attempt'],
    [{ partial: true }, 'mirrored workspace tracking'],
    [{ installed: true, wrongCursor: true }, 'upgrade cursor'],
    [{ alias: true }, 'tracking alias'],
  ] as const)(
    'refuses an unsafe initial state %j',
    async (options, message) => {
      const { runner, query, rollbackTransaction } = setup(options);
      const backup = jest.fn();
      await expect(
        installVoiceV2(runner, pid, workspace, backup),
      ).rejects.toThrow(message);
      expect(backup).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) => sql.startsWith('ALTER TABLE')),
      ).toBe(false);
      expect(rollbackTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it('returns installed without reapplying DDL or tracking', async () => {
    const { runner, query, commitTransaction, rollbackTransaction } = setup({
      installed: true,
    });
    const backup = jest.fn();
    await expect(inspectVoiceV2(runner, workspace)).resolves.toEqual({
      state: 'installed',
      ...inventory,
    });
    await expect(
      installVoiceV2(runner, pid, workspace, backup),
    ).resolves.toEqual({ state: 'installed', ...inventory });
    expect(
      query.mock.calls.some(([sql]) => /^(INSERT|ALTER TABLE|DO)/.test(sql)),
    ).toBe(false);
    expect(backup).not.toHaveBeenCalled();
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ failDdl: true }, 'DDL failed'],
    [{ drift: true }, 'history, permissions, tracking or indexes changed'],
  ] as const)('rolls back on %j', async (options, message) => {
    const { runner, rollbackTransaction, commitTransaction } = setup(options);
    await expect(
      installVoiceV2(runner, pid, workspace, jest.fn()),
    ).rejects.toThrow(message);
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).not.toHaveBeenCalled();
  });

  it('does not send DDL if snapshot backup verification fails', async () => {
    const { runner, query, rollbackTransaction } = setup();
    const backup = jest.fn().mockRejectedValueOnce(new Error('backup failed'));
    await expect(
      installVoiceV2(runner, pid, workspace, backup),
    ).rejects.toThrow('backup failed');
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith('ALTER TABLE')),
    ).toBe(false);
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('requires inspection when the commit acknowledgement is lost', async () => {
    const { runner, commitTransaction } = setup();
    commitTransaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      installVoiceV2(runner, pid, workspace, jest.fn()),
    ).rejects.toThrow('Commit unconfirmed. Run --inspect');
  });

  it('keeps the V1.4 cursor check for its existing caller', async () => {
    const { runner } = setup();
    await expect(readVoiceV14State(runner, workspace)).resolves.toBe(
      'installed',
    );
  });
});
