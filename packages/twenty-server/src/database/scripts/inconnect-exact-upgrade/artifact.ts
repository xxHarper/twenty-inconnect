import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';

// Hold the opened inode through hashing, parsing and pg_restore listing. Reject
// symlink components and hard links; a same-user operator is still trusted.
export const openArtifact = (path: string) => {
  requireCondition(
    isAbsolute(path) && path === resolve(path) && path === realpathSync(path),
    'Artifact path must be absolute, canonical and contain no symlink',
  );
  const repositoryRoot = resolve(__dirname, '../../../../../..');
  requireCondition(
    !path.startsWith(repositoryRoot + '/'),
    'Backup artifacts must remain outside the repository',
  );
  const before = lstatSync(path, { bigint: true });
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const opened = fstatSync(descriptor, { bigint: true });
  const unchanged = () => {
    const current = fstatSync(descriptor, { bigint: true });
    const named = statSync(path, { bigint: true });
    requireCondition(
      [current, named].every(
        (value) =>
          value.isFile() &&
          value.nlink === BigInt(1) &&
          value.dev === before.dev &&
          value.ino === before.ino &&
          value.size === before.size &&
          value.mtimeNs === before.mtimeNs &&
          value.ctimeNs === before.ctimeNs,
      ),
      'Artifact was replaced or modified during verification',
    );
    requireCondition(
      path === realpathSync(path),
      'Artifact path became a symlink',
    );
  };

  try {
    requireCondition(
      opened.isFile() && opened.size > BigInt(0) && opened.nlink === BigInt(1),
      'Artifact must be a nonempty regular file with exactly one link',
    );
    unchanged();
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return {
    descriptor,
    size: opened.size,
    unchanged,
    close: () => closeSync(descriptor),
  };
};
