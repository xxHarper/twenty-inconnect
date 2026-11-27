import { type QueryRunner } from 'typeorm';

import { voiceV21Command } from 'src/database/scripts/inconnect-voice-v21/voice-v21-install';

describe('Voice V2.1 registered maintenance plan', () => {
  it('adds attempt and cursor tables in place and guards rollback after distribution', async () => {
    const query = jest.fn();
    const runner = { query } as unknown as QueryRunner;
    const command = voiceV21Command();
    await command.runDataMigration();
    expect(query).not.toHaveBeenCalled();
    await command.up(runner);
    const up = query.mock.calls.map(([sql]: [string]) => sql).join('\n');
    expect(up).toContain('CREATE TABLE core."inconnectVoiceInboundOffer"');
    expect(up).toContain('CREATE TABLE core."inconnectVoicePhoneCursor"');
    expect(up).toContain('UNIQUE ("callId", "actorMemberId")');
    expect(up).toContain('WHERE "inboundOfferId" IS NULL');
    expect(up).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/i);
    query.mockClear();
    await command.down(runner);
    expect(query.mock.calls[0][0]).toContain(
      'Voice distribution history forbids reversal',
    );
  });
});
