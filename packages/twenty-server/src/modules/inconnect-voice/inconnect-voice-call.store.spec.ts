import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';

import { INCONNECT_VOICE_HISTORY_UP } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1795521600000-create-inconnect-voice-history';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { readTwilioProgress } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const actorMemberId = '00000000-0000-4000-8000-000000000002';
const recordId = '00000000-0000-4000-8000-000000000003';
const objectId = '00000000-0000-4000-8000-000000000004';
const id = '00000000-0000-4000-8000-000000000005';
const actor = { workspaceId, actorMemberId };
const config = {
  workspaceId,
  objectId,
  accountSid: `AC${'a'.repeat(32)}`,
  applicationSid: `AP${'a'.repeat(32)}`,
  callerId: '+12015550123',
} as InconnectVoiceConfig;
const attempt = {
  ...actor,
  id,
  recordId,
  destination: '+12015550124',
  expiresAt: Date.now() + 45_000,
};
const parentSid = `CA${'a'.repeat(32)}`;
const childSid = `CA${'b'.repeat(32)}`;
const scope = {
  sql: 'EXISTS (SELECT 1 WHERE call."recordId" = :permittedRecord)',
  parameters: { permittedRecord: recordId },
};

describe('Voice PostgreSQL boundary without a connection', () => {
  const query = jest.fn();
  const transact = jest.fn();
  const dataSource = new DataSource({ type: 'postgres' });
  const calls = new InconnectVoiceCallStore(dataSource);

  beforeEach(() => {
    query.mockReset();
    transact
      .mockReset()
      .mockImplementation((run: (manager: EntityManager) => Promise<unknown>) =>
        run({ query } as unknown as EntityManager),
      );
    jest.spyOn(dataSource, 'transaction').mockImplementation(transact);
    jest.spyOn(dataSource, 'query').mockImplementation(query);
  });

  afterEach(() => jest.restoreAllMocks());

  it('claims only unexpired reservations and reserves using a workspace/member unique index', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id }]);
    expect(await calls.reserve(config, attempt, 'Operator', scope)).toBe(true);
    expect(query.mock.calls[0][0]).toContain("status = 'reserved'");
    expect(query.mock.calls[1][0]).toContain(
      `EXISTS (SELECT 1 WHERE call."recordId" = $12)`,
    );
    expect(query.mock.calls[1][1][11]).toBe(recordId);
    expect(query.mock.calls[1][0]).toContain(
      `ON CONFLICT ("workspaceId", "actorMemberId") WHERE status <> 'finished' DO NOTHING`,
    );
    expect(INCONNECT_VOICE_HISTORY_UP.join('\n')).toContain(
      `("workspaceId", "actorMemberId") WHERE status <> 'finished'`,
    );
    query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
    expect(await calls.claim(config, attempt, parentSid, scope)).toBe(true);
    expect(await calls.claim(config, attempt, parentSid, scope)).toBe(false);
    expect(query.mock.calls[2][0]).toContain(
      `AND status = 'reserved' AND "expiresAt" > clock_timestamp()`,
    );
    expect(query.mock.calls[2][0]).toContain(
      `AND (EXISTS (SELECT 1 WHERE call."recordId" = $11))`,
    );
    expect(query.mock.calls[2][1][9]).toBe(parentSid);
  });

  it('serializes progress on the logical call and refuses an alternative destination leg', async () => {
    const progress = readTwilioProgress({
      status: 'completed',
      duration: '10',
    });
    if (!progress) throw new Error('Expected a terminal fixture');
    query
      .mockResolvedValueOnce([progress])
      .mockResolvedValueOnce([{ providerCallSid: childSid }]);
    await expect(
      calls.recordProgress(
        config,
        { id, parentSid, childSid: `CA${'c'.repeat(32)}` },
        progress,
      ),
    ).rejects.toThrow('Voice callback is unavailable');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE OF call');
    expect(query.mock.calls[0][1]).toEqual([
      id,
      workspaceId,
      config.accountSid,
      config.applicationSid,
      parentSid,
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockResolvedValueOnce([progress])
      .mockResolvedValueOnce([{ providerCallSid: childSid }])
      .mockResolvedValueOnce([]);
    await calls.recordProgress(config, { id, parentSid, childSid }, progress);
    expect(query.mock.calls[4][0]).toContain('IS DISTINCT FROM');
  });

  it('cannot cancel an already claimed call or a reservation outside the current record scope', async () => {
    query.mockResolvedValueOnce([]);
    await calls.cancelReservation(actor, id, false, scope);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain(`"actorMemberId" = $3 AND status = 'reserved'`);
    expect(sql).toContain(`AND (EXISTS (SELECT 1 WHERE call."recordId" = $5))`);
    expect(parameters).toEqual([
      id,
      workspaceId,
      actorMemberId,
      false,
      recordId,
    ]);
  });

  it('builds the authorized relation before either totals or cursor pagination', async () => {
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue({
      query: query.mockResolvedValue({
        records: [{ attempts: 0, answered: 0, durationSeconds: '0', rows: [] }],
      }),
      release: jest.fn(),
    } as unknown as QueryRunner);
    await calls.history(config, recordId, scope, actorMemberId, id);
    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toMatch(
      /WITH "authorized" AS \(SELECT .*?"core"\."inconnectVoiceCall".*?EXISTS/s,
    );
    expect(sql).toContain('COUNT(*) FILTER');
    expect(sql).toContain('LIMIT 21');
    expect(sql).not.toContain('destination');
    expect(parameters).toEqual(
      expect.arrayContaining([
        recordId,
        id,
        workspaceId,
        objectId,
        actorMemberId,
      ]),
    );
  });
});
