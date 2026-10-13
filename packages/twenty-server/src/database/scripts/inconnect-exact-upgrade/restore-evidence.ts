import { z } from 'zod';

import {
  type Backup,
  EXPECTED_DATA_DIRECTORY,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

export const restoreEvidenceSchema = z.strictObject({
  version: z.literal(1),
  archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceSystemIdentifier: z.string().regex(/^\d+$/),
  sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  restoredAt: z.iso.datetime(),
  recordedBy: z.string().trim().min(1),
  target: z.strictObject({
    host: z.literal('127.0.0.1'),
    port: z.number().int().min(1024).max(65535),
    database: z.string().regex(/^inconnect_restore_[a-z0-9_]+$/),
    dataDirectory: z.string().startsWith('/'),
    systemIdentifier: z.string().regex(/^\d+$/),
    currentUser: z.string().min(1),
  }),
  restoreLogSha256: z.string().regex(/^[a-f0-9]{64}$/),
  verificationLogSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

// Structural linkage only. A completely forged, internally consistent record
// remains an untrusted operator claim and cannot open the execution gate.
export const validateRestoreEvidence = (
  input: unknown,
  backup: Backup,
): void => {
  const evidence = restoreEvidenceSchema.parse(input);

  requireCondition(
    evidence.archiveSha256 === backup.sha256 &&
      evidence.expectedCommit === backup.expectedCommit &&
      evidence.sourceSystemIdentifier === backup.systemIdentifier &&
      evidence.sourceStateHash === backup.stateHash &&
      evidence.restoredAt === backup.restoreVerifiedAt &&
      evidence.recordedBy === backup.verifiedBy &&
      evidence.target.port !== 5432 &&
      evidence.target.dataDirectory !== EXPECTED_DATA_DIRECTORY &&
      evidence.target.systemIdentifier !== backup.systemIdentifier,
    'Restore evidence archive/source/isolated-target binding mismatch',
  );
};
