import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import {
  PermissionFlagType,
  SystemPermissionFlag,
} from 'twenty-shared/constants';
import { PROVISIONED_WORKSPACE_ACTIVATION_STATUSES } from 'twenty-shared/workspace';
import { type QueryRunner } from 'typeorm';

import { AddInconnectVoiceManualDialSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795608000000-add-inconnect-voice-manual-dial';
import { verifyVoiceDatabaseIdentity } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  requireVoiceInstall,
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import { TWENTY_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/twenty-current-version.constant';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { buildInstanceUpgradeMigrationRows } from 'src/engine/core-modules/upgrade/utils/build-instance-upgrade-migration-rows.util';
import {
  VOICE_HISTORY_FOLLOWING_SLOW_NAME,
  VOICE_HISTORY_UPGRADE_NAME,
  VOICE_HISTORY_WORKSPACE_CURSOR_CONDITION,
} from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

export const VOICE_V14_INSTANCE =
  '2.32.0_AddInconnectVoiceManualDialSlowInstanceCommand_1795608000000';
export const VOICE_V14_REFRESH =
  '2.32.0_RefreshVoicePermissionFlagsCommand_1795608000001';
const command = AddInconnectVoiceManualDialSlowInstanceCommand;
const permissionKeys = [
  PermissionFlagType.DIAL_INCONNECT_VOICE,
  PermissionFlagType.READ_UNLINKED_INCONNECT_VOICE_HISTORY,
];
const trackingColumns =
  'name, status, attempt, "executedByVersion", "workspaceId", "errorMessage", "isInitial"';

export function voiceV14Command() {
  const metadata = getRegisteredInstanceCommandMetadata(command);
  requireVoiceInstall(
    metadata?.type === 'slow' &&
      TWENTY_CURRENT_VERSION === '2.32.0' &&
      `${metadata.version}_${command.name}_${metadata.timestamp}` ===
        VOICE_V14_INSTANCE,
    'Unexpected Voice V1.4 command registration',
  );
  return new command();
}

export async function verifySinglePilotWorkspace(
  runner: QueryRunner,
  workspaceId: string,
) {
  const workspaces: {
    id: string;
    standardApps: number;
    compatible: boolean;
  }[] = await runner.query(
    `SELECT w.id, count(a.id)::int AS "standardApps",
      (SELECT count(*) FROM core.application a2 JOIN core.workspace w2 ON w2.id=a2."workspaceId"
        WHERE NOT (w2.id = $3::uuid) AND a2."universalIdentifier"=$2::uuid
          AND a2."deletedAt" IS NULL AND w2."deletedAt" IS NULL) = 0 AS compatible
     FROM core.workspace w
     LEFT JOIN core.application a ON a."workspaceId"=w.id AND a."universalIdentifier"=$2::uuid AND a."deletedAt" IS NULL
     WHERE w."deletedAt" IS NULL AND w."activationStatus"::text=ANY($1::text[])
     GROUP BY w.id`,
    [
      PROVISIONED_WORKSPACE_ACTIVATION_STATUSES,
      TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      workspaceId,
    ],
  );
  requireVoiceInstall(
    workspaces.length === 1 &&
      workspaces[0].id === workspaceId &&
      workspaces[0].standardApps === 1 &&
      workspaces[0].compatible,
    'Voice V1.4 is scoped to the single dedicated workspace and standard application',
  );
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

async function readTracking(
  runner: QueryRunner,
  name: string,
): Promise<TrackingRow[]> {
  return runner.query(
    `SELECT ${trackingColumns} FROM core."upgradeMigration" WHERE name=$1 ORDER BY "workspaceId" NULLS FIRST, attempt`,
    [name],
  );
}

function instanceRows(name: string, workspaceId: string) {
  return buildInstanceUpgradeMigrationRows({
    name,
    workspaceIds: [workspaceId],
    previousAttempts: 0,
    executedByVersion: '2.32.0',
    status: 'completed',
    errorMessage: null,
  });
}

function verifyInstanceRows(
  name: string,
  workspaceId: string,
  rows: TrackingRow[],
) {
  const expected = instanceRows(name, workspaceId);
  requireVoiceInstall(
    rows.length === expected.length &&
      rows.every(
        ({ isInitial, ...actual }, index) =>
          !isInitial &&
          Object.entries(expected[index]).every(
            ([key, value]) => actual[key as keyof typeof actual] === value,
          ),
      ),
    'Voice instance or mirrored workspace tracking differs',
  );
}

async function verifyCursors(
  runner: QueryRunner,
  workspaceId: string,
  instanceName: string,
  workspaceName: string,
  workspaceStatus = 'completed',
) {
  const cursors: TrackingRow[] = await runner.query(
    `WITH candidates AS (
       SELECT DISTINCT ON ("workspaceId",name) ${trackingColumns}, "createdAt", id
       FROM core."upgradeMigration" candidate
       WHERE ("workspaceId"=$1::uuid OR ("workspaceId" IS NULL AND NOT "isInitial"))
         AND ${VOICE_HISTORY_WORKSPACE_CURSOR_CONDITION}
       ORDER BY "workspaceId", name, attempt DESC
     )
     SELECT DISTINCT ON ("workspaceId") ${trackingColumns}
     FROM candidates ORDER BY "workspaceId" NULLS FIRST, "createdAt" DESC, id DESC`,
    [
      workspaceId,
      VOICE_HISTORY_UPGRADE_NAME,
      VOICE_HISTORY_FOLLOWING_SLOW_NAME,
    ],
  );
  requireVoiceInstall(
    cursors.length === 2 &&
      cursors[0].workspaceId === null &&
      cursors[0].name === instanceName &&
      cursors[1].workspaceId === workspaceId &&
      cursors[1].name === workspaceName &&
      cursors[0].status === 'completed' &&
      cursors[1].status === workspaceStatus,
    'Unexpected dedicated upgrade cursor',
  );
}

async function readShape(runner: QueryRunner, workspaceId: string) {
  const [shape]: {
    nullable: number;
    pair: boolean;
    actorIndex: boolean;
    flagCount: number;
    correctFlags: number;
    active: number;
    partial: number;
    permissionArbiter: boolean;
  }[] = await runner.query(
    `SELECT
       (SELECT count(*)::int FROM pg_attribute WHERE attrelid='core."inconnectVoiceCall"'::regclass
         AND attname IN ('objectMetadataId','recordId') AND NOT attnotnull) AS nullable,
       EXISTS (SELECT FROM pg_constraint WHERE conrelid='core."inconnectVoiceCall"'::regclass
         AND conname='CHK_inconnectVoiceCall_crmPair' AND contype='c' AND convalidated
         AND regexp_replace(pg_get_constraintdef(oid), '[^a-zA-Z=]', '', 'g') = 'CHECKobjectMetadataIdISNULL=recordIdISNULL') AS pair,
       EXISTS (SELECT FROM pg_index WHERE indexrelid=to_regclass('core."IDX_inconnectVoiceCall_actorHistory"')
         AND indrelid='core."inconnectVoiceCall"'::regclass AND indisvalid AND indisready AND NOT indisunique
         AND pg_get_indexdef(indexrelid)='CREATE INDEX "IDX_inconnectVoiceCall_actorHistory" ON core."inconnectVoiceCall" USING btree ("workspaceId", "actorMemberId", "createdAt" DESC, id DESC)') AS "actorIndex",
       (SELECT count(*)::int FROM core."permissionFlag" WHERE "key"=ANY($2::text[]) OR "universalIdentifier"=ANY($3::uuid[])) AS "flagCount",
       (SELECT count(*)::int FROM unnest($2::text[],$3::uuid[]) expected(key,identifier)
         JOIN core."permissionFlag" f ON f.key=expected.key AND f."universalIdentifier"=expected.identifier
         JOIN core.application a ON f."applicationId"=a.id AND f."workspaceId"=a."workspaceId"
         WHERE f."workspaceId"=$1::uuid AND a."universalIdentifier"=$4::uuid AND a."deletedAt" IS NULL
           AND f."permissionType"='tool') AS "correctFlags",
       (SELECT count(*)::int FROM core."inconnectVoiceCall" WHERE status <> 'finished') AS active,
       (SELECT count(*)::int FROM core."inconnectVoiceCall" WHERE ("objectMetadataId" IS NULL) <> ("recordId" IS NULL)) AS partial,
       EXISTS (SELECT FROM pg_index i WHERE indrelid='core."permissionFlag"'::regclass
         AND indisunique AND indisvalid AND indisready AND indimmediate AND indpred IS NULL
         AND ARRAY(SELECT pg_get_indexdef(i.indexrelid,n,true) FROM generate_series(1,i.indnkeyatts) n)
           = ARRAY['key','"workspaceId"'])
       AND NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='core."permissionFlag"'::regclass AND NOT tgisinternal)
       AND NOT EXISTS (SELECT FROM pg_rewrite WHERE ev_class='core."permissionFlag"'::regclass)
         AS "permissionArbiter"`,
    [
      workspaceId,
      permissionKeys,
      permissionKeys.map((key) => SystemPermissionFlag[key]),
      TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
    ],
  );
  requireVoiceInstall(
    shape?.permissionArbiter && shape.partial === 0,
    'Voice catalog dependency or CRM pair is invalid',
  );
  return shape;
}

export async function readVoiceV14State(
  runner: QueryRunner,
  workspaceId: string,
) {
  await verifySinglePilotWorkspace(runner, workspaceId);
  const [tracking]: { aliasConflict: boolean }[] = await runner.query(
    `SELECT EXISTS (SELECT FROM core."upgradeMigration"
      WHERE name ~ '1795521600000|1795608000000|1795608000001'
      AND name <> ALL($1::text[])) AS "aliasConflict"`,
    [[VOICE_HISTORY_UPGRADE_NAME, VOICE_V14_INSTANCE, VOICE_V14_REFRESH]],
  );
  requireVoiceInstall(
    tracking?.aliasConflict === false,
    'Unexpected Voice tracking aliases',
  );
  verifyInstanceRows(
    VOICE_HISTORY_UPGRADE_NAME,
    workspaceId,
    await readTracking(runner, VOICE_HISTORY_UPGRADE_NAME),
  );
  const shape = await readShape(runner, workspaceId);
  const instance = await readTracking(runner, VOICE_V14_INSTANCE);
  const refresh = await readTracking(runner, VOICE_V14_REFRESH);

  if (instance.length === 0) {
    requireVoiceInstall(
      shape.nullable === 0 &&
        !shape.pair &&
        !shape.actorIndex &&
        shape.flagCount === 0 &&
        refresh.length === 0,
      'Partial or conflicting Voice V1.4 state',
    );
    await verifyCursors(
      runner,
      workspaceId,
      VOICE_HISTORY_FOLLOWING_SLOW_NAME,
      VOICE_HISTORY_FOLLOWING_SLOW_NAME,
    );
    return 'ready' as const;
  }

  verifyInstanceRows(VOICE_V14_INSTANCE, workspaceId, instance);
  requireVoiceInstall(
    shape.nullable === 2 &&
      shape.pair &&
      shape.actorIndex &&
      shape.flagCount === 2 &&
      shape.correctFlags === 2,
    'Installed Voice V1.4 catalog is inconsistent',
  );
  if (refresh.length === 0) {
    await verifyCursors(
      runner,
      workspaceId,
      VOICE_V14_INSTANCE,
      VOICE_V14_INSTANCE,
    );
    return 'refresh-pending' as const;
  }
  const last = refresh[refresh.length - 1];
  requireVoiceInstall(
    last &&
      refresh.every(
        (row, index) =>
          row.workspaceId === workspaceId &&
          !row.isInitial &&
          row.attempt === index + 1 &&
          row.executedByVersion === '2.32.0' &&
          (row.status === 'failed' ||
            (index === refresh.length - 1 &&
              row.status === 'completed' &&
              row.errorMessage === null)),
      ),
    'Unexpected Voice workspace refresh tracking',
  );
  await verifyCursors(
    runner,
    workspaceId,
    VOICE_V14_INSTANCE,
    VOICE_V14_REFRESH,
    last.status,
  );
  return last.status === 'completed'
    ? ('installed' as const)
    : ('refresh-pending' as const);
}

async function preservationDigest(runner: QueryRunner) {
  const [digest]: Record<string, string>[] = await runner.query(
    `SELECT
      (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\\n' ORDER BY id), '')) FROM core."inconnectVoiceCall" c) AS calls,
      (SELECT md5(coalesce(string_agg(to_jsonb(l)::text, E'\\n' ORDER BY "accountSid","providerCallSid"), '')) FROM core."inconnectVoiceCallLeg" l) AS legs,
      (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\\n' ORDER BY id), '')) FROM core."upgradeMigration" m WHERE name <> $1) AS tracking,
      (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY id), '')) FROM core."rolePermissionFlag" r) AS grants,
      (SELECT md5(string_agg(pg_get_constraintdef(oid), E'\\n' ORDER BY oid)) FROM pg_constraint
        WHERE conrelid IN ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass)
          AND conname <> 'CHK_inconnectVoiceCall_crmPair' AND contype IN ('p','u','c','f')) AS constraints,
      (SELECT md5(string_agg(pg_get_indexdef(indexrelid), E'\\n' ORDER BY indexrelid)) FROM pg_index
        WHERE indrelid IN ('core."inconnectVoiceCall"'::regclass,'core."inconnectVoiceCallLeg"'::regclass)
          AND indexrelid IS DISTINCT FROM to_regclass('core."IDX_inconnectVoiceCall_actorHistory"')) AS indexes`,
    [VOICE_V14_INSTANCE],
  );
  requireVoiceInstall(digest, 'Preservation evidence is missing');
  return JSON.stringify(digest);
}

export async function installVoiceV14(
  runner: QueryRunner,
  connectedPid: number,
  workspaceId: string,
  backup: (snapshot: string) => Promise<void>,
) {
  let committing = false;
  await runner.startTransaction('READ COMMITTED');
  try {
    await runner.query('SET TRANSACTION READ WRITE');
    requireVoiceInstall(
      (await verifyVoiceDatabaseIdentity(runner, true)) === connectedPid,
      'Database connection changed',
    );
    await runner.query('SET LOCAL search_path=pg_catalog');
    const [gate]: { locked: boolean; idle: boolean }[] = await runner.query(
      `SELECT pg_try_advisory_xact_lock(1795521600000::bigint) AS locked,
         NOT EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND backend_type='client backend') AS idle`,
    );
    requireVoiceInstall(
      gate?.locked && gate.idle,
      'Stop dedicated API and other database clients before maintenance',
    );
    await runner.query(`LOCK TABLE core.workspace, core.application, core."objectMetadata", core."upgradeMigration",
      core."permissionFlag", core."rolePermissionFlag", core."inconnectVoiceCall", core."inconnectVoiceCallLeg"
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    await runner.query('SET LOCAL ROLE twenty_inconnect_dev_local_r1_app');
    const state = await readVoiceV14State(runner, workspaceId);
    if (state !== 'ready') {
      await runner.rollbackTransaction();
      return state;
    }
    await verifyVoiceDependencies(runner);
    await verifyInstalledVoiceSchema(runner);
    requireVoiceInstall(
      (await readShape(runner, workspaceId)).active === 0,
      'An active Voice attempt still exists',
    );
    const before = await preservationDigest(runner);
    const [exported]: { snapshot: string }[] = await runner.query(
      'SELECT pg_export_snapshot() AS snapshot',
    );
    requireVoiceInstall(
      exported && /^[a-f\d]+-[a-f\d]+-\d+$/i.test(exported.snapshot),
      'Snapshot could not be pinned',
    );
    await backup(exported.snapshot);

    await voiceV14Command().up(runner);
    await runner.query(
      `INSERT INTO core."upgradeMigration" (${trackingColumns})
       SELECT name,status,attempt,"executedByVersion","workspaceId","errorMessage",false
       FROM jsonb_to_recordset($1::jsonb) AS rows(name text,status text,attempt int,"executedByVersion" text,"workspaceId" uuid,"errorMessage" text)`,
      [JSON.stringify(instanceRows(VOICE_V14_INSTANCE, workspaceId))],
    );
    requireVoiceInstall(
      (await readVoiceV14State(runner, workspaceId)) === 'refresh-pending',
      'Voice V1.4 tracking did not advance as expected',
    );
    requireVoiceInstall(
      (await preservationDigest(runner)) === before,
      'Existing Voice data, grants, tracking or indexes changed',
    );
    committing = true;
    await runner.commitTransaction();
    return 'refresh-pending' as const;
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
