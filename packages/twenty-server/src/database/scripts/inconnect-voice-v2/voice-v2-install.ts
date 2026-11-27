import { type QueryRunner } from 'typeorm';

import { AddInconnectVoiceInboundSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795694400000-add-inconnect-voice-inbound';
import {
  verifyVoiceDatabaseIdentity,
  VOICE_DEV_LOCAL_R1,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  inboundColumns,
  requireVoiceInstall,
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  readTracking,
  readVoiceV14State,
  trackingColumns,
  verifyInstanceRows,
} from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';
import { TWENTY_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/twenty-current-version.constant';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { buildInstanceUpgradeMigrationRows } from 'src/engine/core-modules/upgrade/utils/build-instance-upgrade-migration-rows.util';

export const VOICE_V2_TIMESTAMP = '1795694400000';
export const VOICE_V2_INSTANCE =
  '2.32.0_AddInconnectVoiceInboundSlowInstanceCommand_1795694400000';

export function voiceV2Command() {
  const command = AddInconnectVoiceInboundSlowInstanceCommand;
  const metadata = getRegisteredInstanceCommandMetadata(command);
  requireVoiceInstall(
    metadata?.type === 'slow' &&
      TWENTY_CURRENT_VERSION === '2.32.0' &&
      `${metadata.version}_${command.name}_${metadata.timestamp}` ===
        VOICE_V2_INSTANCE,
    'Unexpected Voice V2 Slow command registration',
  );
  return new command();
}

export async function inspectVoiceV2(
  runner: QueryRunner,
  workspaceId: string,
  successor?: string,
) {
  const [conflict]: { alias: boolean }[] = await runner.query(
    `SELECT EXISTS (SELECT FROM core."upgradeMigration" WHERE name <> $1
      AND (name LIKE '%' || $2 || '%' OR name LIKE '%AddInconnectVoiceInboundSlowInstanceCommand%')) AS alias`,
    [VOICE_V2_INSTANCE, VOICE_V2_TIMESTAMP],
  );
  requireVoiceInstall(
    conflict?.alias === false,
    'Unexpected Voice V2 tracking alias',
  );
  const tracking = await readTracking(runner, VOICE_V2_INSTANCE);
  if (tracking.length > 0)
    verifyInstanceRows(VOICE_V2_INSTANCE, workspaceId, tracking);
  const installed = tracking.length > 0;
  requireVoiceInstall(
    (await readVoiceV14State(
      runner,
      workspaceId,
      installed ? (successor ?? VOICE_V2_INSTANCE) : undefined,
    )) === 'installed',
    'Voice V1.4 instance and workspace refresh must be completed',
  );
  await verifyVoiceDependencies(runner);
  await verifyInstalledVoiceSchema(
    runner,
    installed ? (successor ? '2.1' : '2') : '1.4',
  );

  const [ready]: { valid: boolean }[] = await runner.query(
    `SELECT NOT EXISTS (SELECT FROM pg_inherits WHERE inhparent IN
        ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass))
      AND NOT EXISTS (SELECT FROM pg_class WHERE oid IN
        ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass,'core."upgradeMigration"'::regclass)
        AND relrowsecurity)
      AND EXISTS (SELECT FROM pg_constraint WHERE conrelid='core."inconnectVoiceCall"'::regclass
        AND conname='inconnectVoiceCall_direction_check' AND contype='c')
      AND EXISTS (SELECT FROM pg_constraint WHERE conrelid='core."inconnectVoiceCall"'::regclass
        AND conname='inconnectVoiceCall_result_check' AND contype='c')
      AND EXISTS (SELECT FROM pg_constraint WHERE conrelid='core."inconnectVoiceCallLeg"'::regclass
        AND conname='inconnectVoiceCallLeg_kind_check' AND contype='c')
      AND 1 = (SELECT count(*) FROM pg_constraint k
        WHERE k.conrelid='core."inconnectVoiceCallLeg"'::regclass AND k.contype='c'
          AND ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=k.conrelid
            AND a.attnum=ANY(k.conkey) ORDER BY a.attname) = ARRAY['kind','parentCallSid'])
      AS valid`,
  );
  requireVoiceInstall(
    ready?.valid,
    'Voice table layout or named DDL dependencies differ',
  );

  const [history]: {
    calls: number;
    legs: number;
    durationSeconds: string;
    active: number;
  }[] = await runner.query(`SELECT count(*)::int AS calls,
        (SELECT count(*)::int FROM core."inconnectVoiceCallLeg") AS legs,
        coalesce(sum("durationSeconds"),0)::text AS "durationSeconds",
        count(*) FILTER (WHERE status <> 'finished')::int AS active
      FROM core."inconnectVoiceCall"`);
  requireVoiceInstall(
    history &&
      history.calls >= 11 &&
      history.legs >= 22 &&
      /^\d+$/.test(history.durationSeconds) &&
      BigInt(history.durationSeconds) >= BigInt(372),
    'Confirmed Voice history floor missing in DEV-LOCAL-R1',
  );
  return {
    state: installed ? ('installed' as const) : ('ready' as const),
    ...history,
  };
}

async function preservationDigest(runner: QueryRunner) {
  const [digest]: Record<string, string>[] = await runner.query(
    `SELECT
      (SELECT md5(coalesce(string_agg((to_jsonb(c) - $2::text[])::text, E'\\n' ORDER BY id), '')) FROM core."inconnectVoiceCall" c) AS calls,
      (SELECT md5(coalesce(string_agg(to_jsonb(l)::text, E'\\n' ORDER BY "accountSid","providerCallSid"), '')) FROM core."inconnectVoiceCallLeg" l) AS legs,
      (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\\n' ORDER BY id), '')) FROM core."upgradeMigration" m WHERE name <> $1) AS tracking,
      (SELECT md5(coalesce(string_agg(to_jsonb(p)::text, E'\\n' ORDER BY id), '')) FROM core."permissionFlag" p) AS permissions,
      (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY id), '')) FROM core."rolePermissionFlag" r) AS grants,
      (SELECT md5(string_agg(conname || pg_get_constraintdef(oid), E'\\n' ORDER BY oid)) FROM pg_constraint
        WHERE conrelid IN ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass)
          AND contype IN ('p','u','f')) AS keys,
      (SELECT md5(string_agg(pg_get_indexdef(indexrelid), E'\\n' ORDER BY indexrelid)) FROM pg_index
        WHERE indrelid IN ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass)) AS indexes`,
    [VOICE_V2_INSTANCE, inboundColumns],
  );
  requireVoiceInstall(
    digest && Object.values(digest).every(Boolean),
    'Missing preservation evidence',
  );
  return JSON.stringify(digest);
}

export async function verifyOtherClientsStopped(runner: QueryRunner) {
  const [gate]: { idle: boolean }[] = await runner.query(
    `SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND backend_type='client backend') AS idle`,
  );
  requireVoiceInstall(
    gate?.idle,
    'Stop the dedicated API and other database clients before maintenance',
  );
}

export async function installVoiceV2(
  runner: QueryRunner,
  connectedPid: number,
  workspaceId: string,
  backup: (snapshot: string) => Promise<void>,
) {
  const command = voiceV2Command();
  let committing = false;
  await runner.startTransaction('READ COMMITTED');
  try {
    await runner.query('SET TRANSACTION READ WRITE');
    requireVoiceInstall(
      (await verifyVoiceDatabaseIdentity(runner, true)) === connectedPid,
      'Database connection changed',
    );
    await runner.query('SET LOCAL search_path=pg_catalog');
    const [gate]: { locked: boolean }[] = await runner.query(
      'SELECT pg_try_advisory_xact_lock(1795521600000::bigint) AS locked',
    );
    requireVoiceInstall(gate?.locked, 'Voice maintenance is already running');
    await verifyOtherClientsStopped(runner);
    await runner.query(`LOCK TABLE core.workspace, core.application, core."objectMetadata", core."upgradeMigration",
      core."permissionFlag", core."rolePermissionFlag", core."inconnectVoiceCall", core."inconnectVoiceCallLeg"
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    await runner.query(`SET LOCAL ROLE ${VOICE_DEV_LOCAL_R1.owner}`);
    const before = await inspectVoiceV2(runner, workspaceId);
    if (before.state === 'installed') {
      await runner.rollbackTransaction();
      return before;
    }
    requireVoiceInstall(
      before.active === 0,
      'An active Voice attempt still exists',
    );
    const digest = await preservationDigest(runner);
    const [exported]: { snapshot: string }[] = await runner.query(
      'SELECT pg_export_snapshot() AS snapshot',
    );
    requireVoiceInstall(
      exported && /^[a-f\d]+-[a-f\d]+-\d+$/i.test(exported.snapshot),
      'Snapshot could not be pinned',
    );
    await backup(exported.snapshot);
    await verifyOtherClientsStopped(runner);

    // This specific Slow has an empty data phase and requires no DataSource.
    await command.runDataMigration();
    await command.up(runner);
    const rows = buildInstanceUpgradeMigrationRows({
      name: VOICE_V2_INSTANCE,
      workspaceIds: [workspaceId],
      previousAttempts: 0,
      executedByVersion: TWENTY_CURRENT_VERSION,
      status: 'completed',
      errorMessage: null,
    });
    await runner.query(
      `INSERT INTO core."upgradeMigration" (${trackingColumns})
       SELECT name,status,attempt,"executedByVersion","workspaceId","errorMessage",false
       FROM jsonb_to_recordset($1::jsonb) AS rows(name text,status text,attempt int,"executedByVersion" text,"workspaceId" uuid,"errorMessage" text)`,
      [JSON.stringify(rows)],
    );
    const after = await inspectVoiceV2(runner, workspaceId);
    const [defaults]: { valid: boolean }[] =
      await runner.query(`SELECT NOT EXISTS
      (SELECT FROM core."inconnectVoiceCall" WHERE "inboundSessionId" IS NOT NULL
        OR "inboundDecision" IS NOT NULL OR "inboundScreenedAt" IS NOT NULL
        OR "inboundDialSettled" OR "answeredMemberId" IS NOT NULL) AS valid`);
    requireVoiceInstall(
      after.state === 'installed' &&
        defaults?.valid &&
        (await preservationDigest(runner)) === digest,
      'Existing Voice history, permissions, tracking or indexes changed',
    );
    committing = true;
    await runner.commitTransaction();
    return after;
  } catch (error) {
    if (runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction();
      } catch {
        throw Object.assign(
          new Error(
            'Transaction outcome uncertain. Run --inspect before any retry.',
          ),
          { cause: error },
        );
      }
    }
    if (committing)
      throw Object.assign(
        new Error('Commit unconfirmed. Run --inspect before any retry.'),
        { cause: error },
      );
    throw error;
  }
}
