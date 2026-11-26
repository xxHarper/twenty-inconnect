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
import { promisify } from 'node:util';
import { DataSource, type QueryRunner } from 'typeorm';

import {
  verifyVoiceDatabaseIdentity,
  VOICE_DEV_LOCAL_R1,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import { requireVoiceInstall } from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';

const target = VOICE_DEV_LOCAL_R1;
const exec = promisify(execFile);
const pgBin = '/usr/lib/postgresql/18/bin';
const localEnv = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };

export async function readPrivateVoiceFile(name: string) {
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

export async function withVoiceConnection<T>(
  version: '1.4' | '2',
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
      application_name:
        version === '1.4'
          ? 'voice-v14-dev-local-only'
          : 'voice-v2-dev-local-only',
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

export async function backupVoiceSnapshot(
  snapshot: string,
  password: string,
  version: '1.4' | '2',
  command: string,
) {
  const directory = await mkdtemp(
    join(target.directory, `voice-v${version}-backup.`),
  );
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
          PGAPPNAME:
            version === '1.4'
              ? 'voice-v14-snapshot-backup'
              : 'voice-v2-snapshot-backup',
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
          command,
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
