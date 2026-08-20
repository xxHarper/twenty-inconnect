import { type QueryRunner } from 'typeorm';

import { CreateInconnectRecordAccessPersistenceFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence';

describe('INCONNECT record-access persistence identifier lengths', () => {
  it('keeps explicit PostgreSQL identifiers within 63 bytes', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    const identifiers = [
      ...sql.matchAll(/"((?:IDX|FK|CHK|PK)_[A-Z0-9_]+)"/g),
    ].map((match) => match[1]);

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.every((identifier) => identifier.length <= 63)).toBe(
      true,
    );
  });
});
