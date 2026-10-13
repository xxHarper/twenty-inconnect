import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openArtifact } from 'src/database/scripts/inconnect-exact-upgrade/artifact';
import {
  APPROVED_COMMANDS,
  backupSchema,
  EXPECTED_DATA_DIRECTORY,
  type Snapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { verifyBackupFile } from 'src/database/scripts/inconnect-exact-upgrade/operator-files';

jest.mock('node:child_process', () => ({
  ...jest.requireActual<typeof import('node:child_process')>(
    'node:child_process',
  ),
  execFileSync: jest.fn(),
}));

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const snapshot: Snapshot = {
  database: 'default',
  host: '127.0.0.1/32',
  port: 5432,
  version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
  dataDirectory: EXPECTED_DATA_DIRECTORY,
  systemIdentifier: '123',
  currentUser: 'operator',
  sessionUser: 'operator',
  extensions: ['uuid-ossp'],
  schemaValid: true,
  tracking: [],
  legacyNames: [],
  workspaceIds: [],
  otherSessions: 0,
  stateHash: 'b'.repeat(64),
  backupRelations: [],
};

const fixture = (directory: string) => {
  const now = Date.now();
  const evidence = {
    version: 1,
    archiveSha256: hash('archive'),
    expectedCommit: 'a'.repeat(40),
    sourceSystemIdentifier: '123',
    sourceStateHash: snapshot.stateHash,
    restoredAt: new Date(now - 1000).toISOString(),
    recordedBy: 'operator',
    target: {
      host: '127.0.0.1',
      port: 55432,
      database: 'inconnect_restore_proof',
      dataDirectory: '/tmp/restore-proof',
      systemIdentifier: '456',
      currentUser: 'restore_operator',
    },
    restoreLogSha256: 'c'.repeat(64),
    verificationLogSha256: 'd'.repeat(64),
  };
  const backup = {
    command: APPROVED_COMMANDS[0],
    expectedCommit: 'a'.repeat(40),
    database: 'default',
    host: '127.0.0.1',
    port: 5432,
    dataDirectory: EXPECTED_DATA_DIRECTORY,
    systemIdentifier: '123',
    stateHash: snapshot.stateHash,
    currentUser: 'operator',
    serverVersion: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
    backupPath: join(directory, 'archive.dump'),
    sha256: hash('archive'),
    createdAt: new Date(now - 2000).toISOString(),
    restoreVerifiedAt: evidence.restoredAt,
    verifiedBy: 'operator',
    verificationEvidencePath: join(directory, 'restore.json'),
    verificationEvidenceSha256: hash(JSON.stringify(evidence)),
    restoreVerified: true,
    fullDatabaseBackup: true,
    writersStoppedAndRestartPrevented: true,
  };
  const manifest = join(directory, 'manifest.json');
  writeFileSync(backup.backupPath, 'archive');
  writeFileSync(backup.verificationEvidencePath, JSON.stringify(evidence));
  const save = () => writeFileSync(manifest, JSON.stringify(backup));
  save();
  return {
    evidence,
    backup,
    save,
    request: {
      command: APPROVED_COMMANDS[0],
      expectedCommit: 'a'.repeat(40),
      mode: 'validate-backup' as const,
      backupManifest: manifest,
    },
  };
};

describe('held artifact descriptors and untrusted restore provenance', () => {
  let directory: string;
  beforeEach(() => {
    jest.useRealTimers();
    directory = mkdtempSync(join(tmpdir(), 'inconnect-evidence-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    jest.useFakeTimers();
  });

  it.each(['manifest', 'archive', 'evidence'])(
    'should reject a symlink for %s',
    async (kind) => {
      const { backup, request } = fixture(directory);
      const path =
        kind === 'manifest'
          ? request.backupManifest
          : kind === 'archive'
            ? backup.backupPath
            : backup.verificationEvidencePath;
      renameSync(path, path + '.original');
      symlinkSync(path + '.original', path);
      await expect(verifyBackupFile(request, snapshot)).rejects.toThrow(
        'symlink',
      );
    },
  );

  it('should detect path replacement after opening a regular artifact', () => {
    const path = join(directory, 'artifact');
    writeFileSync(path, 'original');
    const artifact = openArtifact(path);
    try {
      renameSync(path, path + '.original');
      writeFileSync(path, 'original');
      expect(() => artifact.unchanged()).toThrow('replaced');
    } finally {
      artifact.close();
    }
  });

  it('should detect in-place evidence modification while its descriptor is retained', () => {
    const path = join(directory, 'artifact');
    writeFileSync(path, 'original');
    const artifact = openArtifact(path);
    try {
      writeFileSync(path, 'changed');
      expect(() => artifact.unchanged()).toThrow('modified');
    } finally {
      artifact.close();
    }
  });

  it('should reject mismatched evidence checksum', async () => {
    const { backup, request } = fixture(directory);
    writeFileSync(backup.verificationEvidencePath, 'anything nonempty');
    await expect(verifyBackupFile(request, snapshot)).rejects.toThrow(
      'evidence checksum',
    );
  });

  it('should reject arbitrary nonempty evidence even when its hash is self-attested', async () => {
    const { backup, save, request } = fixture(directory);
    writeFileSync(backup.verificationEvidencePath, 'anything nonempty');
    backup.verificationEvidenceSha256 = hash('anything nonempty');
    save();
    await expect(verifyBackupFile(request, snapshot)).rejects.toThrow();
  });

  it('should reject restore evidence tied to another archive', async () => {
    const { evidence, backup, save, request } = fixture(directory);
    evidence.archiveSha256 = 'e'.repeat(64);
    writeFileSync(backup.verificationEvidencePath, JSON.stringify(evidence));
    backup.verificationEvidenceSha256 = hash(JSON.stringify(evidence));
    save();
    await expect(verifyBackupFile(request, snapshot)).rejects.toThrow(
      'binding mismatch',
    );
  });

  it('should refuse even a completely self-consistent forged manifest/log without independent review', async () => {
    const { request } = fixture(directory);
    const listing = jest
      .mocked(childProcess.execFileSync)
      .mockReturnValue(
        '; dbname: default\n TABLE core inconnectMessagingConfiguration \n TABLE DATA core inconnectMessagingConfiguration \n TABLE DATA core upgradeMigration ',
      );
    await expect(verifyBackupFile(request, snapshot)).rejects.toThrow(
      'provenance/review is UNKNOWN',
    );
    expect(listing).toHaveBeenCalledWith(
      'pg_restore',
      ['--list', '/proc/self/fd/3'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe', expect.any(Number)],
      }),
    );
  });

  it('should reject extra manifest keys rather than treating them as an approval override', () => {
    const { backup } = fixture(directory);
    expect(() => backupSchema.parse({ ...backup, force: true })).toThrow();
  });
});
