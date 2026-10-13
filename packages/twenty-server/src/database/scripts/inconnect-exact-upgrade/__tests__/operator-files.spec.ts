import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPROVED_COMMANDS,
  EXPECTED_DATA_DIRECTORY,
  type Snapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { verifyBackupFile } from 'src/database/scripts/inconnect-exact-upgrade/operator-files';

describe('verified backup artifact prerequisites (no database connections)', () => {
  let directory: string;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'inconnect-backup-guard-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    jest.useFakeTimers();
  });

  it('should reject a corrupt backup before invoking pg_restore listing', async () => {
    const backupPath = join(directory, 'backup.dump');
    const manifestPath = join(directory, 'verified.json');
    const now = Date.now();
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
      legacyNames: [],
      tracking: [],
      workspaceIds: [],
      otherSessions: 0,
      stateHash: 'b'.repeat(64),
      backupRelations: [],
    };

    writeFileSync(backupPath, 'corrupt archive');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        command: APPROVED_COMMANDS[0],
        expectedCommit: 'a'.repeat(40),
        database: 'default',
        host: '127.0.0.1',
        port: 5432,
        dataDirectory: EXPECTED_DATA_DIRECTORY,
        systemIdentifier: '123',
        stateHash: snapshot.stateHash,
        currentUser: 'operator',
        serverVersion: snapshot.version,
        backupPath,
        sha256: createHash('sha256').update('original archive').digest('hex'),
        createdAt: new Date(now - 2000).toISOString(),
        restoreVerifiedAt: new Date(now - 1000).toISOString(),
        verifiedBy: 'operator',
        verificationEvidencePath: join(directory, 'restore.log'),
        verificationEvidenceSha256: 'e'.repeat(64),
        restoreVerified: true,
        fullDatabaseBackup: true,
        writersStoppedAndRestartPrevented: true,
      }),
    );
    await expect(
      verifyBackupFile(
        {
          command: APPROVED_COMMANDS[0],
          mode: 'validate-backup',
          expectedCommit: 'a'.repeat(40),
          backupManifest: manifestPath,
        },
        snapshot,
      ),
    ).rejects.toThrow('checksum');
  });
});
