import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify, parseEnv } from 'node:util';
import { DataSource, type QueryRunner } from 'typeorm';

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

const target = VOICE_DEV_LOCAL_R1;
const exec = promisify(execFile);
const pgBin = '/usr/lib/postgresql/18/bin';
const localEnv = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };

async function privateFile(name: string) {
  const dir = await lstat(target.directory);
  const path = join(target.directory, name);
  const stat = await lstat(path);
  requireVoiceInstall(
    dir.isDirectory() &&
      dir.uid === process.getuid?.() &&
      (dir.mode & 0o077) === 0 &&
      (await realpath(target.directory)) === target.directory &&
      stat.uid === dir.uid &&
      stat.isFile() &&
      (stat.mode & 0o077) === 0 &&
      stat.size <= 16_384 &&
      (await realpath(path)) === path,
    'The dedicated Voice files must be private and local',
  );
  return readFile(path, 'utf8');
}

async function connection<T>(
  password: string,
  operation: (runner: QueryRunner, pid: number) => Promise<T>,
) {
  const source = new DataSource({
    type: 'postgres',
    host: target.host,
    port: target.port,
    database: target.database,
    username: target.admin,
    password,
    ssl: false,
    installExtensions: false,
    entities: [],
    subscribers: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    cache: false,
    logging: false,
    poolSize: 1,
    extra: {
      application_name: 'voice-v14-dev-local-only',
      connectionTimeoutMillis: 5_000,
      options:
        '-c default_transaction_read_only=on -c lock_timeout=4000 -c statement_timeout=15000 -c idle_in_transaction_session_timeout=180000',
    },
  });
  await source.initialize();
  const runner = source.createQueryRunner();
  try {
    await runner.connect();
    return await operation(
      runner,
      await verifyVoiceDatabaseIdentity(runner, false),
    );
  } finally {
    try {
      await runner.release();
    } finally {
      await source.destroy();
    }
  }
}

async function backupSnapshot(snapshot: string, password: string) {
  const directory = await mkdtemp(join(target.directory, 'voice-v1.4-backup.'));
  const file = join(directory, 'dev-local-r1.dump');
  try {
    await exec(
      join(pgBin, 'pg_dump'),
      [
        '--no-password',
        '--format=custom',
        '--host',
        target.host,
        '--port',
        String(target.port),
        '--username',
        target.admin,
        '--dbname',
        target.database,
        '--snapshot',
        snapshot,
        '--lock-wait-timeout=5000',
        '--file',
        file,
      ],
      {
        env: {
          ...localEnv,
          PGPASSWORD: password,
          PGCONNECT_TIMEOUT: '5',
          PGOPTIONS: '-c default_transaction_read_only=on',
          PGAPPNAME: 'voice-v14-snapshot-backup',
        },
        timeout: 120_000,
      },
    );
    const { stdout: list } = await exec(
      join(pgBin, 'pg_restore'),
      ['--list', file],
      {
        env: localEnv,
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    requireVoiceInstall(
      list.includes(`dbname: ${target.database}`) &&
        [
          'workspace',
          'application',
          'objectMetadata',
          'permissionFlag',
          'rolePermissionFlag',
          'upgradeMigration',
          'inconnectVoiceCall',
          'inconnectVoiceCallLeg',
        ].every((table) =>
          new RegExp(`\\bTABLE DATA core ${table}\\b`).test(list),
        ),
      'Backup archive lacks required relations',
    );
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    await writeFile(
      join(directory, 'backup.json'),
      JSON.stringify(
        {
          database: target.database,
          systemIdentifier: target.instance,
          snapshot,
          command: VOICE_V14_INSTANCE,
          sha256: digest.digest('hex'),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
  } catch (error) {
    throw Object.assign(
      new Error(`Backup could not be verified. Private evidence: ${directory}`),
      { cause: error },
    );
  }
  process.stdout.write(`Snapshot backup verified: ${directory}\n`);
}

async function inspect(password: string, workspaceId: string) {
  return connection(password, async (runner, pid) => {
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
  const config = parseEnv(await privateFile('app.env'));
  const identity = (await privateFile('verified-identity')).match(
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
  const password = (await privateFile('credentials/postgres')).trim();
  requireVoiceInstall(
    password.length > 0 && !/[\r\n\0]/.test(password),
    'Dedicated database credential is invalid',
  );
  if (reading) {
    process.stdout.write(`${await inspect(password, workspaceId)}\n`);
  } else if (writing) {
    const state = await connection(password, (runner, pid) =>
      installVoiceV14(runner, pid, workspaceId, (snapshot) =>
        backupSnapshot(snapshot, password),
      ),
    );
    process.stdout.write(`${state}\n`);
  } else {
    await connection(password, async (runner) => {
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
