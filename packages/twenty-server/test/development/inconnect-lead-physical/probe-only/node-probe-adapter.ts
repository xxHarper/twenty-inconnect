import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { requireLeadPhysical } from 'test/development/inconnect-lead-physical/contracts';
import {
  assertProbeBinding,
  createProbeEvidence,
  inspectProbeAncestors,
  type ProbeFile,
  type ProbeFileIo,
} from 'test/development/inconnect-lead-physical/probe-only/probe-evidence';
import { type ProbePort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';

type Child = {
  stdout: AsyncIterable<Buffer>;
  stderr: AsyncIterable<Buffer>;
  write: (value: string) => Promise<void>;
  exit: Promise<{ code: number | null; signal: string | null }>;
};
export type ProbeNodeIo = ProbeFileIo & {
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

// Explicit IO test seam. There are no native defaults and no authority tokens.
export const createProbeNodePort = (
  io: ProbeNodeIo,
): ProbePort & { closeEvidence: () => Promise<void> } => {
  const evidence = createProbeEvidence(io, repositoryRoot);
  let activeRun: string | undefined;
  let launchAttempted = false;
  return {
    currentBootId: io.boot,
    record: async ({ request, state, event }) => {
      if (!activeRun) {
        await evidence.acquire(request.runId);
        activeRun = request.runId;
      }
      requireLeadPhysical(
        activeRun === request.runId,
        'Evidence session cannot be reused',
      );
      await evidence.record(`${JSON.stringify({ request, state, event })}\n`);
    },
    launch: async (plan) => {
      requireLeadPhysical(
        !launchAttempted,
        'No automatic or repeated probe launch',
      );
      launchAttempted = true;
      requireLeadPhysical(
        activeRun === plan.request.runId,
        'Durable prelaunch evidence required',
      );
      await evidence.sync();
      await inspectProbeAncestors(programPath, io);
      const file = await io.open(
        programPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let captured: ProbeFile | undefined;
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
        // Keep the same exclusive object open. The fixed bootstrap rechecks this
        // descriptor and executes only a separately hashed, kernel-sealed memfd.
        const snapshotPath = evidence.snapshotPath();
        captured = await io.open(
          snapshotPath,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        requireLeadPhysical(
          captured.fd >= 3 && captured.fd !== file.fd,
          'Unexpected snapshot descriptor',
        );
        await captured.appendFile(program);
        await captured.sync();
        const identity = await assertProbeBinding(captured, snapshotPath, io);
        requireLeadPhysical(
          identity.isFile() &&
            identity.uid === io.uid &&
            (identity.mode & 0o777) === 0o600 &&
            identity.size === program.length,
          'Snapshot identity or size differs',
        );
        const bytes = Buffer.alloc(program.length + 1);
        const copied = await captured.read(bytes, 0, bytes.length, 0);
        requireLeadPhysical(
          copied.bytesRead === program.length &&
            createHash('sha256')
              .update(bytes.subarray(0, copied.bytesRead))
              .digest('hex') === plan.request.supervisorSha256,
          'Snapshot bytes differ',
        );
        await evidence.sync();
        await assertProbeBinding(captured, snapshotPath, io);
        const child = io.spawn(
          plan.executable,
          [
            ...plan.arguments,
            plan.request.supervisorSha256,
            String(identity.dev),
            String(identity.ino),
            String(identity.size),
          ],
          {
            shell: false,
            env: plan.environment,
            stdio: ['pipe', 'pipe', 'pipe', captured.fd],
          },
        );
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
          confirmAcquisition: async () => {
            await evidence.sync();
            await child.write('ACK\n');
          },
          exit,
        };
      } finally {
        const closed = await Promise.allSettled([
          captured?.close(),
          file.close(),
        ]);
        requireLeadPhysical(
          closed.every((result) => result.status === 'fulfilled'),
          'Program handle closure unverified',
        );
      }
    },
    closeEvidence: evidence.close,
  };
};
