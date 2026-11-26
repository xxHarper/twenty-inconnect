import { parseEnv } from 'node:util';
import { type QueryRunner } from 'typeorm';

import {
  verifyVoiceDatabaseIdentity,
  VOICE_DEV_LOCAL_R1,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import {
  requireVoiceInstall,
  verifyInstalledVoiceSchema,
  verifyVoiceDependencies,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  installVoiceV14,
  readVoiceV14State,
  voiceV14Command,
  VOICE_V14_INSTANCE,
  VOICE_V14_REFRESH,
} from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';
import {
  backupVoiceSnapshot,
  readPrivateVoiceFile,
  withVoiceConnection,
} from 'src/database/scripts/inconnect-voice-install-runtime';

const target = VOICE_DEV_LOCAL_R1;
const version = '1.4';

async function inspect(password: string, workspaceId: string) {
  return withVoiceConnection(version, password, async (runner, pid) => {
    await runner.startTransaction('REPEATABLE READ');
    try {
      requireVoiceInstall(
        (await verifyVoiceDatabaseIdentity(runner, false)) === pid,
        'Database connection changed',
      );
      await runner.query('SET LOCAL search_path=pg_catalog');
      await runner.query('SET LOCAL ROLE twenty_inconnect_dev_local_r1_app');
      const state = await readVoiceV14State(runner, workspaceId);
      if (state === 'ready') {
        await verifyVoiceDependencies(runner);
        await verifyInstalledVoiceSchema(runner);
      }
      return state;
    } finally {
      await runner.rollbackTransaction();
    }
  });
}

async function printPlan() {
  const statements: { sql: string; parameters: unknown[] }[] = [];
  await voiceV14Command().up({
    query: async (sql: string, parameters: unknown[] = []) => {
      statements.push({ sql, parameters });
      return [{ invalid: false }];
    },
  } as unknown as QueryRunner);
  process.stdout.write(
    JSON.stringify(
      {
        target: `${target.database}@${target.host}:${target.port}`,
        instance: VOICE_V14_INSTANCE,
        workspace: VOICE_V14_REFRESH,
        statements,
      },
      null,
      2,
    ) + '\n',
  );
}

async function main(args: string[]) {
  voiceV14Command();
  const [option, id] = args;
  if (option === '--plan' && args.length === 1) return printPlan();
  const reading = option === '--inspect' && args.length === 1;
  const writing =
    option === '--install' && args.length === 2 && id === '1795608000000';
  const refreshing =
    option === '--refresh' && args.length === 2 && id === '1795608000001';
  requireVoiceInstall(
    reading || writing || refreshing,
    'Use --plan, --inspect, or the explicitly authorized install/refresh with its exact timestamp',
  );
  process.umask(0o077);
  const config = parseEnv(await readPrivateVoiceFile('app.env'));
  const identity = (await readPrivateVoiceFile('verified-identity')).match(
    /^pg_system_identifier=\d+$/gm,
  );
  requireVoiceInstall(
    identity?.length === 1 &&
      identity[0] === `pg_system_identifier=${target.instance}`,
    'Dedicated Gate A identity differs',
  );
  const workspaceId = config.INCONNECT_VOICE_WORKSPACE_ID;
  requireVoiceInstall(
    workspaceId &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        workspaceId,
      ) &&
      config.INCONNECT_VOICE_ENABLE_OUTBOUND === 'false',
    'Dedicated workspace or Outbound setting differs',
  );
  const password = (await readPrivateVoiceFile('credentials/postgres')).trim();
  requireVoiceInstall(
    password.length > 0 && !/[\r\n\0]/.test(password),
    'Dedicated database credential is invalid',
  );
  if (reading) {
    process.stdout.write(`${await inspect(password, workspaceId)}\n`);
  } else if (writing) {
    const state = await withVoiceConnection(version, password, (runner, pid) =>
      installVoiceV14(runner, pid, workspaceId, (snapshot) =>
        backupVoiceSnapshot(snapshot, password, version, VOICE_V14_INSTANCE),
      ),
    );
    process.stdout.write(`${state}\n`);
  } else {
    await withVoiceConnection(version, password, async (runner) => {
      const [lock]: { held: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(1795608000001::bigint) AS held',
      );
      requireVoiceInstall(
        lock?.held,
        'Voice workspace refresh is already running',
      );
      try {
        const state = await inspect(password, workspaceId);
        requireVoiceInstall(
          state !== 'ready',
          'Install the exact Voice instance upgrade before refreshing',
        );
        if (state === 'installed') return;
        const { refreshVoiceV14 } =
          await import('src/database/scripts/inconnect-voice-v14/refresh');
        await refreshVoiceV14(config, workspaceId);
        requireVoiceInstall(
          (await inspect(password, workspaceId)) === 'installed',
          'Workspace refresh outcome requires inspection',
        );
      } finally {
        await runner.query('SELECT pg_advisory_unlock(1795608000001::bigint)');
      }
    });
    process.stdout.write('installed\n');
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error && !('query' in error) && !('code' in error)
      ? error.message
      : 'Database operation failed. Inspect the dedicated state before retrying.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
