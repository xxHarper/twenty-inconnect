import { type QueryRunner } from 'typeorm';

import { verifyVoiceDatabaseIdentity } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  installVoiceV14,
  VOICE_V14_INSTANCE,
  VOICE_V14_REFRESH,
} from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';
import { VOICE_HISTORY_FOLLOWING_SLOW_NAME } from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

jest.mock('src/database/scripts/inconnect-voice-v12/voice-v12-install', () => ({
  verifyVoiceDatabaseIdentity: jest.fn(),
}));
jest.mock('src/database/scripts/inconnect-voice-v12/voice-v12-schema', () => ({
  ...jest.requireActual(
    'src/database/scripts/inconnect-voice-v12/voice-v12-schema',
  ),
  verifyInstalledVoiceSchema: jest.fn(),
  verifyVoiceDependencies: jest.fn(),
}));

const workspaceId = '00000000-0000-4000-8000-000000000001';
const row = (name: string, workspace: string | null) => ({
  name,
  status: 'completed',
  attempt: 1,
  executedByVersion: '2.32.0',
  workspaceId: workspace,
  errorMessage: null,
  isInitial: false,
});

const setup = ({ idle = true, drift = false } = {}) => {
  let tracked = false;
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('AS locked')) return [{ locked: true, idle }];
    if (sql.includes('AS "standardApps"'))
      return [{ id: workspaceId, standardApps: 1, compatible: true }];
    if (sql.includes('AS "aliasConflict"')) return [{ aliasConflict: false }];
    if (sql.includes('WHERE name=$1')) {
      if (
        params?.[0] === VOICE_V14_REFRESH ||
        (params?.[0] === VOICE_V14_INSTANCE && !tracked)
      )
        return [];
      return [
        row(String(params?.[0]), null),
        row(String(params?.[0]), workspaceId),
      ];
    }
    if (sql.includes('AS "permissionArbiter"'))
      return [
        {
          nullable: tracked ? 2 : 0,
          pair: tracked,
          actorIndex: tracked,
          flagCount: tracked ? 2 : 0,
          correctFlags: tracked ? 2 : 0,
          active: 0,
          partial: 0,
          permissionArbiter: true,
        },
      ];
    if (sql.includes('FROM candidates')) {
      const name = tracked
        ? VOICE_V14_INSTANCE
        : VOICE_HISTORY_FOLLOWING_SLOW_NAME;
      return [row(name, null), row(name, workspaceId)];
    }
    if (sql.includes('AS calls'))
      return [{ calls: tracked && drift ? 'changed' : 'baseline' }];
    if (sql.includes('pg_export_snapshot'))
      return [{ snapshot: '00000001-00000001-1' }];
    if (sql.includes('AS invalid')) return [{ invalid: false }];
    if (sql.includes('INSERT INTO core."upgradeMigration"')) tracked = true;
    return [];
  });
  const transaction = {
    query,
    isTransactionActive: true,
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
  };
  return { runner: transaction as unknown as QueryRunner, ...transaction };
};

describe('Dedicated Voice V1.4 installation orchestration', () => {
  beforeEach(() => {
    jest.mocked(verifyVoiceDatabaseIdentity).mockResolvedValue(5);
    jest.mocked(verifyVoiceDependencies).mockResolvedValue(undefined);
    jest.mocked(verifyInstalledVoiceSchema).mockResolvedValue(undefined);
  });

  it('captures a backup before the registered up and commits exactly the new instance rows', async () => {
    const { runner, query, commitTransaction, rollbackTransaction } = setup();
    const backup = jest.fn(async () => {
      expect(
        query.mock.calls.some(([sql]) => sql.includes('ALTER TABLE')),
      ).toBe(false);
    });
    await expect(installVoiceV14(runner, 5, workspaceId, backup)).resolves.toBe(
      'refresh-pending',
    );
    expect(backup).toHaveBeenCalledWith('00000001-00000001-1');
    const tracking = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO core."upgradeMigration"'),
    );
    expect(JSON.parse(String(tracking?.[1]?.[0]))).toEqual([
      expect.objectContaining({ name: VOICE_V14_INSTANCE, workspaceId: null }),
      expect.objectContaining({ name: VOICE_V14_INSTANCE, workspaceId }),
    ]);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(rollbackTransaction).not.toHaveBeenCalled();
  });

  it('refuses other clients before backup or DDL', async () => {
    const { runner, query, rollbackTransaction } = setup({ idle: false });
    const backup = jest.fn();
    await expect(
      installVoiceV14(runner, 5, workspaceId, backup),
    ).rejects.toThrow('other database clients');
    expect(backup).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes('ALTER TABLE'))).toBe(
      false,
    );
    expect(rollbackTransaction).toHaveBeenCalled();
  });

  it('rolls back when existing data or tracking changes inside the transaction', async () => {
    const { runner, commitTransaction, rollbackTransaction } = setup({
      drift: true,
    });
    await expect(
      installVoiceV14(runner, 5, workspaceId, jest.fn()),
    ).rejects.toThrow(
      'Existing Voice data, grants, tracking or indexes changed',
    );
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(rollbackTransaction).toHaveBeenCalled();
  });

  it('rolls back without sending DDL if the snapshot backup fails', async () => {
    const { runner, query, rollbackTransaction } = setup();
    await expect(
      installVoiceV14(
        runner,
        5,
        workspaceId,
        jest.fn().mockRejectedValue(new Error('backup failed')),
      ),
    ).rejects.toThrow('backup failed');
    expect(query.mock.calls.some(([sql]) => sql.includes('ALTER TABLE'))).toBe(
      false,
    );
    expect(rollbackTransaction).toHaveBeenCalled();
  });

  it('requires inspection if the commit acknowledgement is lost', async () => {
    const { runner, commitTransaction } = setup();
    commitTransaction.mockRejectedValueOnce(new Error('connection closed'));
    await expect(
      installVoiceV14(runner, 5, workspaceId, jest.fn()),
    ).rejects.toThrow('Commit unconfirmed. Run --inspect before any retry.');
    expect(commitTransaction).toHaveBeenCalledTimes(1);
  });
});
