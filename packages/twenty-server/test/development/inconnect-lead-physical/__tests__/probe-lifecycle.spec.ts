import { probeBootstrap } from 'test/development/inconnect-lead-physical/probe-only/probe-bootstrap';
import {
  initialProbeState,
  planProbeCleanup,
  reduceProbeEvent,
} from 'test/development/inconnect-lead-physical/probe-only/probe-lifecycle';
import { planPinnedProbeTermination } from 'test/development/inconnect-lead-physical/probe-only/probe-ownership';
import { planProbeOnly } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';
import { runProbeWithPort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';
import {
  probeEvents,
  probeRequest,
  simulatedProbePort,
} from 'test/development/inconnect-lead-physical/__tests__/probe-fixtures';

describe('PHYS-P2 PROBE_ONLY protocol with simulated IO', () => {
  it('never acknowledges acquisition without durable before evidence', async () => {
    const { port, confirmAcquisition } = simulatedProbePort();
    port.record = jest.fn(async (entry) => {
      if (entry.state.phase === 'ACQUIRED') throw new Error('Persistence lost');
    });
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'UNVERIFIED',
    );
    expect(confirmAcquisition).not.toHaveBeenCalled();
    const events = probeEvents();
    delete events[1].before;
    const missing = simulatedProbePort(events);
    expect(
      (await runProbeWithPort(probeRequest(), {}, missing.port)).outcome,
    ).toBe('UNVERIFIED');
    expect(missing.confirmAcquisition).not.toHaveBeenCalled();
  });
  it.each([
    'POSTGRES_INIT',
    'POSTGRES_CONNECT',
    'FIXTURE_AND_TESTS',
    'initdb',
    'sh',
  ])('rejects capability %s without any IO', async (capability) => {
    const { port } = simulatedProbePort();
    await expect(
      runProbeWithPort({ ...probeRequest(), capability }, {}, port),
    ).rejects.toThrow();
    expect(port.currentBootId).not.toHaveBeenCalled();
    expect(port.launch).not.toHaveBeenCalled();
  });

  it.each([
    { probe: '/bin/sh' },
    { command: 'anything' },
    { force: true },
    { resourceRoot: '/tmp/other' },
    { resourceRoot: '/tmp/$(injected)' },
    { memoryMiB: 1024 },
    { deadlineSeconds: 0 },
  ])('rejects command/configuration expansion %#', (override) => {
    expect(() =>
      planProbeOnly({ ...probeRequest(), ...override }, {}),
    ).toThrow();
  });

  it.each([
    'PG_DATABASE_URL',
    'PG_DATABASE_REPLICA_URL',
    'REDIS_URL',
    'REDIS_QUEUE_URL',
    'NODE_OPTIONS',
    'HOME',
    'PATH',
  ])('rejects inherited %s', (key) => {
    expect(() => planProbeOnly(probeRequest(), { [key]: '' })).toThrow();
  });

  it('builds only fixed isolated Python controller arguments and no next-phase grant', () => {
    const plan = planProbeOnly(probeRequest(), {});
    expect(plan.executable).toBe('/usr/bin/python3');
    expect(plan.arguments).toEqual(['-I', '-S', '-c', probeBootstrap]);
    expect(plan.shell).toBe(false);
    expect(plan.environment).toEqual({ LANG: 'C', LC_ALL: 'C' });
    expect(plan.nextCapabilities).toEqual([]);
    expect(plan.physicalExecution).toBe('BLOCKED');
  });

  it('accepts the simulated normal transcript while preserving all resources', async () => {
    const { port } = simulatedProbePort();
    const result = await runProbeWithPort(probeRequest(), {}, port);
    expect(result.outcome).toBe('PASS');
    expect(planProbeCleanup(result)).toEqual({
      removePaths: [],
      numericPidSignals: [],
      preserveResources: true,
      closureVerified: true,
    });
  });

  it.each(['TIMEOUT', 'CANCELLED', 'INTERRUPTED'] as const)(
    'verifies expected %s only after full closure evidence',
    async (cause) => {
      const { port } = simulatedProbePort(probeEvents(cause));
      const request = {
        ...probeRequest(),
        probe: 'LIFECYCLE_WAIT',
        expectedTermination: cause,
      };
      expect((await runProbeWithPort(request, {}, port)).outcome).toBe('PASS');
    },
  );

  it('reports verified unexpected termination as FAIL', async () => {
    const { port } = simulatedProbePort(probeEvents('TIMEOUT'));
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'FAIL',
    );
  });

  it.each([
    'supervisorExited',
    'treeEmpty',
    'hostUnchanged',
    'evidenceComplete',
  ] as const)(
    'does not substitute supervisor exit for missing %s',
    async (field) => {
      const events = probeEvents();
      events[5][field] = false;
      const { port } = simulatedProbePort(events);
      expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
        'UNVERIFIED',
      );
    },
  );

  it('reports verified boundary failure as FAIL', async () => {
    const events = probeEvents();
    events[5].boundaryPassed = false;
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          simulatedProbePort(events).port,
        )
      ).outcome,
    ).toBe('FAIL');
  });

  it.each([0, 1, 2, 3, 4])(
    'preserves resources after acquisition/process/evidence loss at step %s',
    async (count) => {
      const { port } = simulatedProbePort(probeEvents().slice(0, count));
      const result = await runProbeWithPort(probeRequest(), {}, port);
      expect(result.outcome).toBe('UNVERIFIED');
      expect(planProbeCleanup(result).removePaths).toEqual([]);
    },
  );

  it('handles a partial acquisition error without claiming empty resources', async () => {
    const events = probeEvents();
    const partial = [
      events[0],
      { ...events[1], kind: 'PARTIAL_FAILURE' },
      { ...events[5], sequence: 3, evidenceComplete: false, treeEmpty: false },
    ];
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          simulatedProbePort(partial).port,
        )
      ).outcome,
    ).toBe('UNVERIFIED');
  });

  it('does not launch after missing kernel capability or evidence persistence failure', async () => {
    const { port } = simulatedProbePort();
    jest
      .mocked(port.record)
      .mockRejectedValue(new Error('Evidence unavailable'));
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'UNVERIFIED',
    );
    expect(port.launch).not.toHaveBeenCalled();
    const other = simulatedProbePort().port;
    jest
      .mocked(other.launch)
      .mockRejectedValue(new Error('pidfd/namespaces unavailable'));
    expect((await runProbeWithPort(probeRequest(), {}, other)).outcome).toBe(
      'UNVERIFIED',
    );
  });

  it('stops on reboot and never silently starts another session', async () => {
    const { port } = simulatedProbePort();
    jest
      .mocked(port.currentBootId)
      .mockResolvedValue('30000000-0000-4000-8000-000000000001');
    expect((await runProbeWithPort(probeRequest(), {}, port)).outcome).toBe(
      'UNVERIFIED',
    );
    expect(port.launch).not.toHaveBeenCalled();
    const active = simulatedProbePort().port;
    jest
      .mocked(active.currentBootId)
      .mockResolvedValueOnce(probeRequest().bootId)
      .mockResolvedValue('30000000-0000-4000-8000-000000000001');
    expect((await runProbeWithPort(probeRequest(), {}, active)).outcome).toBe(
      'UNVERIFIED',
    );
    expect(active.launch).toHaveBeenCalledTimes(1);
  });

  it('rejects reordered, duplicated, cross-run and incomplete evidence', async () => {
    for (const override of [
      { sequence: 8 },
      { runId: '30000000-0000-4000-8000-000000000001' },
      { bootId: '30000000-0000-4000-8000-000000000001' },
      { extra: true },
    ]) {
      const events = probeEvents();
      Object.assign(events[3], override);
      expect(
        (
          await runProbeWithPort(
            probeRequest(),
            {},
            simulatedProbePort(events).port,
          )
        ).outcome,
      ).toBe('UNVERIFIED');
    }
    expect(() =>
      reduceProbeEvent(probeRequest(), initialProbeState(), probeEvents()[5]),
    ).toThrow();
  });

  it('routes cancellation only through the owned control pipe and awaits failures', async () => {
    const controller = new AbortController();
    const { port, requestCancel } = simulatedProbePort();
    const originalRecord = port.record;
    port.record = async (entry) => {
      await originalRecord(entry);
      if (entry.state.phase === 'RUNNING') controller.abort();
    };
    requestCancel.mockRejectedValue(new Error('Owned control pipe lost'));
    expect(
      (await runProbeWithPort(probeRequest(), {}, port, controller.signal))
        .outcome,
    ).toBe('UNVERIFIED');
    expect(requestCancel).toHaveBeenCalledTimes(1);
    const cancelled = new AbortController();
    cancelled.abort();
    const before = simulatedProbePort().port;
    expect(
      (await runProbeWithPort(probeRequest(), {}, before, cancelled.signal))
        .outcome,
    ).toBe('UNVERIFIED');
    expect(before.launch).not.toHaveBeenCalled();
  });

  it('keeps supervisor loss unverified; recovery cannot authorize signals or deletion', async () => {
    const events = probeEvents().slice(0, 4);
    events.push({ ...probeEvents()[4], kind: 'SUPERVISOR_LOST' });
    const lost = await runProbeWithPort(
      probeRequest(),
      {},
      simulatedProbePort(events).port,
    );
    expect(lost.outcome).toBe('UNVERIFIED');
    expect(planProbeCleanup(lost).closureVerified).toBe(false);
    events.push({ ...probeEvents()[5], kind: 'RECOVERING', sequence: 6 });
    events.push({ ...probeEvents()[5], sequence: 7, treeEmpty: false });
    expect(
      (
        await runProbeWithPort(
          probeRequest(),
          {},
          simulatedProbePort(events).port,
        )
      ).outcome,
    ).toBe('UNVERIFIED');
  });

  it('rejects PID reuse, exec drift, namespaces, boot/session and missing pidfd lease', () => {
    const pin = {
      runId: probeRequest().runId,
      bootId: probeRequest().bootId,
      pid: 100,
      startTicks: '1',
      executable: '/usr/bin/bwrap',
      executableSha256: 'a'.repeat(64),
      namespaces: {
        user: 'user:[1]',
        network: 'net:[2]',
        mount: 'mnt:[3]',
        process: 'pid:[4]',
      },
      pidfdLease: 'b'.repeat(64),
    };
    expect(planPinnedProbeTermination(pin, pin).physicalExecution).toBe(
      'BLOCKED',
    );
    for (const override of [
      { startTicks: '2' },
      { pid: 101 },
      { executableSha256: 'c'.repeat(64) },
      { runId: '30000000-0000-4000-8000-000000000001' },
      { bootId: '30000000-0000-4000-8000-000000000001' },
      { pidfdLease: undefined },
      { namespaces: { ...pin.namespaces, network: 'net:[99]' } },
    ]) {
      expect(() =>
        planPinnedProbeTermination(pin, { ...pin, ...override }),
      ).toThrow();
    }
  });
});
