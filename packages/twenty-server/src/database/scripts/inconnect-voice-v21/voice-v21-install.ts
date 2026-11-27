import { type QueryRunner } from 'typeorm';

import { AddInconnectVoiceDistributionSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795780800000-add-inconnect-voice-distribution';
import {
  verifyVoiceDatabaseIdentity,
  VOICE_DEV_LOCAL_R1,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import { requireVoiceInstall } from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  readTracking,
  trackingColumns,
  verifyInstanceRows,
} from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';
import {
  inspectVoiceV2,
  verifyOtherClientsStopped,
} from 'src/database/scripts/inconnect-voice-v2/voice-v2-install';
import { TWENTY_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/twenty-current-version.constant';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { buildInstanceUpgradeMigrationRows } from 'src/engine/core-modules/upgrade/utils/build-instance-upgrade-migration-rows.util';

export const VOICE_V21_TIMESTAMP = '1795780800000';
export const VOICE_V21_INSTANCE =
  '2.32.0_AddInconnectVoiceDistributionSlowInstanceCommand_1795780800000';

export function voiceV21Command() {
  const command = AddInconnectVoiceDistributionSlowInstanceCommand;
  const metadata = getRegisteredInstanceCommandMetadata(command);
  requireVoiceInstall(
    metadata?.type === 'slow' &&
      TWENTY_CURRENT_VERSION === '2.32.0' &&
      `${metadata.version}_${command.name}_${metadata.timestamp}` ===
        VOICE_V21_INSTANCE,
    'Unexpected Voice V2.1 Slow command registration',
  );
  return new command();
}

export async function inspectVoiceV21(
  runner: QueryRunner,
  workspaceId: string,
) {
  const [catalog]: { alias: boolean; tables: number; trusted: boolean }[] =
    await runner.query(
      `SELECT EXISTS (SELECT FROM core."upgradeMigration" WHERE name <> $1
        AND (name LIKE '%' || $2 || '%' OR name LIKE '%AddInconnectVoiceDistributionSlowInstanceCommand%')) AS alias,
      count(*)::int AS tables,
      COALESCE(bool_and(c.relkind='r' AND c.relpersistence='p' AND NOT c.relrowsecurity
        AND pg_get_userbyid(c.relowner)=current_user AND NOT EXISTS (SELECT FROM pg_inherits WHERE inhparent=c.oid)), false) AS trusted
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='core' AND c.relname IN ('inconnectVoiceInboundOffer','inconnectVoicePhoneCursor')`,
      [VOICE_V21_INSTANCE, VOICE_V21_TIMESTAMP],
    );
  const tracking = await readTracking(runner, VOICE_V21_INSTANCE);
  const installed = tracking.length > 0;
  requireVoiceInstall(
    catalog?.alias === false &&
      (installed
        ? catalog.tables === 2 && catalog.trusted
        : catalog.tables === 0),
    'Partial or conflicting Voice V2.1 tracking or catalog',
  );
  if (installed) verifyInstanceRows(VOICE_V21_INSTANCE, workspaceId, tracking);
  const previous = await inspectVoiceV2(
    runner,
    workspaceId,
    installed ? VOICE_V21_INSTANCE : undefined,
  );
  requireVoiceInstall(
    previous.state === 'installed',
    'Voice V2 must already be installed',
  );

  if (installed) {
    const [shape]: { constraints: number; columns: number; valid: boolean }[] =
      await runner.query(`
      SELECT
        (SELECT count(*)::int FROM pg_attribute WHERE attrelid IN
          ('core."inconnectVoicePhoneCursor"'::regclass,'core."inconnectVoiceInboundOffer"'::regclass)
          AND attnum > 0 AND NOT attisdropped) AS columns,
        count(*)::int AS constraints, bool_and(convalidated AND NOT condeferrable) AS valid
      FROM pg_constraint WHERE conrelid IN
        ('core."inconnectVoicePhoneCursor"'::regclass,'core."inconnectVoiceInboundOffer"'::regclass)
        AND contype IN ('p', 'u', 'f', 'c')
    `);
    requireVoiceInstall(
      shape?.valid && shape.columns === 13 && shape.constraints === 12,
      'Voice V2.1 distribution table shape differs',
    );
  }
  return {
    ...previous,
    state: installed ? ('installed' as const) : ('ready' as const),
  };
}

async function digest(runner: QueryRunner) {
  const [row]: Record<string, string>[] = await runner.query(
    `SELECT
      (SELECT md5(COALESCE(string_agg((to_jsonb(c)-'distributionReason')::text, E'\\n' ORDER BY id),'')) FROM core."inconnectVoiceCall" c) AS calls,
      (SELECT md5(COALESCE(string_agg((to_jsonb(l)-'inboundOfferId')::text, E'\\n' ORDER BY "accountSid","providerCallSid"),'')) FROM core."inconnectVoiceCallLeg" l) AS legs,
      (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text,E'\\n' ORDER BY id),'')) FROM core."upgradeMigration" m WHERE name<>$1) AS tracking,
      (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY id),'')) FROM core."permissionFlag" p) AS permissions,
      (SELECT md5(COALESCE(string_agg(to_jsonb(g)::text,E'\\n' ORDER BY id),'')) FROM core."rolePermissionFlag" g) AS grants,
      (SELECT md5(string_agg(pg_get_indexdef(indexrelid), E'\\n' ORDER BY indexrelid)) FROM pg_index
        WHERE indrelid='core."inconnectVoiceCall"'::regclass) AS "callIndexes"`,
    [VOICE_V21_INSTANCE],
  );
  requireVoiceInstall(
    row && Object.values(row).every(Boolean),
    'Missing Voice preservation evidence',
  );
  return JSON.stringify(row);
}

export async function installVoiceV21(
  runner: QueryRunner,
  pid: number,
  workspaceId: string,
  backup: (snapshot: string) => Promise<void>,
) {
  const command = voiceV21Command();
  let committing = false;
  await runner.startTransaction('READ COMMITTED');
  try {
    await runner.query('SET TRANSACTION READ WRITE');
    requireVoiceInstall(
      (await verifyVoiceDatabaseIdentity(runner, true)) === pid,
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
    const before = await inspectVoiceV21(runner, workspaceId);
    if (before.state === 'installed') {
      await runner.rollbackTransaction();
      return before;
    }
    requireVoiceInstall(
      before.active === 0,
      'An active Voice attempt still exists',
    );
    const previous = await digest(runner);
    const [exported]: { snapshot: string }[] = await runner.query(
      'SELECT pg_export_snapshot() AS snapshot',
    );
    requireVoiceInstall(
      exported && /^[a-f\d]+-[a-f\d]+-\d+$/i.test(exported.snapshot),
      'Snapshot could not be pinned',
    );
    await backup(exported.snapshot);
    await verifyOtherClientsStopped(runner);
    await command.runDataMigration();
    await command.up(runner);
    const rows = buildInstanceUpgradeMigrationRows({
      name: VOICE_V21_INSTANCE,
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
    const after = await inspectVoiceV21(runner, workspaceId);
    requireVoiceInstall(
      after.state === 'installed' && (await digest(runner)) === previous,
      'Existing Voice history, tracking or grants changed',
    );
    committing = true;
    await runner.commitTransaction();
    return after;
  } catch (error) {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } catch {
      throw Object.assign(
        new Error(
          'Transaction outcome uncertain. Run --inspect before any retry.',
        ),
        { cause: error },
      );
    }
    if (committing)
      throw Object.assign(
        new Error('Commit unconfirmed. Run --inspect before any retry.'),
        { cause: error },
      );
    throw error;
  }
}
