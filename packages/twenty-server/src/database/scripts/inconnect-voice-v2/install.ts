import { parseEnv } from 'node:util';

import { type QueryRunner } from 'typeorm';

import { VOICE_DEV_LOCAL_R1 } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import { requireVoiceInstall } from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import {
  inspectVoiceV2,
  installVoiceV2,
  voiceV2Command,
  VOICE_V2_INSTANCE,
  VOICE_V2_TIMESTAMP,
} from 'src/database/scripts/inconnect-voice-v2/voice-v2-install';
import {
  backupVoiceSnapshot,
  readPrivateVoiceFile,
  withVoiceConnection,
} from 'src/database/scripts/inconnect-voice-install-runtime';

const version = '2';
const target = VOICE_DEV_LOCAL_R1;

async function printPlan() {
  const statements: string[] = [];
  await voiceV2Command().up({
    query: async (sql: string) => {
      statements.push(sql);
    },
  } as unknown as QueryRunner);
  process.stdout.write(
    JSON.stringify(
      {
        target: `${target.database}@${target.host}:${target.port}`,
        instance: VOICE_V2_INSTANCE,
        type: 'slow',
        dataMigration: 'empty',
        statements,
      },
      null,
      2,
    ) + '\n',
  );
}

async function main(args: string[]) {
  voiceV2Command();
  const [option, id] = args;
  if (option === '--plan' && args.length === 1) return printPlan();
  const reading = option === '--inspect' && args.length === 1;
  const writing =
    option === '--install' && args.length === 2 && id === VOICE_V2_TIMESTAMP;

  requireVoiceInstall(
    reading || writing,
    'Use --plan, --inspect or --install with the exact authorized Voice V2 timestamp',
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
      ),
    'Missing dedicated Voice workspace',
  );
  if (writing) {
    requireVoiceInstall(
      config.INCONNECT_VOICE_ENABLE_OUTBOUND === 'false' &&
        config.INCONNECT_VOICE_ENABLE_INBOUND === 'false',
      'Persist both Voice flags as false and stop the dedicated API before installing',
    );
  }
  const password = (await readPrivateVoiceFile('credentials/postgres')).trim();
  requireVoiceInstall(
    password.length > 0 && !/[\r\n\0]/.test(password),
    'Invalid dedicated database credential',
  );

  const result = await withVoiceConnection(
    version,
    password,
    async (runner, pid) => {
      if (writing) {
        return installVoiceV2(runner, pid, workspaceId, (snapshot) =>
          backupVoiceSnapshot(snapshot, password, version, VOICE_V2_INSTANCE),
        );
      }
      await runner.startTransaction('REPEATABLE READ');
      try {
        await runner.query('SET TRANSACTION READ ONLY');
        await runner.query('SET LOCAL search_path=pg_catalog');
        await runner.query(`SET LOCAL ROLE ${target.owner}`);
        return await inspectVoiceV2(runner, workspaceId);
      } finally {
        await runner.rollbackTransaction();
      }
    },
  );
  process.stdout.write(JSON.stringify(result) + '\n');
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error && !('query' in error) && !('code' in error)
      ? error.message
      : 'Database operation failed. Inspect the dedicated state before retrying.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
