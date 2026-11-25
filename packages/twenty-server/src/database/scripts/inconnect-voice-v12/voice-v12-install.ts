import { type QueryRunner } from 'typeorm';
import { PROVISIONED_WORKSPACE_ACTIVATION_STATUSES } from 'twenty-shared/workspace';

import { CreateInconnectVoiceHistoryFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1795521600000-create-inconnect-voice-history';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { buildInstanceUpgradeMigrationRows } from 'src/engine/core-modules/upgrade/utils/build-instance-upgrade-migration-rows.util';
import {
  VOICE_HISTORY_FOLLOWING_SLOW_NAME,
  VOICE_HISTORY_UPGRADE_NAME,
  VOICE_HISTORY_WORKSPACE_CURSOR_CONDITION,
} from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';
import {
  readVoiceSchemaState,
  requireVoiceInstall,
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';

export const VOICE_DEV_LOCAL_R1 = {
  instance: '7709558439011452493',
  host: '127.0.0.1',
  port: 55432,
  database: 'twenty_inconnect_dev_local_r1',
  admin: 'dev_local_r1_admin',
  owner: 'twenty_inconnect_dev_local_r1_app',
  directory: '/home/alberto/twenty-inconnect-dev-local-r1',
} as const;

const command = CreateInconnectVoiceHistoryFastInstanceCommand;

export function verifyVoiceCommandRegistration() {
  const metadata = getRegisteredInstanceCommandMetadata(command);
  requireVoiceInstall(
    metadata?.type === 'fast' &&
      metadata.version === '2.32.0' &&
      metadata.timestamp === 1795521600000 &&
      `${metadata.version}_${command.name}_${metadata.timestamp}` ===
        VOICE_HISTORY_UPGRADE_NAME,
    'Voice Fast Instance Command metadata differs',
  );
}

export async function verifyVoiceDatabaseIdentity(
  runner: QueryRunner,
  writing: boolean,
) {
  const target = VOICE_DEV_LOCAL_R1;
  const [row]: { matches: boolean; pid: number }[] = await runner.query(
    `SELECT system_identifier::text = $1 AND host(inet_server_addr()) = $2
      AND inet_server_port() = $3 AND current_database() = $4 AND current_user = $5
      AND current_setting('data_directory') = $6 AND NOT pg_is_in_recovery()
      AND current_setting('transaction_read_only') = $7 AS matches, pg_backend_pid() AS pid
     FROM pg_control_system()`,
    [
      target.instance,
      target.host,
      target.port,
      target.database,
      target.admin,
      `${target.directory}/postgres`,
      writing ? 'off' : 'on',
    ],
  );
  requireVoiceInstall(
    row?.matches && Number.isSafeInteger(row.pid),
    'Database identity or transaction mode differs',
  );
  return row.pid;
}

type TrackingRow = {
  name: string;
  status: string;
  attempt: number;
  executedByVersion: string;
  workspaceId: string | null;
  errorMessage: string | null;
  isInitial: boolean;
};

const trackingColumns =
  'name, status, attempt, "executedByVersion", "workspaceId", "errorMessage", "isInitial"';

async function voiceTracking(runner: QueryRunner): Promise<TrackingRow[]> {
  return runner.query(
    `SELECT ${trackingColumns} FROM core."upgradeMigration"
     WHERE name = $1 OR name LIKE '%1795521600000%' OR name LIKE '%CreateInconnectVoiceHistoryFastInstanceCommand%'
     ORDER BY "workspaceId" ASC NULLS FIRST, attempt`,
    [VOICE_HISTORY_UPGRADE_NAME],
  );
}

async function voiceCursors(runner: QueryRunner, workspaces: string[]) {
  const cursors: TrackingRow[] = await runner.query(
    `WITH candidates AS (
       SELECT DISTINCT ON ("workspaceId", name) ${trackingColumns}, "createdAt"
       FROM core."upgradeMigration" candidate
       WHERE ("workspaceId" = ANY($1::uuid[]) OR ("workspaceId" IS NULL AND NOT "isInitial"))
       AND ${VOICE_HISTORY_WORKSPACE_CURSOR_CONDITION}
       ORDER BY "workspaceId", name, attempt DESC
     )
     SELECT DISTINCT ON ("workspaceId") ${trackingColumns}
     FROM candidates ORDER BY "workspaceId" ASC NULLS FIRST, "createdAt" DESC`,
    [workspaces, VOICE_HISTORY_UPGRADE_NAME, VOICE_HISTORY_FOLLOWING_SLOW_NAME],
  );
  return cursors;
}

function verifyTracking(rows: TrackingRow[], workspaces: string[]) {
  const expected = buildInstanceUpgradeMigrationRows({
    name: VOICE_HISTORY_UPGRADE_NAME,
    workspaceIds: workspaces,
    previousAttempts: 0,
    executedByVersion: '2.32.0',
    status: 'completed',
    errorMessage: null,
  });
  requireVoiceInstall(
    rows.length === expected.length &&
      rows.every(
        ({ isInitial, ...actual }, i) =>
          !isInitial &&
          Object.entries(expected[i]).every(
            ([key, value]) => actual[key as keyof typeof actual] === value,
          ),
      ),
    'Voice upgrade tracking does not match the exact instance and workspace rows',
  );
}

export async function installVoiceHistoryOnRunner(
  runner: QueryRunner,
  connectedPid: number,
  backup: (snapshot: string) => Promise<void>,
) {
  verifyVoiceCommandRegistration();
  let committing = false;
  await runner.startTransaction('READ COMMITTED');
  try {
    await runner.query('SET TRANSACTION READ WRITE');
    const pid = await verifyVoiceDatabaseIdentity(runner, true);
    requireVoiceInstall(pid === connectedPid, 'Database connection changed');
    await runner.query('SET LOCAL search_path = pg_catalog');
    const [lock]: { owned: boolean }[] = await runner.query(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS owned',
      [1795521600000],
    );
    requireVoiceInstall(lock?.owned, 'Voice maintenance is already running');
    // Protect the inspected catalog dependencies, scope and native tracking rows from concurrent writes.
    await runner.query(
      'LOCK TABLE core.workspace, core."objectMetadata", core."upgradeMigration" IN SHARE ROW EXCLUSIVE MODE NOWAIT',
    );
    await runner.query('SET LOCAL ROLE twenty_inconnect_dev_local_r1_app');
    await verifyVoiceDependencies(runner);
    const workspaces: { id: string }[] = await runner.query(
      `SELECT id FROM core.workspace WHERE "deletedAt" IS NULL
       AND "activationStatus"::text = ANY($1::text[]) ORDER BY id`,
      [PROVISIONED_WORKSPACE_ACTIVATION_STATUSES],
    );
    const workspaceIds = workspaces.map(({ id }) => id);

    const shape = await readVoiceSchemaState(runner);
    const tracking = await voiceTracking(runner);
    if (shape === 'present') {
      await verifyInstalledVoiceSchema(runner);
      verifyTracking(tracking, workspaceIds);
      await runner.rollbackTransaction();
      return 'already-installed';
    }
    requireVoiceInstall(
      tracking.length === 0,
      'Unexpected Voice upgrade tracking on an absent schema',
    );
    const before = await voiceCursors(runner, workspaceIds);
    requireVoiceInstall(
      before.length === workspaceIds.length + 1 &&
        before.every(
          ({ name, status }) =>
            name === VOICE_HISTORY_FOLLOWING_SLOW_NAME &&
            status === 'completed',
        ),
      'DEV-LOCAL-R1 is no longer at the reviewed instance and workspace cursor',
    );

    const [snapshot]: { snapshot: string }[] = await runner.query(
      'SELECT pg_export_snapshot() AS snapshot',
    );
    requireVoiceInstall(
      snapshot && /^[A-F\d]+-[A-F\d]+-\d+$/i.test(snapshot.snapshot),
      'Invalid pinned backup snapshot',
    );
    await backup(snapshot.snapshot);

    await new command().up(runner);
    await verifyInstalledVoiceSchema(runner);

    // Use the native row builder. The isolated runner has no Nest or entity graph.
    const rows = buildInstanceUpgradeMigrationRows({
      name: VOICE_HISTORY_UPGRADE_NAME,
      workspaceIds,
      previousAttempts: 0,
      executedByVersion: '2.32.0',
      status: 'completed',
      errorMessage: null,
    });
    await runner.query(
      `INSERT INTO core."upgradeMigration" (${trackingColumns})
       SELECT name, status, attempt, "executedByVersion", "workspaceId", "errorMessage", false
       FROM jsonb_to_recordset($1::jsonb) AS rows(name text, status text, attempt int,
         "executedByVersion" text, "workspaceId" uuid, "errorMessage" text)`,
      [JSON.stringify(rows)],
    );
    verifyTracking(await voiceTracking(runner), workspaceIds);
    requireVoiceInstall(
      JSON.stringify(await voiceCursors(runner, workspaceIds)) ===
        JSON.stringify(before),
      'Voice install would alter an existing workspace or instance cursor',
    );
    committing = true;
    await runner.commitTransaction();
    return 'installed';
  } catch (error) {
    if (runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction();
      } catch {
        throw Object.assign(
          new Error(
            'Transaction outcome could not be verified. Inspect Voice schema and tracking before retrying.',
          ),
          { cause: error },
        );
      }
    }
    if (committing) {
      throw Object.assign(
        new Error(
          'Commit was not confirmed. Inspect Voice schema and tracking before retrying.',
        ),
        { cause: error },
      );
    }
    throw error;
  }
}
