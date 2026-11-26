import {
  PermissionFlagType,
  SystemPermissionFlag,
} from 'twenty-shared/constants';
import { type QueryRunner } from 'typeorm';

import { AddInconnectVoiceManualDialSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795608000000-add-inconnect-voice-manual-dial';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';

describe('Voice V1.4 upgrade without infrastructure', () => {
  const command = new AddInconnectVoiceManualDialSlowInstanceCommand();

  it('orders the atomic work in the Slow phase and introduces definitions without grants', async () => {
    const query = jest.fn(async () => [{ invalid: false }]);
    expect(
      getRegisteredInstanceCommandMetadata(
        AddInconnectVoiceManualDialSlowInstanceCommand,
      ),
    ).toMatchObject({
      version: '2.32.0',
      timestamp: 1795608000000,
      type: 'slow',
    });
    await command.up({ query } as unknown as QueryRunner);

    const executed = query.mock.calls as unknown as [string, unknown[]][];
    expect(executed[0][0]).toContain(
      'CHECK (("objectMetadataId" IS NULL) = ("recordId" IS NULL))',
    );
    expect(executed[1][0]).toContain(
      '("workspaceId", "actorMemberId", "createdAt" DESC, id DESC)',
    );
    for (const flag of [
      PermissionFlagType.DIAL_INCONNECT_VOICE,
      PermissionFlagType.READ_UNLINKED_INCONNECT_VOICE_HISTORY,
    ]) {
      expect(
        executed.some(
          ([sql, parameters]) =>
            sql.includes('INSERT INTO core."permissionFlag"') &&
            parameters[0] === SystemPermissionFlag[flag] &&
            parameters[1] === flag,
        ),
      ).toBe(true);
    }
    expect(executed.map(([sql]) => sql).join('\n')).not.toContain(
      'rolePermissionFlag',
    );
  });

  it('refuses reversal when grants exist and leaves unlinked data protected by SET NOT NULL', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ present: true }]);
    const runner = { query } as unknown as QueryRunner;
    await expect(command.down(runner)).rejects.toThrow(
      'Voice permission grants',
    );
    expect(query).toHaveBeenCalledTimes(1);

    query
      .mockReset()
      .mockResolvedValueOnce([{ present: false }])
      .mockRejectedValueOnce(new Error('recordId contains null values'));
    await expect(command.down(runner)).rejects.toThrow(
      'recordId contains null values',
    );
    expect(query.mock.calls[1][0]).toContain(
      'ALTER COLUMN "recordId" SET NOT NULL',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
