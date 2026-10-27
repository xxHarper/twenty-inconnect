import { constants } from 'node:fs';

import {
  createProbeNodePort,
  type ProbeNodeIo,
} from 'test/development/inconnect-lead-physical/probe-only/node-probe-adapter';
import { initialProbeState } from 'test/development/inconnect-lead-physical/probe-only/probe-lifecycle';
import { planProbeOnly } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';
import { runProbeWithPort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';
import {
  probeEvents,
  probeRequest,
  syntheticProgram,
} from 'test/development/inconnect-lead-physical/__tests__/probe-fixtures';

const mockedNodeIo = (
  stdout: Buffer[] = [
    Buffer.from(
      probeEvents()
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    ),
  ],
) => {
  const file = {
    fd: 9,
    stat: jest.fn(async () => ({
      isFile: () => true,
      uid: 1000,
      mode: 0o100600,
      size: syntheticProgram.length,
    })),
    read: jest.fn(async (buffer: Buffer) => {
      syntheticProgram.copy(buffer);
      return { bytesRead: buffer.length };
    }),
    appendFile: jest.fn(async () => undefined),
    sync: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const write = jest.fn(async (_value: string) => undefined);
  const io: ProbeNodeIo = {
    uid: 1000,
    lstat: jest.fn(async () => ({
      isSymbolicLink: () => false,
      mode: 0o755,
      uid: 1000,
    })),
    mkdir: jest.fn(async () => undefined),
    open: jest.fn(async () => file),
    boot: jest.fn(async () => probeRequest().bootId),
    spawn: jest.fn(() => ({
      stdout: (async function* () {
        for (const chunk of stdout) yield chunk;
      })(),
      stderr: (async function* () {})(),
      write,
      exit: Promise.resolve({ code: 0, signal: null }),
    })),
  };
  return { io, file, write };
};

describe('PHYS-P2 concrete Node adapter using mock filesystem and spawn', () => {
  it('executes a private byte snapshot rather than the mutable source descriptor', async () => {
    const { io, file } = mockedNodeIo();
    jest
      .mocked(io.open)
      .mockImplementation(async (path) =>
        path.endsWith('/supervisor.py') ? { ...file, fd: 10 } : file,
      );
    expect(
      (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
        .outcome,
    ).toBe('PASS');
    expect(file.appendFile).toHaveBeenCalledWith(syntheticProgram);
    expect(jest.mocked(io.spawn).mock.calls[0][2].stdio).toEqual([
      'pipe',
      'pipe',
      'pipe',
      10,
    ]);
    expect(
      jest
        .mocked(io.open)
        .mock.calls.some(
          ([path, flags, mode]) =>
            path.endsWith('/supervisor.py') &&
            (flags & constants.O_EXCL) !== 0 &&
            mode === 0o400,
        ),
    ).toBe(true);
  });
  it('pins a reviewed descriptor, spawns the fixed program without shell and closes handles', async () => {
    const { io, file, write } = mockedNodeIo();
    const port = createProbeNodePort(io);
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'PASS',
    );
    expect(io.spawn).toHaveBeenCalledWith(
      '/usr/bin/python3',
      ['-I', '-S', '/proc/self/fd/3', '--supervise'],
      {
        shell: false,
        env: { LANG: 'C', LC_ALL: 'C' },
        stdio: ['pipe', 'pipe', 'pipe', 9],
      },
    );
    expect(
      jest
        .mocked(io.open)
        .mock.calls.some(([, flags]) => (flags & constants.O_NOFOLLOW) !== 0),
    ).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('ACK\n');
    expect(file.sync).toHaveBeenCalled();
    await port.closeEvidence();
    expect(file.close).toHaveBeenCalled();
  });

  it.each([
    { isSymbolicLink: () => true, mode: 0o755, uid: 1000 },
    { isSymbolicLink: () => false, mode: 0o777, uid: 1000 },
    { isSymbolicLink: () => false, mode: 0o755, uid: 1001 },
  ])(
    'rejects symlink, writable or foreign ancestors %# before any spawn',
    async (observed) => {
      const { io } = mockedNodeIo();
      jest.mocked(io.lstat).mockResolvedValue(observed);
      expect(
        (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
          .outcome,
      ).toBe('UNVERIFIED');
      expect(io.spawn).not.toHaveBeenCalled();
    },
  );

  it('rejects existing evidence roots and preserves partial acquisition', async () => {
    const { io } = mockedNodeIo();
    jest.mocked(io.mkdir).mockRejectedValue(new Error('EEXIST'));
    expect(
      (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
        .outcome,
    ).toBe('UNVERIFIED');
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it('rejects missing evidence and does not launch if append/fsync fail', async () => {
    const { io, file } = mockedNodeIo();
    file.sync.mockRejectedValue(new Error('fsync failed'));
    expect(
      (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
        .outcome,
    ).toBe('UNVERIFIED');
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it.each([{ supervisorSha256: 'f'.repeat(64) }])(
    'rejects a program hash mismatch without launching',
    async (override) => {
      const { io } = mockedNodeIo();
      expect(
        (
          await runProbeWithPort(
            { ...probeRequest(), ...override },
            {},
            createProbeNodePort(io),
          )
        ).outcome,
      ).toBe('UNVERIFIED');
      expect(io.spawn).not.toHaveBeenCalled();
    },
  );

  it('handles a spawn failure without signaling foreign processes or cleanup', async () => {
    const { io } = mockedNodeIo();
    jest.mocked(io.spawn).mockImplementation(() => {
      throw new Error('spawn failed');
    });
    const result = await runProbeWithPort(
      probeRequest(),
      {},
      createProbeNodePort(io),
    );
    expect(result.outcome).toBe('UNVERIFIED');
    expect(result.resourcesPreserved).toBe(true);
  });

  it.each([Buffer.from('partial'), Buffer.alloc(65537), Buffer.from('{}\n')])(
    'rejects incomplete, oversized and corrupt protocol %#',
    async (buffer) => {
      const { io } = mockedNodeIo([buffer]);
      expect(
        (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
          .outcome,
      ).toBe('UNVERIFIED');
    },
  );

  it('uses the private pipe for cancellation and rejects session reuse', async () => {
    const { io, write } = mockedNodeIo();
    const port = createProbeNodePort(io);
    await port.record({ request: probeRequest(), state: initialProbeState() });
    const child = await port.launch(planProbeOnly(probeRequest(), {}));
    await child.requestCancel();
    expect(write).toHaveBeenLastCalledWith('CANCEL\n');
    await expect(
      port.record({
        request: {
          ...probeRequest(),
          runId: '30000000-0000-4000-8000-000000000001',
        },
        state: initialProbeState(),
      }),
    ).rejects.toThrow('cannot be reused');
    await port.closeEvidence();
  });
});
