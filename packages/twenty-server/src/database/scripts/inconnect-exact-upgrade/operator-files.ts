import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';

import { openArtifact } from 'src/database/scripts/inconnect-exact-upgrade/artifact';
import { requireIndependentRestoreReview } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';
import { validateRestoreEvidence } from 'src/database/scripts/inconnect-exact-upgrade/restore-evidence';
import {
  backupSchema,
  type Request,
  requireCondition,
  type Snapshot,
  validateBackup,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

export const readGit = (
  root: string,
): { branch: string; commit: string; status: string } => {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

  requireCondition(
    git(['rev-parse', '--show-toplevel']) === realpathSync(root),
    'Unexpected repository root',
  );
  return {
    branch: git(['branch', '--show-current']),
    commit: git(['rev-parse', 'HEAD']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']),
  };
};

export const requireHostQuiescence = (): void => {
  requireCondition(
    false,
    'Maintenance isolation UNKNOWN: Linux process/session observations cannot establish Windows, containers, workers, cron, Redis recovery, supervisors or other application isolation',
  );
};

export const verifyBackupFile = async (
  request: Request,
  snapshot: Snapshot,
): Promise<void> => {
  requireCondition(
    Boolean(request.backupManifest),
    'Verified backup manifest is required',
  );
  const manifestArtifact = openArtifact(request.backupManifest as string);
  try {
    requireCondition(
      manifestArtifact.size <= BigInt(1024 * 1024),
      'Manifest exceeds size limit',
    );
    const backup = backupSchema.parse(
      JSON.parse(readFileSync(manifestArtifact.descriptor, 'utf8')),
    );
    validateBackup(request, snapshot, backup);
    const archive = openArtifact(backup.backupPath);
    try {
      const hash = createHash('sha256');
      // Stream the held descriptor, never reopen the name after validation.
      const { createReadStream } = await import('node:fs');
      for await (const buffer of createReadStream('', {
        fd: archive.descriptor,
        autoClose: false,
      }))
        hash.update(buffer);
      archive.unchanged();
      requireCondition(
        hash.digest('hex') === backup.sha256,
        'Backup checksum mismatch',
      );
      const evidenceArtifact = openArtifact(backup.verificationEvidencePath);
      try {
        requireCondition(
          evidenceArtifact.size <= BigInt(1024 * 1024),
          'Restore evidence exceeds size limit',
        );
        const evidence = readFileSync(evidenceArtifact.descriptor);
        requireCondition(
          createHash('sha256').update(evidence).digest('hex') ===
            backup.verificationEvidenceSha256,
          'Restore evidence checksum mismatch',
        );
        validateRestoreEvidence(JSON.parse(evidence.toString('utf8')), backup);
        evidenceArtifact.unchanged();
        // Listing a custom-format archive does not connect to a database or restore it.
        const listing = execFileSync(
          'pg_restore',
          ['--list', '/proc/self/fd/3'],
          {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe', archive.descriptor],
          },
        );

        requireCondition(
          /dbname: default\b/.test(listing) &&
            /TABLE.*core.*inconnectMessagingConfiguration/.test(listing) &&
            /TABLE DATA.*core.*inconnectMessagingConfiguration/.test(listing) &&
            /TABLE DATA.*core.*upgradeMigration/.test(listing),
          'Backup archive does not contain the intended database/schema/data/tracking',
        );
        const archiveKinds: Record<string, string> = {
          r: 'TABLE',
          p: 'TABLE',
          S: 'SEQUENCE',
          v: 'VIEW',
          m: 'MATERIALIZED VIEW',
          f: 'FOREIGN TABLE',
        };

        for (const relation of snapshot.backupRelations) {
          requireCondition(
            listing.includes(
              ` ${archiveKinds[relation.kind]} ${relation.schema} ${relation.name} `,
            ),
            'Backup archive is missing a physical relation',
          );
          if (relation.kind === 'r')
            requireCondition(
              listing.includes(
                ` TABLE DATA ${relation.schema} ${relation.name} `,
              ),
              'Backup archive is missing table data',
            );
        }
        archive.unchanged();
        manifestArtifact.unchanged();
        requireIndependentRestoreReview();
      } finally {
        evidenceArtifact.close();
      }
    } finally {
      archive.close();
    }
  } finally {
    manifestArtifact.close();
  }
};
