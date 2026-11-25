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
import { DataSource } from 'typeorm';

import { INCONNECT_VOICE_HISTORY_UP } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1795521600000-create-inconnect-voice-history';
import {
  installVoiceHistoryOnRunner,
  verifyVoiceCommandRegistration,
  verifyVoiceDatabaseIdentity,
  VOICE_DEV_LOCAL_R1,
} from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import { requireVoiceInstall } from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import { TWENTY_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/twenty-current-version.constant';
import { VOICE_HISTORY_UPGRADE_NAME } from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';

const target = VOICE_DEV_LOCAL_R1;
const pgBin = '/usr/lib/postgresql/18/bin';
const exec = promisify(execFile);

async function readAdminPassword() {
  requireVoiceInstall(
    (await realpath(target.directory)) === target.directory,
    'Dedicated directory differs',
  );
  const dirStat = await lstat(target.directory);
  requireVoiceInstall(
    dirStat.isDirectory() &&
      (dirStat.mode & 0o077) === 0 &&
      dirStat.uid === process.getuid?.(),
    'Dedicated directory is not private to this operator',
  );
  const identity = await readFile(
    join(target.directory, 'verified-identity'),
    'utf8',
  );
  const records = identity.match(/^pg_system_identifier=\d+$/gm);
  requireVoiceInstall(
    records?.length === 1 &&
      records[0] === `pg_system_identifier=${target.instance}`,
    'Recorded Gate A identity differs',
  );
  const secret = join(target.directory, 'credentials/postgres');
  const stat = await lstat(secret);
  requireVoiceInstall(
    stat.isFile() &&
      stat.size <= 4_096 &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === dirStat.uid &&
      (await realpath(secret)) === secret,
    'Dedicated credential file is not private',
  );
  const password = (await readFile(secret, 'utf8')).trim();
  requireVoiceInstall(
    password.length > 0 && !/[\r\n\0]/.test(password),
    'Dedicated credential is invalid',
  );
  return password;
}

function createDedicatedVoiceSource(password: string) {
  return new DataSource({
    type: 'postgres',
    host: target.host,
    port: target.port,
    database: target.database,
    username: target.admin,
    password,
    ssl: false,
    entities: [],
    migrations: [],
    subscribers: [],
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    cache: false,
    logging: false,
    poolSize: 1,
    extra: {
      application_name: 'inconnect-voice-v12-dev-local-install',
      connectionTimeoutMillis: 5_000,
      options:
        '-c default_transaction_read_only=on -c lock_timeout=4000 -c statement_timeout=15000 -c idle_in_transaction_session_timeout=180000',
    },
  });
}

async function backupDedicatedSnapshot(snapshot: string, password: string) {
  const directory = await mkdtemp(join(target.directory, 'voice-v1.2-backup.'));
  const file = join(directory, 'dev-local-r1.dump');
  const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };
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
          ...env,
          PGPASSWORD: password,
          PGCONNECT_TIMEOUT: '5',
          PGOPTIONS: '-c default_transaction_read_only=on',
          PGAPPNAME: 'inconnect-voice-v12-snapshot-backup',
        },
        timeout: 120_000,
      },
    );
    const { stdout: list } = await exec(
      join(pgBin, 'pg_restore'),
      ['--list', file],
      {
        env,
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    requireVoiceInstall(
      list.includes(`dbname: ${target.database}`) &&
        /\bTABLE DATA core upgradeMigration\b/.test(list) &&
        /\bTABLE DATA core workspace\b/.test(list) &&
        /\bTABLE DATA core objectMetadata\b/.test(list),
      'Backup catalog does not match the dedicated database',
    );
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    await writeFile(
      join(directory, 'backup.json'),
      JSON.stringify(
        {
          database: target.database,
          systemIdentifier: target.instance,
          snapshot,
          command: VOICE_HISTORY_UPGRADE_NAME,
          sha256: hash.digest('hex'),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
  } catch {
    throw new Error(
      `Backup could not be verified. Private evidence: ${directory}`,
    );
  }
  process.stdout.write(`Snapshot backup verified: ${directory}\n`);
}

async function main(args: string[]) {
  verifyVoiceCommandRegistration();
  requireVoiceInstall(
    TWENTY_CURRENT_VERSION === '2.32.0',
    'This maintenance entry requires Twenty 2.32.0',
  );
  if (args.length === 1 && args[0] === '--plan') {
    process.stdout.write(
      `${VOICE_HISTORY_UPGRADE_NAME}\n${target.database}@${target.host}:${target.port}\n`,
    );
    process.stdout.write(`${INCONNECT_VOICE_HISTORY_UP.join(';\n\n')};\n`);
    return;
  }
  requireVoiceInstall(
    args.length === 2 && args[0] === '--install' && args[1] === '1795521600000',
    'Use --plan, or --install 1795521600000 after the dedicated installation is authorized',
  );
  process.umask(0o077);
  const password = await readAdminPassword();
  const source = createDedicatedVoiceSource(password);
  await source.initialize();
  const runner = source.createQueryRunner();
  try {
    await runner.connect();
    const pid = await verifyVoiceDatabaseIdentity(runner, false);
    const result = await installVoiceHistoryOnRunner(runner, pid, (snapshot) =>
      backupDedicatedSnapshot(snapshot, password),
    );
    process.stdout.write(`${VOICE_HISTORY_UPGRADE_NAME}: ${result}\n`);
  } finally {
    try {
      await runner.release();
    } finally {
      await source.destroy();
    }
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown installation failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
