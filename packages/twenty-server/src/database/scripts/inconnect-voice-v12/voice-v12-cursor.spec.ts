import { DatabaseSync } from 'node:sqlite';

import {
  cursorHasPassedVoiceHistory,
  VOICE_HISTORY_FOLLOWING_SLOW_NAME,
  VOICE_HISTORY_NAMED_CURSOR_CONDITION,
  VOICE_HISTORY_UPGRADE_NAME,
  voiceHistoryCursorParameters,
} from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

const voice = VOICE_HISTORY_UPGRADE_NAME;
const slow = VOICE_HISTORY_FOLLOWING_SLOW_NAME;
const other = '2.32.0_OtherWorkspaceCommand_1882600000000';

describe('Voice V1.2 cursor SQL on in-memory tracking fixtures', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`ATTACH DATABASE ':memory:' AS core;
      CREATE TABLE core."upgradeMigration"
      (name TEXT, attempt INTEGER, status TEXT, "workspaceId" TEXT, "isInitial" INTEGER, "createdAt" INTEGER)`);
  });

  afterEach(() => db.close());

  const insert = (
    name: string,
    workspaceId: string | null,
    date: number,
    status = 'completed',
    attempt = 1,
    initial = 0,
  ) =>
    db
      .prepare('INSERT INTO core."upgradeMigration" VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, attempt, status, workspaceId, initial, date);

  const latest = (workspace: string | null) =>
    db
      .prepare(`SELECT name, status FROM core."upgradeMigration" migration
      WHERE migration."workspaceId" IS :workspace AND ${VOICE_HISTORY_NAMED_CURSOR_CONDITION}
      AND migration.attempt = (
        SELECT MAX(other.attempt) FROM core."upgradeMigration" other WHERE other.name = migration.name
        AND other."workspaceId" IS migration."workspaceId"
      )
      ORDER BY migration."createdAt" DESC LIMIT 1`)
      .get({ workspace, ...voiceHistoryCursorParameters });

  it('retains the real Slow cursor separately for instance and initialized workspace', () => {
    insert(slow, null, 1);
    insert(slow, 'one', 2, 'completed', 1, 1);
    insert(voice, null, 3);
    insert(voice, 'one', 3);
    expect(latest(null)).toEqual({ name: slow, status: 'completed' });
    expect(latest('one')).toEqual({ name: slow, status: 'completed' });
    expect(
      db
        .prepare(
          'SELECT count(*) AS count FROM core."upgradeMigration" WHERE name = ?',
        )
        .get(voice),
    ).toEqual({ count: 2 });
  });

  it('retains ordinary cursors when the successor is missing, failed, or only initial at instance scope', () => {
    insert(voice, null, 1);
    insert(voice, 'one', 1);
    insert(slow, 'one', 2, 'failed', 2);
    expect(latest(null)).toEqual({ name: voice, status: 'completed' });
    expect(latest('one')).toEqual({ name: slow, status: 'failed' });
    insert(slow, null, 2, 'completed', 1, 1);
    insert(voice, null, 3, 'failed', 2);
    expect(latest(null)).toEqual({ name: voice, status: 'failed' });
    insert(slow, null, 4, 'completed', 2);
    insert(slow, null, 5, 'failed', 3);
    expect(latest(null)).toEqual({ name: slow, status: 'failed' });
  });

  it('keeps a later unrelated failure visible and does not equate cursor order with Voice completion', () => {
    insert(slow, null, 1);
    insert(slow, 'one', 2, 'completed', 1, 1);
    insert(other, 'one', 3, 'failed');
    insert(voice, 'one', 4, 'failed');
    expect(latest('one')).toEqual({ name: other, status: 'failed' });
    expect(cursorHasPassedVoiceHistory([voice, slow, other], other)).toBe(true);
    expect(cursorHasPassedVoiceHistory([voice, slow, other], voice)).toBe(
      false,
    );
    expect(
      cursorHasPassedVoiceHistory([voice, slow, other], voice, 'completed'),
    ).toBe(true);
    expect(cursorHasPassedVoiceHistory([slow, other], slow)).toBe(false);
  });
});
