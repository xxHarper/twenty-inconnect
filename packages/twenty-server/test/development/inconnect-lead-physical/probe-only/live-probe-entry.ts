import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';

import { createProbeNodePort } from 'test/development/inconnect-lead-physical/probe-only/node-probe-adapter';
import { requireProbePhysicalAuthorization } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';
import { runProbeWithPort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';

// No CLI registration, argv/env access or IO occurs at import time. This is the
// only native binding; it remains unconditionally gated throughout PHYS-P2.
export const runLiveProbeOnly = async (
  input: unknown,
  cancellation?: AbortSignal,
) => {
  requireProbePhysicalAuthorization();
  const port = createProbeNodePort({
    uid: process.getuid?.() ?? -1,
    lstat,
    mkdir: async (path, mode) => {
      await mkdir(path, { mode, recursive: false });
    },
    open,
    boot: async () =>
      (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
    spawn: (executable, arguments_, options) => {
      const child = spawn(executable, [...arguments_], {
        shell: options.shell,
        env: options.env,
        stdio: [...options.stdio],
      });
      if (!child.stdout || !child.stderr || !child.stdin)
        throw new Error('Private probe pipes required');
      const inputPipe = child.stdin;
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        write: (value) =>
          new Promise<void>((resolve, reject) => {
            inputPipe.write(value, (error) =>
              error
                ? reject(new Error('Probe control unavailable'))
                : resolve(),
            );
          }),
        exit: new Promise((resolve, reject) => {
          child.once('error', () =>
            reject(new Error('Probe controller unavailable')),
          );
          child.once('close', (code, signal) => resolve({ code, signal }));
        }),
      };
    },
  });
  try {
    return await runProbeWithPort(input, {}, port, cancellation);
  } finally {
    await port.closeEvidence();
  }
};
