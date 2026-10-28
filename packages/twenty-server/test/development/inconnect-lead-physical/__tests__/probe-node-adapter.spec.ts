import { constants } from 'node:fs';

import { createProbeNodePort } from 'test/development/inconnect-lead-physical/probe-only/node-probe-adapter';
import { probeBootstrap } from 'test/development/inconnect-lead-physical/probe-only/probe-bootstrap';
import { initialProbeState } from 'test/development/inconnect-lead-physical/probe-only/probe-lifecycle';
import { planProbeOnly } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';
import { runProbeWithPort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';
import {
  probeRequest,
  syntheticProgram,
} from 'test/development/inconnect-lead-physical/__tests__/probe-fixtures';
import { mockedNodeIo } from 'test/development/inconnect-lead-physical/__tests__/probe-node-fixtures';

describe('PHYS-P2 Node adapter, all filesystem/process IO simulated', () => {
  const lateAcquisitionCheckpoint = () => {
    const fixture = mockedNodeIo();
    let acquiredRecord = false;
    let checkpoints = 0;
    let reached = false;
    const append = fixture.log.appendFile.getMockImplementation()!;
    fixture.log.appendFile.mockImplementation(async (value) => {
      await append(value);
      acquiredRecord =
        typeof value === 'string' &&
        JSON.parse(value).event?.kind === 'ACQUIRED';
    });
    const sync = fixture.parent.sync.getMockImplementation()!;
    fixture.parent.sync.mockImplementation(async () => {
      await sync();
      if (acquiredRecord && ++checkpoints === 2) reached = true;
    });
    return { ...fixture, checkpoint: () => ({ reached, checkpoints }) };
  };

  it.each(['parent', 'log'] as const)(
    'B2-R1: rejects named %s replacement after final fsync, before ACK',
    async (target) => {
      const fixture = lateAcquisitionCheckpoint();
      const lstat = fixture.io.lstat;
      fixture.io.lstat = jest.fn(async (path) => {
        const named = await lstat(path);
        const attacked =
          target === 'parent'
            ? path.endsWith('/.cache')
            : path.endsWith('/controller.jsonl');
        return fixture.checkpoint().reached && attacked
          ? { ...named, ino: 999 }
          : named;
      });
      const port = createProbeNodePort(fixture.io);
      const result = await runProbeWithPort(probeRequest(), {}, port);
      const finalSync = fixture.operations.lastIndexOf('sync:parent');
      expect({
        ...fixture.checkpoint(),
        durableSequence: fixture.operations.slice(finalSync - 2, finalSync + 1),
        controllerSpawns: jest.mocked(fixture.io.spawn).mock.calls.length,
        ackSent: fixture.write.mock.calls.some(([value]) => value === 'ACK\n'),
        goSent: fixture.write.mock.calls.some(([value]) => value === 'GO\n'),
        workloadContinuation: fixture.log.appendFile.mock.calls.some(
          ([value]) =>
            typeof value === 'string' &&
            JSON.parse(value).event?.kind === 'LAUNCHING',
        ),
        outcome: result.outcome,
      }).toEqual({
        reached: true,
        checkpoints: 2,
        durableSequence: ['sync:log', 'sync:root', 'sync:parent'],
        controllerSpawns: 1,
        ackSent: false,
        goSent: false,
        workloadContinuation: false,
        outcome: 'UNVERIFIED',
      });
      // The controller already exists; the unchanged Python barrier needs ACK
      // before it can authorize any workload. Retained objects stay unchanged.
      expect(fixture.parent.identity.ino).toBe(100);
      expect(fixture.root.identity.ino).toBe(101);
      expect(fixture.log.identity.ino).toBe(102);
      await expect(
        port.record({ request: probeRequest(), state: initialProbeState() }),
      ).rejects.toThrow();
      await expect(
        port.launch(planProbeOnly(probeRequest(), {})),
      ).rejects.toThrow();
      await port.closeEvidence();
    },
  );

  it('B2-R1: a valid final checkpoint still reaches ACK and continuation', async () => {
    const fixture = lateAcquisitionCheckpoint();
    const port = createProbeNodePort(fixture.io);
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'PASS',
    );
    expect(fixture.checkpoint()).toEqual({ reached: true, checkpoints: 2 });
    expect(fixture.write).toHaveBeenCalledWith('ACK\n');
    expect(fixture.io.open).toHaveBeenCalledWith(
      '/proc/self/fd/3/.cache',
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      undefined,
    );
    await port.closeEvidence();
    expect(fixture.anchor.close).toHaveBeenCalled();
  });

  it.each(['anchor', 'parent', 'root', 'log'] as const)(
    'B2-R1: refuses ACK if final %s validation cannot complete',
    async (target) => {
      const fixture = lateAcquisitionCheckpoint();
      const lstat = fixture.io.lstat;
      fixture.io.lstat = jest.fn(async (path) => {
        const named = await lstat(path);
        const matches =
          target === 'anchor'
            ? path === jest.mocked(fixture.io.open).mock.calls[0]?.[0]
            : target === 'parent'
              ? path.endsWith('/.cache')
              : target === 'root'
                ? path.includes('/lead-physical-')
                : path.endsWith('/controller.jsonl');
        if (fixture.checkpoint().reached && matches)
          throw new Error('Final binding unavailable');
        return named;
      });
      const port = createProbeNodePort(fixture.io);
      expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
        'UNVERIFIED',
      );
      expect(fixture.checkpoint()).toEqual({ reached: true, checkpoints: 2 });
      expect(fixture.io.spawn).toHaveBeenCalledTimes(1);
      expect(fixture.write).not.toHaveBeenCalledWith('ACK\n');
      await port.closeEvidence();
    },
  );

  it.each(['symlink', 'owner', 'permissions', 'type'] as const)(
    'B2-R1: rejects log %s drift during the final fsync',
    async (attack) => {
      const fixture = lateAcquisitionCheckpoint();
      const lstat = fixture.io.lstat;
      fixture.io.lstat = jest.fn(async (path) => {
        const named = await lstat(path);
        if (
          !fixture.checkpoint().reached ||
          !path.endsWith('/controller.jsonl')
        )
          return named;
        return {
          ...named,
          uid: attack === 'owner' ? 1001 : named.uid,
          mode:
            attack === 'permissions'
              ? 0o100640
              : attack === 'type'
                ? 0o40700
                : named.mode,
          isSymbolicLink: () => attack === 'symlink',
          isDirectory: () => attack === 'type',
          isFile: () => attack !== 'type',
        };
      });
      const port = createProbeNodePort(fixture.io);
      expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
        'UNVERIFIED',
      );
      expect(fixture.checkpoint()).toEqual({ reached: true, checkpoints: 2 });
      expect(fixture.write).not.toHaveBeenCalledWith('ACK\n');
      await port.closeEvidence();
    },
  );

  it('B2-R1: direct confirmAcquisition also revalidates and permanently invalidates a mismatch', async () => {
    const fixture = mockedNodeIo();
    const port = createProbeNodePort(fixture.io);
    await port.record({ request: probeRequest(), state: initialProbeState() });
    const child = await port.launch(planProbeOnly(probeRequest(), {}));
    const lstat = fixture.io.lstat;
    fixture.io.lstat = jest.fn(async (path) => {
      const named = await lstat(path);
      return path.endsWith('/controller.jsonl')
        ? { ...named, ino: 999 }
        : named;
    });
    await expect(child.confirmAcquisition()).rejects.toThrow();
    fixture.io.lstat = lstat;
    await expect(child.confirmAcquisition()).rejects.toThrow();
    expect(fixture.write).not.toHaveBeenCalledWith('ACK\n');
    await port.closeEvidence();
  });

  it('hands off the same exclusive snapshot FD to the fixed sealing bootstrap', async () => {
    const { io, snapshot, write } = mockedNodeIo();
    const port = createProbeNodePort(io);
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'PASS',
    );
    expect(snapshot.appendFile).toHaveBeenCalledWith(syntheticProgram);
    expect(snapshot.read).toHaveBeenCalled();
    const opens = jest
      .mocked(io.open)
      .mock.calls.filter(([path]) => path.endsWith('/supervisor.py'));
    expect(opens).toHaveLength(1);
    expect(opens[0].slice(1)).toEqual([
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    ]);
    expect(io.spawn).toHaveBeenCalledWith(
      '/usr/bin/python3',
      [
        '-I',
        '-S',
        '-c',
        probeBootstrap,
        probeRequest().supervisorSha256,
        '1',
        '104',
        String(syntheticProgram.length),
      ],
      {
        shell: false,
        env: { LANG: 'C', LC_ALL: 'C' },
        stdio: ['pipe', 'pipe', 'pipe', 8],
      },
    );
    expect(write).toHaveBeenLastCalledWith('ACK\n');
    await port.closeEvidence();
    expect(snapshot.close).toHaveBeenCalled();
  });

  it('original B1 attack: a different regular file on reopen is never consumed', async () => {
    const { io, snapshot } = mockedNodeIo();
    const original = io.open;
    const substituted = { ...snapshot, fd: 44 };
    io.open = jest.fn(async (path, flags, mode) =>
      path.endsWith('/supervisor.py') && !(flags & constants.O_EXCL)
        ? substituted
        : original(path, flags, mode),
    );
    await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io));
    expect(jest.mocked(io.spawn).mock.calls[0][2].stdio[3]).toBe(snapshot.fd);
    expect(
      jest
        .mocked(io.open)
        .mock.calls.filter(([path]) => path.endsWith('/supervisor.py')),
    ).toHaveLength(1);
  });

  it.each(['inode', 'symlink', 'bytes', 'truncated', 'descriptor'] as const)(
    'rejects snapshot %s before controller spawn',
    async (attack) => {
      const fixture = mockedNodeIo();
      if (attack === 'inode' || attack === 'symlink') {
        const lstat = fixture.io.lstat;
        fixture.io.lstat = jest.fn(async (path) => {
          const value = await lstat(path);
          return path.endsWith('/supervisor.py')
            ? {
                ...value,
                ino: attack === 'inode' ? 999 : value.ino,
                isSymbolicLink: () => attack === 'symlink',
              }
            : value;
        });
      }
      if (attack === 'bytes')
        fixture.snapshot.read.mockImplementation(async (buffer) => {
          buffer.fill(0);
          return { bytesRead: syntheticProgram.length };
        });
      if (attack === 'truncated') fixture.snapshot.identity.size--;
      if (attack === 'descriptor') fixture.snapshot.fd = fixture.source.fd;
      expect(
        (
          await runProbeWithPort(
            probeRequest(),
            {},
            createProbeNodePort(fixture.io),
          )
        ).outcome,
      ).toBe('UNVERIFIED');
      expect(fixture.io.spawn).not.toHaveBeenCalled();
      expect(fixture.snapshot.close).toHaveBeenCalled();
      expect(fixture.source.close).toHaveBeenCalled();
    },
  );

  it('original B2 attack: file fsync alone cannot reach ACK or spawn', async () => {
    const { io, root, write } = mockedNodeIo();
    root.sync.mockRejectedValue(new Error('Directory sync unavailable'));
    expect(
      (await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io)))
        .outcome,
    ).toBe('UNVERIFIED');
    expect(write).not.toHaveBeenCalled();
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it('orders log fsync, log directory fsync and parent fsync before spawn and ACK', async () => {
    const { io, operations } = mockedNodeIo();
    await runProbeWithPort(probeRequest(), {}, createProbeNodePort(io));
    for (const boundary of ['spawn', 'control:ACK']) {
      const index = operations.indexOf(boundary);
      expect(index).toBeGreaterThan(0);
      expect(operations.slice(index - 3, index)).toEqual([
        'sync:log',
        'sync:root',
        'sync:parent',
      ]);
    }
    expect(operations.indexOf('sync:snapshot')).toBeLessThan(
      operations.indexOf('spawn'),
    );
  });

  it.each(['log', 'root', 'parent'] as const)(
    'blocks launch and all retries on %s fsync failure',
    async (name) => {
      const fixture = mockedNodeIo();
      fixture[name].sync.mockRejectedValue(new Error('fsync failed'));
      const port = createProbeNodePort(fixture.io);
      expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
        'UNVERIFIED',
      );
      await expect(
        port.launch(planProbeOnly(probeRequest(), {})),
      ).rejects.toThrow();
      expect(fixture.io.spawn).not.toHaveBeenCalled();
      await port.closeEvidence();
    },
  );

  it('refuses ACK when directory fsync fails on acquired evidence', async () => {
    const fixture = mockedNodeIo();
    fixture.root.sync
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Acquired sync failed'));
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          createProbeNodePort(fixture.io),
        )
      ).outcome,
    ).toBe('UNVERIFIED');
    expect(fixture.write).not.toHaveBeenCalledWith('ACK\n');
  });

  it.each(['inode', 'symlink'] as const)(
    'rejects evidence directory %s substitution',
    async (attack) => {
      const fixture = mockedNodeIo();
      const lstat = fixture.io.lstat;
      fixture.io.lstat = jest.fn(async (path) => {
        const value = await lstat(path);
        return path.includes('/lead-physical-')
          ? {
              ...value,
              ino: attack === 'inode' ? 999 : value.ino,
              isSymbolicLink: () => attack === 'symlink',
            }
          : value;
      });
      expect(
        (
          await runProbeWithPort(
            probeRequest(),
            {},
            createProbeNodePort(fixture.io),
          )
        ).outcome,
      ).toBe('UNVERIFIED');
      expect(fixture.io.spawn).not.toHaveBeenCalled();
    },
  );

  it.each([0o777, 0o775])('rejects writable ancestors %s', async (mode) => {
    const fixture = mockedNodeIo();
    jest.mocked(fixture.io.lstat).mockResolvedValue({
      ...fixture.parent.identity,
      mode,
      isSymbolicLink: () => false,
    });
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          createProbeNodePort(fixture.io),
        )
      ).outcome,
    ).toBe('UNVERIFIED');
    expect(fixture.io.spawn).not.toHaveBeenCalled();
  });

  it.each(['symlink', 'foreign'] as const)(
    'rejects %s ancestors before any spawn',
    async (attack) => {
      const fixture = mockedNodeIo();
      jest.mocked(fixture.io.lstat).mockResolvedValue({
        ...fixture.parent.identity,
        uid: attack === 'foreign' ? 1001 : 1000,
        isSymbolicLink: () => attack === 'symlink',
      });
      await runProbeWithPort(
        probeRequest(),
        {},
        createProbeNodePort(fixture.io),
      );
      expect(fixture.io.spawn).not.toHaveBeenCalled();
    },
  );

  it('preserves existing evidence roots and closes partially acquired handles', async () => {
    const fixture = mockedNodeIo();
    jest.mocked(fixture.io.mkdir).mockRejectedValue(new Error('EEXIST'));
    const port = createProbeNodePort(fixture.io);
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'UNVERIFIED',
    );
    expect(fixture.io.spawn).not.toHaveBeenCalled();
    await port.closeEvidence();
    expect(fixture.parent.close).toHaveBeenCalled();
  });

  it('rejects source hash mismatch without spawning', async () => {
    const fixture = mockedNodeIo();
    expect(
      (
        await runProbeWithPort(
          { ...probeRequest(), supervisorSha256: 'f'.repeat(64) },
          {},
          createProbeNodePort(fixture.io),
        )
      ).outcome,
    ).toBe('UNVERIFIED');
    expect(fixture.io.spawn).not.toHaveBeenCalled();
  });

  it('handles spawn failure and closes both program handles', async () => {
    const fixture = mockedNodeIo();
    jest.mocked(fixture.io.spawn).mockImplementation(() => {
      throw new Error('spawn failed');
    });
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          createProbeNodePort(fixture.io),
        )
      ).outcome,
    ).toBe('UNVERIFIED');
    expect(fixture.snapshot.close).toHaveBeenCalled();
    expect(fixture.source.close).toHaveBeenCalled();
  });

  it('propagates snapshot close failure and still closes the source', async () => {
    const fixture = mockedNodeIo();
    fixture.snapshot.close.mockRejectedValue(new Error('close failed'));
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          createProbeNodePort(fixture.io),
        )
      ).outcome,
    ).toBe('UNVERIFIED');
    expect(fixture.source.close).toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalledWith('ACK\n');
  });

  it('attempts all evidence closes even when one fails', async () => {
    const fixture = mockedNodeIo();
    const port = createProbeNodePort(fixture.io);
    await port.record({ request: probeRequest(), state: initialProbeState() });
    fixture.log.close.mockRejectedValue(new Error('close failed'));
    await expect(port.closeEvidence()).rejects.toThrow('closure unverified');
    expect(fixture.root.close).toHaveBeenCalled();
    expect(fixture.parent.close).toHaveBeenCalled();
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

  it('cancels via private pipe and rejects session reuse', async () => {
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
