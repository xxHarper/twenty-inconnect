import { type ProbeNodeIo } from 'test/development/inconnect-lead-physical/probe-only/node-probe-adapter';
import { type ProbeStat } from 'test/development/inconnect-lead-physical/probe-only/probe-evidence';
import {
  probeEvents,
  probeRequest,
  syntheticProgram,
} from 'test/development/inconnect-lead-physical/__tests__/probe-fixtures';

export const mockedNodeIo = (
  stdout: Buffer[] = [
    Buffer.from(
      probeEvents()
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    ),
  ],
) => {
  const operations: string[] = [];
  const handle = (
    name: string,
    fd: number,
    ino: number,
    directory: boolean,
    mode: number,
  ) => {
    const identity: ProbeStat = {
      isFile: () => !directory,
      isDirectory: () => directory,
      uid: 1000,
      mode,
      size: directory ? 0 : syntheticProgram.length,
      dev: 1,
      ino,
    };
    return {
      fd,
      identity,
      stat: jest.fn(async () => ({ ...identity })),
      read: jest.fn(async (buffer: Buffer) => {
        syntheticProgram.copy(buffer);
        return { bytesRead: Math.min(buffer.length, syntheticProgram.length) };
      }),
      appendFile: jest.fn(async (_value: string | Uint8Array) => {
        operations.push(`append:${name}`);
      }),
      sync: jest.fn(async () => {
        operations.push(`sync:${name}`);
      }),
      close: jest.fn(async () => {
        operations.push(`close:${name}`);
      }),
    };
  };
  const anchor = handle('anchor', 3, 99, true, 0o40755);
  const parent = handle('parent', 4, 100, true, 0o40755);
  const root = handle('root', 5, 101, true, 0o40700);
  const log = handle('log', 6, 102, false, 0o100600);
  const source = handle('source', 7, 103, false, 0o100600);
  const snapshot = handle('snapshot', 8, 104, false, 0o100600);
  const forPath = (path: string) =>
    path.endsWith('/controller.jsonl')
      ? log
      : path.endsWith('/probe-supervisor.py')
        ? source
        : path.endsWith('/supervisor.py')
          ? snapshot
          : path.includes('/lead-physical-')
            ? root
            : path.endsWith('/.cache')
              ? parent
              : anchor;
  const write = jest.fn(async (value: string) => {
    operations.push(`control:${value.trim()}`);
  });
  const io: ProbeNodeIo = {
    uid: 1000,
    lstat: jest.fn(async (path) => ({
      ...forPath(path).identity,
      isSymbolicLink: () => false,
    })),
    mkdir: jest.fn(async () => {
      operations.push('mkdir');
    }),
    open: jest.fn(async (path, _flags, _mode) => {
      operations.push(`open:${path}`);
      return forPath(path);
    }),
    boot: jest.fn(async () => probeRequest().bootId),
    spawn: jest.fn(() => {
      operations.push('spawn');
      return {
        stdout: (async function* () {
          for (const chunk of stdout) yield chunk;
        })(),
        stderr: (async function* () {})(),
        write,
        exit: Promise.resolve({ code: 0, signal: null }),
      };
    }),
  };
  return { io, operations, write, anchor, parent, root, log, source, snapshot };
};
