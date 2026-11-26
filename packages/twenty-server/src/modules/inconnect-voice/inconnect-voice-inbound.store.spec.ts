import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';

import { AddInconnectVoiceInboundSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795694400000-add-inconnect-voice-inbound';
import { type VoiceInboundConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceInboundStore } from 'src/modules/inconnect-voice/inconnect-voice-inbound.store';
import { readTwilioProgress } from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

const config = {
  workspaceId: 'workspace',
  objectId: 'lead',
  applicationSid: 'app',
  accountSid: 'account',
  receiver: '+12015550123',
  source: '+525512345678',
} as VoiceInboundConfig;
const id = 'logical';
const parentSid = 'caller-leg';
const childSid = 'browser-leg';
const route = {
  actorLabel: 'Pilot',
  actorMemberId: 'pilot-member',
  recordId: 'lead-record',
  sessionId: 'pilot-session',
  scope: {
    sql: 'call."recordId" = :visibleRecord',
    parameters: { visibleRecord: 'lead-record' },
  },
};

describe('Voice inbound persistence SQL', () => {
  const dataSource = new DataSource({ type: 'postgres' });
  const query = jest.fn();
  const transact = jest.fn();
  const store = new InconnectVoiceInboundStore(dataSource);

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

  it('uses the shared active actor exclusion and persists the caller leg in the same transaction', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id }])
      .mockResolvedValueOnce([]);
    expect(await store.create(config, id, parentSid, route, false)).toBe(true);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[3][0]).toContain('call."recordId" = $12');
    expect(query.mock.calls[3][0]).toContain(
      'ON CONFLICT ("workspaceId", "actorMemberId") WHERE status <> \'finished\'',
    );
    expect(query.mock.calls[4][0]).toContain("'caller'");
    expect(query.mock.calls[4][1]).toEqual([id, config.accountSid, parentSid]);
  });

  it('records a busy attempt without another offer and suppresses an already attached parent SID', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id }])
      .mockResolvedValueOnce([]);
    expect(await store.create(config, id, parentSid, route, false)).toBe(false);
    expect(query.mock.calls[4][0]).toContain("'finished', 'busy'");
    expect(query.mock.calls[4][0]).toContain('call."recordId" = $11');
    query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id }]);
    expect(await store.create(config, id, parentSid, route, false)).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('puts the scoped record predicate in the decision update and denies missing offers', async () => {
    query.mockResolvedValueOnce([]);
    await expect(
      store.decide(
        config,
        id,
        route.actorMemberId,
        route.sessionId,
        route.scope,
        'accept',
      ),
    ).rejects.toThrow();
    expect(query.mock.calls[0][0]).toContain('call."recordId" = $10');
    expect(query.mock.calls[0][0]).toContain('call."inboundSessionId" = $5');
    expect(query.mock.calls[0][0]).toContain("status = 'ringing'");
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        config.workspaceId,
        route.actorMemberId,
        route.sessionId,
        'accept',
      ]),
    );
  });

  it('does not rebind a SID and lets final Dial evidence replace a parent fallback only once', async () => {
    const progress = readTwilioProgress({
      status: 'completed',
      duration: '12',
    });
    if (!progress) throw new Error('Expected provider evidence');
    const event = { id, parentSid, childSid };
    query
      .mockResolvedValueOnce([{ id, sessionId: route.sessionId }])
      .mockResolvedValueOnce([{ providerCallSid: 'another-browser' }]);
    await expect(store.settle(config, event, progress, true)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);

    query
      .mockReset()
      .mockResolvedValueOnce([{ id, sessionId: route.sessionId }])
      .mockResolvedValueOnce([{ providerCallSid: childSid }])
      .mockResolvedValueOnce([]);
    await store.settle(config, event, progress, true);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE OF call');
    expect(query.mock.calls[2][0]).toContain('NOT c."inboundDialSettled"');
    expect(query.mock.calls[2][0]).toContain('$5::integer');
    expect(query.mock.calls[2][0]).toContain('IS DISTINCT FROM');
    expect(query.mock.calls[2][0]).toContain(
      "WHEN \"inboundDecision\" = 'decline' THEN 'declined'",
    );
    expect(query.mock.calls[2][1]).toEqual([id, true, 'answered', null, 12]);
  });

  it('returns the bound browser leg for confirmation after a parent-only no-answer', async () => {
    query
      .mockResolvedValueOnce([{ id, sessionId: route.sessionId }])
      .mockResolvedValueOnce([{ childSid }]);
    const progress = readTwilioProgress({ status: 'no-answer' });
    if (!progress) throw new Error('Expected provider evidence');
    await expect(
      store.settle(
        config,
        { id: null, parentSid, childSid: null },
        progress,
        false,
      ),
    ).resolves.toEqual({ id, parentSid, childSid, direction: 'inbound' });
    expect(query.mock.calls[1][0]).toContain(
      'updated.result = \'no-answer\' AND NOT updated."inboundDialSettled"',
    );
  });

  it('upgrades the existing tables in place and keeps history on rollback', async () => {
    query.mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;
    const command = new AddInconnectVoiceInboundSlowInstanceCommand();
    await command.up(runner);
    await command.down(runner);
    const sql = query.mock.calls.map(([statement]) => statement as string);
    expect(sql.join('\n')).not.toMatch(/DROP (TABLE|INDEX)|DELETE|TRUNCATE/i);
    expect(sql[0]).toContain("CHECK (direction IN ('outbound', 'inbound'))");
    expect(sql[2]).toContain('"CHK_inconnectVoiceCallLeg_topology"');
    expect(sql[3]).toContain("CHECK (direction = 'outbound')");
  });
});
