import { constants } from 'node:fs';
import { resolve, sep } from 'node:path';

import { requireLeadPhysical } from 'test/development/inconnect-lead-physical/contracts';

export type ProbeStat = {
  isFile: () => boolean;
  isDirectory: () => boolean;
  uid: number;
  mode: number;
  size: number;
  dev: number;
  ino: number;
};
export type ProbeFile = {
  fd: number;
  stat: () => Promise<ProbeStat>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  appendFile: (value: string | Uint8Array) => Promise<void>;
  sync: () => Promise<void>;
  close: () => Promise<void>;
};
export type ProbeFileIo = {
  uid: number;
  lstat: (
    path: string,
  ) => Promise<ProbeStat & { isSymbolicLink: () => boolean }>;
  mkdir: (path: string, mode: number) => Promise<void>;
  open: (path: string, flags: number, mode?: number) => Promise<ProbeFile>;
};

export const inspectProbeAncestors = async (path: string, io: ProbeFileIo) => {
  let current = '';
  for (const segment of path.split(sep).filter(Boolean)) {
    current += `${sep}${segment}`;
    const actual = await io.lstat(current);
    requireLeadPhysical(
      !actual.isSymbolicLink() &&
        (actual.mode & 0o022) === 0 &&
        [0, io.uid].includes(actual.uid),
      'Untrusted path, symlink or permissions; preserve resources',
    );
  }
};

export const assertProbeBinding = async (
  file: ProbeFile,
  path: string,
  io: ProbeFileIo,
) => {
  const actual = await file.stat();
  const named = await io.lstat(path);
  requireLeadPhysical(
    Number.isSafeInteger(file.fd) &&
      file.fd >= 3 &&
      !named.isSymbolicLink() &&
      Number.isSafeInteger(actual.dev) &&
      Number.isSafeInteger(actual.ino) &&
      actual.dev === named.dev &&
      actual.ino === named.ino &&
      actual.mode === named.mode &&
      actual.uid === named.uid,
    'Descriptor or pathname identity changed',
  );
  return actual;
};

// /proc/self/fd resolves only pinned directory handles. Final components still use
// O_NOFOLLOW; name/handle relationships are checked before every durable record.
export const createProbeEvidence = (
  io: ProbeFileIo,
  repositoryRoot: string,
) => {
  let anchor: ProbeFile | undefined;
  let parent: ProbeFile | undefined;
  let root: ProbeFile | undefined;
  let log: ProbeFile | undefined;
  let rootPath: string | undefined;
  let parentPath: string | undefined;
  let attempted = false;
  let failed = false;
  const handles: ProbeFile[] = [];
  const acquire = async (path: string, flags: number, mode?: number) => {
    const handle = await io.open(path, flags, mode);
    handles.push(handle);
    requireLeadPhysical(
      handle.fd >= 3 &&
        !handles.slice(0, -1).some((item) => item.fd === handle.fd),
      'Unexpected evidence descriptor',
    );
    return handle;
  };
  const rootFdPath = () => {
    if (!root) throw new Error('Evidence directory unavailable');
    return `/proc/self/fd/${root.fd}`;
  };
  const validateBindings = async () => {
    if (
      failed ||
      !anchor ||
      !parent ||
      !root ||
      !log ||
      !parentPath ||
      !rootPath
    )
      throw new Error('Evidence acquisition incomplete');
    await inspectProbeAncestors(resolve(repositoryRoot, '.cache'), io);
    const anchorIdentity = await assertProbeBinding(anchor, repositoryRoot, io);
    const parentIdentity = await assertProbeBinding(parent, parentPath, io);
    const rootIdentity = await assertProbeBinding(root, rootPath, io);
    requireLeadPhysical(
      anchorIdentity.isDirectory() &&
        [0, io.uid].includes(anchorIdentity.uid) &&
        (anchorIdentity.mode & 0o022) === 0 &&
        parentIdentity.isDirectory() &&
        [0, io.uid].includes(parentIdentity.uid) &&
        (parentIdentity.mode & 0o022) === 0 &&
        rootIdentity.isDirectory() &&
        rootIdentity.uid === io.uid &&
        (rootIdentity.mode & 0o777) === 0o700,
      'Evidence directory permissions changed',
    );
    const logIdentity = await assertProbeBinding(
      log,
      `${rootFdPath()}/controller.jsonl`,
      io,
    );
    requireLeadPhysical(
      logIdentity.isFile() &&
        logIdentity.uid === io.uid &&
        (logIdentity.mode & 0o777) === 0o600,
      'Evidence log permissions changed',
    );
  };
  const sync = async () => {
    if (failed || !parent || !root || !log)
      throw new Error('Evidence acquisition incomplete');
    try {
      await validateBindings();
      await log.sync();
      await root.sync();
      await parent.sync();
      // A retained parent FD alone cannot prove its name still refers to it.
      // Recheck the whole chain from the independent repository anchor after IO.
      await validateBindings();
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  return {
    acquire: async (runId: string) => {
      requireLeadPhysical(
        !attempted,
        'Evidence acquisition failed; no automatic retry',
      );
      attempted = true;
      try {
        parentPath = resolve(repositoryRoot, '.cache');
        await inspectProbeAncestors(parentPath, io);
        anchor = await acquire(
          repositoryRoot,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        const anchorIdentity = await assertProbeBinding(
          anchor,
          repositoryRoot,
          io,
        );
        requireLeadPhysical(
          anchorIdentity.isDirectory() &&
            [0, io.uid].includes(anchorIdentity.uid) &&
            (anchorIdentity.mode & 0o022) === 0,
          'Trusted repository anchor required',
        );
        parentPath = `/proc/self/fd/${anchor.fd}/.cache`;
        parent = await acquire(
          parentPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        requireLeadPhysical(
          (await assertProbeBinding(parent, parentPath, io)).isDirectory(),
          'Evidence parent must be a directory',
        );
        rootPath = `/proc/self/fd/${parent.fd}/lead-physical-${runId}`;
        await io.mkdir(rootPath, 0o700);
        root = await acquire(
          rootPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        const identity = await assertProbeBinding(root, rootPath, io);
        requireLeadPhysical(
          identity.isDirectory() &&
            identity.uid === io.uid &&
            (identity.mode & 0o777) === 0o700,
          'Private evidence directory required',
        );
        log = await acquire(
          `${rootFdPath()}/controller.jsonl`,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        const actual = await assertProbeBinding(
          log,
          `${rootFdPath()}/controller.jsonl`,
          io,
        );
        requireLeadPhysical(
          actual.isFile() &&
            actual.uid === io.uid &&
            (actual.mode & 0o777) === 0o600,
          'Private evidence log required',
        );
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    record: async (value: string) => {
      if (failed || !log) throw new Error('Evidence unavailable');
      try {
        await log.appendFile(value);
        await sync();
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    snapshotPath: () => `${rootFdPath()}/supervisor.py`,
    sync,
    close: async () => {
      let closeFailed = false;
      for (const handle of handles.reverse()) {
        try {
          await handle.close();
        } catch {
          closeFailed = true;
        }
      }
      if (closeFailed) throw new Error('Evidence handle closure unverified');
    },
  };
};
