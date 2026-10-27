import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

import { requireLeadPhysical } from 'test/development/inconnect-lead-physical/contracts';
import { type ProbePort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';

type File = {
  fd: number;
  stat: () => Promise<{
    isFile: () => boolean;
    uid: number;
    mode: number;
    size: number;
  }>;
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
type Child = {
  stdout: AsyncIterable<Buffer>;
  stderr: AsyncIterable<Buffer>;
  write: (value: string) => Promise<void>;
  exit: Promise<{ code: number | null; signal: string | null }>;
};
export type ProbeNodeIo = {
  uid: number;
  lstat: (
    path: string,
  ) => Promise<{ isSymbolicLink: () => boolean; mode: number; uid: number }>;
  mkdir: (path: string, mode: number) => Promise<void>;
  open: (path: string, flags: number, mode?: number) => Promise<File>;
  boot: () => Promise<string>;
  spawn: (
    executable: string,
    arguments_: readonly string[],
    options: {
      shell: false;
      env: Readonly<Record<string, string>>;
      stdio: readonly ['pipe', 'pipe', 'pipe', number];
    },
  ) => Child;
};

const programPath = resolve(__dirname, 'probe-supervisor.py');
const repositoryRoot = resolve(__dirname, '../../../../../..');

const inspectAncestors = async (path: string, io: ProbeNodeIo) => {
  const segments = path.split(sep).filter(Boolean);
  let current = '';
  for (const segment of segments) {
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

// Explicit IO test seam. There are no native defaults and no authority tokens.
export const createProbeNodePort = (
  io: ProbeNodeIo,
): ProbePort & { closeEvidence: () => Promise<void> } => {
  let evidence: File | undefined;
  let activeRun: string | undefined;
  let evidenceRoot: string | undefined;
  let acquisitionAttempted = false;
  let launchAttempted = false;
  return {
    currentBootId: io.boot,
    record: async ({ request, state, event }) => {
      if (!evidence) {
        requireLeadPhysical(
          !acquisitionAttempted,
          'Evidence acquisition failed; no automatic retry',
        );
        acquisitionAttempted = true;
        const parent = resolve(repositoryRoot, '.cache');
        await inspectAncestors(parent, io);
        const root = resolve(parent, `lead-physical-${request.runId}`);
        await io.mkdir(root, 0o700);
        await inspectAncestors(root, io);
        evidence = await io.open(
          resolve(root, 'controller.jsonl'),
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        activeRun = request.runId;
        evidenceRoot = root;
      }
      requireLeadPhysical(
        activeRun === request.runId,
        'Evidence session cannot be reused',
      );
      await evidence.appendFile(
        `${JSON.stringify({ request, state, event })}\n`,
      );
      await evidence.sync();
    },
    launch: async (plan) => {
      requireLeadPhysical(
        !launchAttempted,
        'No automatic or repeated probe launch',
      );
      launchAttempted = true;
      requireLeadPhysical(
        activeRun === plan.request.runId &&
          evidence !== undefined &&
          evidenceRoot !== undefined,
        'Durable prelaunch evidence required',
      );
      await inspectAncestors(programPath, io);
      const file = await io.open(
        programPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let captured: File | undefined;
      try {
        const actual = await file.stat();
        requireLeadPhysical(
          actual.isFile() &&
            actual.size > 0 &&
            actual.size <= 131072 &&
            (actual.mode & 0o022) === 0 &&
            [0, io.uid].includes(actual.uid),
          'Untrusted supervisor program',
        );
        const program = Buffer.alloc(actual.size);
        const result = await file.read(program, 0, program.length, 0);
        requireLeadPhysical(
          result.bytesRead === program.length &&
            createHash('sha256').update(program).digest('hex') ===
              plan.request.supervisorSha256,
          'Supervisor differs from reviewed artifact',
        );
        // A descriptor alone pins the inode, not its bytes. Execute a private
        // snapshot so later edits of the source cannot change the reviewed code.
        if (evidenceRoot === undefined)
          throw new Error('Missing private evidence root');
        const snapshotPath = resolve(evidenceRoot, 'supervisor.py');
        const writer = await io.open(
          snapshotPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o400,
        );
        try {
          await writer.appendFile(program);
          await writer.sync();
        } finally {
          await writer.close();
        }
        captured = await io.open(
          snapshotPath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const child = io.spawn(plan.executable, plan.arguments, {
          shell: false,
          env: plan.environment,
          stdio: ['pipe', 'pipe', 'pipe', captured.fd],
        });
        void child.exit.catch(() => undefined);
        // Only a private control pipe is used. Node never sends PID-number signals.
        await child.write(`${JSON.stringify(plan.request)}\n`);
        const stderr = (async () => {
          let length = 0;
          for await (const chunk of child.stderr) {
            length += chunk.length;
            if (length > plan.protocolLimitBytes)
              throw new Error('Probe stderr bound exceeded');
          }
        })();
        // Attach rejection handling immediately; an output error stays UNVERIFIED.
        const exit = Promise.all([child.exit, stderr]).then(
          ([status]) => status,
        );
        void exit.catch(() => undefined);
        const events = (async function* () {
          let buffered = '';
          let bytes = 0;
          for await (const chunk of child.stdout) {
            bytes += chunk.length;
            requireLeadPhysical(
              bytes <= plan.protocolLimitBytes,
              'Probe protocol bound exceeded',
            );
            buffered += chunk.toString('utf8');
            let newline: number;
            while ((newline = buffered.indexOf('\n')) >= 0) {
              const line = buffered.slice(0, newline);
              buffered = buffered.slice(newline + 1);
              yield JSON.parse(line) as unknown;
            }
          }
          requireLeadPhysical(
            buffered.length === 0,
            'Incomplete probe evidence',
          );
        })();
        return {
          events,
          requestCancel: () => child.write('CANCEL\n'),
          confirmAcquisition: () => child.write('ACK\n'),
          exit,
        };
      } finally {
        await captured?.close();
        await file.close();
      }
    },
    closeEvidence: async () => {
      await evidence?.close();
    },
  };
};
