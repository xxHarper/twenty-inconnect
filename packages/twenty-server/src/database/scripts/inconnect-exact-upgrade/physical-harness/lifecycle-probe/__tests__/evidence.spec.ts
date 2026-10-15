import { createHash } from 'node:crypto';

import {
  completedHelper,
  evidenceTarget,
  finalizationActions,
  finalizationInput,
  identity,
  reportSuccess,
  runId,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/__tests__/fixtures';
import {
  evidenceAcceptance,
  inspectEvidence,
  prepareEvidence,
  retainEvidence,
  serializeEvidence,
  sha256,
  validateEvidenceTarget,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/evidence';
import { finalizeProbe } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/finalization';
import { evaluateReadiness } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/readiness';
import {
  copyBoundedEventInput,
  probeEventSchema,
  evidenceSnapshotSchema,
  type EvidenceSnapshot,
  createProbeRecorder,
  type ProbeEvent,
  HARD_RECORDER_LIMITS,
  DEFAULT_RECORDER_LIMITS,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';

const successfulPoll: ProbeEvent = {
  kind: 'successful-poll',
  state: 'LIVE_VERIFIED',
  runId,
  ownershipGeneration: 1,
  actor: 'fenced-workload',
  check: 'identity',
  identity: identity(13),
};

const recorded = () => {
  const recorder = createProbeRecorder(runId);

  recorder.record(successfulPoll);
  return recorder;
};

describe('bounded summaries and lossless structured artifacts', () => {
  it('should serialize and verify an exact SHA-256 round trip', () => {
    const recorder = recorded();

    recorder.record({
      kind: 'reaping',
      code: 'REAP_ACKNOWLEDGED',
      actor: 'harmless-descendant',
      identity: identity(14),
      reapingSource: 'kernel-pidfd-hup',
    });
    const original = recorder.seal();
    const artifact = serializeEvidence(original);

    expect(artifact.sha256).toBe(
      createHash('sha256').update(artifact.content).digest('hex'),
    );
    expect(artifact.byteLength).toBe(Buffer.byteLength(artifact.content));
    expect(inspectEvidence(artifact.content, artifact.sha256)).toEqual({
      state: 'VERIFIED',
      snapshot: original,
    });
  });

  it('should preserve each critical exception, signal, transition, mismatch and reaping event', () => {
    const recorder = recorded();
    const critical: ProbeEvent[] = [
      {
        kind: 'exception',
        code: 'ENOENT',
        identity: identity(20),
        helperOrdinal: 1,
      },
      { kind: 'signal', code: 'SIGTERM', identity: identity(13) },
      { kind: 'transition', code: 'EXIT_OBSERVED', identity: identity(13) },
      {
        kind: 'ownership-mismatch',
        code: 'IDENTITY_MISMATCH',
        identity: identity(99),
      },
      {
        kind: 'reaping',
        code: 'REAP_ACKNOWLEDGED',
        identity: identity(13),
        reapingSource: 'actual-parent-wait',
        parent: identity(12),
      },
    ];

    for (const event of critical) {
      recorder.record(event);
      recorder.record(event);
    }
    recorder.record(successfulPoll);
    const artifact = prepareEvidence(recorder).artifact;
    const result = inspectEvidence(artifact.content, artifact.sha256);

    expect(result.state).toBe('VERIFIED');
    if (result.state !== 'VERIFIED') throw new Error('Invalid fixture');
    expect(
      result.snapshot.entries.slice(1, -1).map((entry) => entry.event),
    ).toEqual(critical.flatMap((event) => [event, event]));
    expect(result.snapshot.entries.every((entry) => entry.count === 1)).toBe(
      true,
    );
  });

  it('should aggregate 50000 unchanged successful polls with exact counters and a bounded summary', () => {
    const recorder = createProbeRecorder(runId);

    for (let index = 0; index < 50000; index += 1)
      recorder.record(successfulPoll);
    const result = prepareEvidence(recorder, 512);

    expect(result.state).toBe('PREPARED');
    expect(Buffer.byteLength(result.summaryText)).toBeLessThanOrEqual(512);
    expect(JSON.parse(result.summaryText)).toMatchObject({
      inputEvents: 50000,
      retainedRecords: 1,
      aggregatedPolls: 49999,
    });
    expect(recorder.snapshot().entries[0]).toMatchObject({
      firstSequence: 1,
      lastSequence: 50000,
      count: 50000,
    });
  });

  it('should preserve every changed successful poll and interrupt aggregation at a critical event', () => {
    const recorder = recorded();

    recorder.record(successfulPoll);
    recorder.record({ kind: 'exception', code: 'ESRCH' });
    recorder.record(successfulPoll);
    recorder.record({ ...successfulPoll, identity: identity(14) });
    expect(recorder.seal().entries.map(({ count }) => count)).toEqual([
      2, 1, 1, 1,
    ]);
  });

  it.each([0, 1, 50, 150])(
    'should explicitly detect an output budget overflow at %s bytes',
    (budget) => {
      const recorder = recorded();
      const result = prepareEvidence(recorder, budget);

      expect(result.state).toBe('PARTIAL');
      expect(result.outputOverflow).toBe(true);
      expect(Buffer.byteLength(result.summaryText)).toBeLessThanOrEqual(budget);
      expect(recorder.snapshot().failureCode === 'OUTPUT_BUDGET_EXCEEDED').toBe(
        true,
      );
      expect(
        inspectEvidence(result.artifact.content, result.artifact.sha256).state,
      ).toBe('PARTIAL');
    },
  );

  it('should never put archive records into even a generously budgeted summary', () => {
    const recorder = recorded();

    for (let index = 0; index < 1000; index += 1)
      recorder.record({ kind: 'exception', code: 'ENOENT' });
    const result = prepareEvidence(recorder, 1000000);

    expect(Buffer.byteLength(result.summaryText)).toBeLessThanOrEqual(4096);
    expect(result.summaryText).not.toContain('ENOENT');
    expect(result.summaryText).not.toContain('entries');
    expect(JSON.parse(result.artifact.content).entries).toHaveLength(1001);
  });

  it.each([
    'hash',
    'json',
    'version',
    'incomplete',
    'unsealed',
    'gap',
    'critical-aggregation',
    'count',
    'empty',
  ] as const)(
    'should reject a corrupted or incomplete archive: %s',
    (corruption) => {
      const snapshot = recorded().seal();
      let content: string;

      if (corruption === 'incomplete') snapshot.complete = false;
      if (corruption === 'unsealed') snapshot.sealed = false;
      if (corruption === 'gap') snapshot.entries[0].firstSequence = 2;
      if (corruption === 'count') snapshot.inputEvents = 2;
      if (corruption === 'empty') {
        snapshot.entries = [];
        snapshot.inputEvents = 0;
      }
      if (corruption === 'critical-aggregation') {
        snapshot.inputEvents = 2;
        snapshot.entries[0] = {
          firstSequence: 1,
          lastSequence: 2,
          count: 2,
          event: { kind: 'exception', code: 'ENOENT' },
        };
      }
      content = JSON.stringify(
        corruption === 'version' ? { ...snapshot, version: 3 } : snapshot,
      );
      if (corruption === 'json') content = '{';
      expect(
        inspectEvidence(
          content,
          corruption === 'hash' ? '0'.repeat(64) : sha256(content),
        ).state,
      ).toBe('PARTIAL');
    },
  );

  it('should reject arbitrary logs and credentials and retain a safe explicit failure marker', () => {
    const recorder = recorded();

    expect(
      recorder.record({
        kind: 'exception',
        code: 'ENOENT',
        message: 'credential-do-not-retain',
      }),
    ).toBe(false);
    const prepared = prepareEvidence(recorder);

    expect(prepared.state).toBe('PARTIAL');
    expect(prepared.artifact.content).not.toContain('credential-do-not-retain');
    expect(prepared.artifact.content).toContain('INVALID_EVENT');
  });

  it('should reject additional recording after sealing rather than silently omitting an event', () => {
    const recorder = recorded();

    recorder.seal();
    expect(recorder.record({ kind: 'signal', code: 'SIGTERM' })).toBe(false);
    expect(recorder.snapshot().complete).toBe(false);
    expect(recorder.snapshot().failureCode).toBe('RECORDING_ALREADY_SEALED');
    expect(recorder.snapshot().entries).toHaveLength(1);
  });

  it('should retain with an injected exclusive store and verify same-target readback', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder);
    let stored = '';
    const store = {
      writeExclusive: jest.fn(async (_target, content: string) => {
        stored = content;
      }),
      readBack: jest.fn(async () => stored),
    };

    expect(
      await retainEvidence(
        recorder,
        prepared,
        evidenceTarget(),
        runId,
        1000,
        store,
      ),
    ).toMatchObject({
      state: 'RETAINED',
      path: evidenceTarget().path,
      sha256: prepared.artifact.sha256,
    });
    expect(store.readBack).toHaveBeenCalledWith(evidenceTarget());
  });

  it('should refuse an artifact bound to a different run before any store call', async () => {
    const otherRunId = '60000000-0000-4000-8000-000000000002';
    const recorder = createProbeRecorder(otherRunId);

    recorder.record({ ...successfulPoll, runId: otherRunId });
    const store = { writeExclusive: jest.fn(), readBack: jest.fn() };

    expect(
      (
        await retainEvidence(
          recorder,
          prepareEvidence(recorder),
          evidenceTarget(),
          runId,
          1000,
          store,
        )
      ).state,
    ).toBe('PARTIAL');
    expect(store.writeExclusive).not.toHaveBeenCalled();
  });

  it.each([
    'relative',
    'traversal',
    'c4',
    'symlink',
    'unowned',
    'mode',
    'run',
    'root',
  ] as const)(
    'should reject an unsafe or unowned artifact target: %s',
    async (problem) => {
      const target = evidenceTarget();
      let input: unknown = target;

      if (problem === 'relative') target.path = 'evidence.json';
      if (problem === 'traversal')
        target.path = `${target.openedRoot.realPath}/../evidence.json`;
      if (problem === 'c4') target.path = '/tmp/c4-evidence.json';
      if (problem === 'symlink')
        input = {
          ...target,
          openedRoot: { ...target.openedRoot, symlinkFree: false },
        };
      if (problem === 'unowned') target.openedRoot.ownerUid = 99;
      if (problem === 'mode')
        input = {
          ...target,
          openedRoot: { ...target.openedRoot, mode: 0o777 },
        };
      if (problem === 'run')
        target.openedRoot.runId = '60000000-0000-4000-8000-000000000002';
      if (problem === 'root') target.openedRoot.realPath = '/tmp';
      const recorder = recorded();
      const store = { writeExclusive: jest.fn(), readBack: jest.fn() };

      expect(validateEvidenceTarget(input, runId, 1000)).toBeUndefined();
      expect(
        (
          await retainEvidence(
            recorder,
            prepareEvidence(recorder),
            input,
            runId,
            1000,
            store,
          )
        ).state,
      ).toBe('PARTIAL');
      expect(store.writeExclusive).not.toHaveBeenCalled();
    },
  );

  it.each(['write', 'read', 'corruption'] as const)(
    'should classify failed %s retention as PARTIAL',
    async (failure) => {
      const recorder = recorded();
      const prepared = prepareEvidence(recorder);
      const store = {
        writeExclusive: async () => {
          if (failure === 'write')
            throw new Error('disk-full-or-existing-file');
        },
        readBack: async () => {
          if (failure === 'read') throw new Error('readback');
          return 'corrupt';
        },
      };

      expect(
        (
          await retainEvidence(
            recorder,
            prepared,
            evidenceTarget(),
            runId,
            1000,
            store,
          )
        ).state,
      ).toBe('PARTIAL');
    },
  );

  it('should produce PARTIAL for a synthetic C4 sequence without a crash or false acceptance', async () => {
    const input = finalizationInput();
    const recorder = recorded();

    input.originalFailure = 'OBSERVATION_FAILED';
    input.intentionalSignalObserved = false;
    input.observationWindowComplete = false;
    input.inventory.otherProcesses.push({
      kind: 'unowned-observation-candidate',
      pid: 64,
      error: 'ENOENT',
    });
    const helper = completedHelper();

    helper.creation = undefined;
    input.inventory.helpers.push(helper);
    input.inventory.otherProcesses.push({
      kind: 'unresolved-owned-process',
      pid: 65,
    });
    input.readiness = evaluateReadiness(input.inventory);
    recorder.record({
      kind: 'exception',
      code: 'ENOENT',
      observedPid: 64,
      ownership: 'unowned-observation-candidate',
    });
    recorder.record({
      kind: 'exception',
      code: 'ENOENT',
      observedPid: 65,
      ownership: 'unresolved-owned-process',
      helperOrdinal: 1,
    });
    recorder.record({
      kind: 'signal',
      code: 'SIGTERM',
      identity: identity(11),
    });
    recorder.record({
      kind: 'reaping',
      code: 'REAP_ACKNOWLEDGED',
      identity: identity(11),
      reapingSource: 'kernel-pidfd-hup',
    });
    recorder.record({ kind: 'transition', code: 'FINALIZATION_INCOMPLETE' });
    const prepared = prepareEvidence(recorder, 50);

    input.telemetryComplete = prepared.state === 'PREPARED';
    const actions = finalizationActions(input);

    actions.namespaceHolders = async () => ({
      holders: [],
      scanComplete: false,
    });
    actions.descriptorClosures = async () => false;
    const result = await finalizeProbe(input, actions, reportSuccess);

    expect(input.readiness.state).toBe('UNKNOWN');
    expect(result.state).toBe('FINALIZATION_INCOMPLETE');
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.originalFailure).toBe('OBSERVATION_FAILED');
    expect(result.diagnostics).toContain('MISSING:namespaceHolders.namespaces');
    expect(prepared.outputOverflow).toBe(true);
    expect(
      inspectEvidence(prepared.artifact.content, prepared.artifact.sha256)
        .state,
    ).toBe('PARTIAL');
  });
});

const memoryStore = () => {
  let content = '';
  return {
    writeExclusive: jest.fn(async (_target, value: string) => {
      content = value;
    }),
    readBack: jest.fn(async () => content),
  };
};

const retain = (
  recorder: ReturnType<typeof recorded>,
  prepared = prepareEvidence(recorder),
  store = memoryStore(),
) => retainEvidence(recorder, prepared, evidenceTarget(), runId, 1000, store);

describe('P1 terminal authority and bounded recording regressions', () => {
  it('should invalidate preparation when a late critical signal is attempted', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder);
    const generation = prepared.generation;
    const store = memoryStore();
    expect(
      recorder.record({
        kind: 'signal',
        code: 'SIGTERM',
        identity: identity(13),
      }),
    ).toBe(false);
    expect(recorder.current().generation).toBe(generation + 1);
    expect(prepared.state).toBe('PARTIAL');
    expect((await retain(recorder, prepared, store)).state).toBe('PARTIAL');
    expect(store.writeExclusive).not.toHaveBeenCalled();
  });

  it('should revoke prior retention and PASS after prepare, retain, then late SIGTERM', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder);
    const receipt = await retain(recorder, prepared);
    const bytes = prepared.artifact.content;
    expect(receipt.state).toBe('RETAINED');
    expect(evidenceAcceptance(recorder, receipt)).toBe('PASS');
    expect(recorder.record({ kind: 'signal', code: 'SIGTERM' })).toBe(false);
    expect(prepared.artifact.content).toBe(bytes);
    expect(receipt.state).toBe('PARTIAL');
    expect(receipt.diagnostic).toBe('INVALIDATED_RETENTION');
    expect(evidenceAcceptance(recorder, receipt)).toBe('PARTIAL');
    expect((await retain(recorder, prepared)).state).toBe('PARTIAL');
  });

  it('should reject every post-seal recording attempt without growing diagnostics', () => {
    const recorder = recorded();
    recorder.seal();
    for (let index = 0; index < 10000; index += 1)
      expect(recorder.record(successfulPoll)).toBe(false);
    expect(recorder.snapshot()).toMatchObject({
      complete: false,
      inputEvents: 1,
      generation: 2,
      failureCode: 'RECORDING_ALREADY_SEALED',
    });
    expect(recorder.snapshot().entries).toHaveLength(1);
  });

  it('should reject another recorder even when run and generation numbers coincide', async () => {
    const first = recorded();
    const second = recorded();
    const prepared = prepareEvidence(first);
    prepareEvidence(second);
    const store = memoryStore();
    expect((await retain(second, prepared, store)).state).toBe('PARTIAL');
    expect(store.writeExclusive).not.toHaveBeenCalled();
    const receipt = await retain(first, prepared);
    expect(evidenceAcceptance(second, receipt)).toBe('PARTIAL');
  });

  it('should reject run mismatch with a legitimate complete artifact', async () => {
    const recorder = recorded();
    const store = memoryStore();
    expect(
      (
        await retainEvidence(
          recorder,
          prepareEvidence(recorder),
          evidenceTarget(),
          '60000000-0000-4000-8000-000000000002',
          1000,
          store,
        )
      ).state,
    ).toBe('PARTIAL');
    expect(store.writeExclusive).not.toHaveBeenCalled();
  });

  it.each(['missing', 'generation', 'state'] as const)(
    'should reject %s terminal evidence and detached preparation',
    async (problem) => {
      const recorder = recorded();
      const prepared = prepareEvidence(recorder);
      const snapshot = JSON.parse(prepared.artifact.content);
      if (problem === 'missing') delete snapshot.terminal;
      if (problem === 'generation') snapshot.terminal.generation += 1;
      if (problem === 'state') snapshot.terminal.state = 'INVALID';
      const content = JSON.stringify(snapshot);
      expect(inspectEvidence(content, sha256(content)).state).toBe('PARTIAL');
      const detached = {
        ...prepared,
        artifact: {
          content,
          sha256: sha256(content),
          byteLength: Buffer.byteLength(content),
        },
      };
      const store = memoryStore();
      expect((await retain(recorder, detached, store)).state).toBe('PARTIAL');
      expect(store.writeExclusive).not.toHaveBeenCalled();
    },
  );

  it('should freeze prepared bytes and make repeated preparation and retention deterministic', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder, 512);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.artifact)).toBe(true);
    expect(prepareEvidence(recorder, 0)).toBe(prepared);
    const store = memoryStore();
    const receipt = await retain(recorder, prepared, store);
    expect(await retain(recorder, prepared, store)).toBe(receipt);
    expect(store.writeExclusive).toHaveBeenCalledTimes(1);
    expect(store.readBack).toHaveBeenCalledTimes(1);
  });

  it('should block concurrent and reentrant retention before a second write', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder);
    let release: (() => void) | undefined;
    let stored = '';
    const store = {
      writeExclusive: jest.fn(async (_target, content: string) => {
        stored = content;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }),
      readBack: jest.fn(async () => stored),
    };
    const first = retainEvidence(
      recorder,
      prepared,
      evidenceTarget(),
      runId,
      1000,
      store,
    );
    expect(
      (
        await retainEvidence(
          recorder,
          prepared,
          evidenceTarget(),
          runId,
          1000,
          store,
        )
      ).state,
    ).toBe('PARTIAL');
    if (!release) throw new Error('Invalid fixture');
    release();
    expect((await first).state).toBe('RETAINED');
    expect(store.writeExclusive).toHaveBeenCalledTimes(1);
  });

  it.each(['write', 'read'] as const)(
    'should invalidate retention for a critical event during %s callback',
    async (phase) => {
      const recorder = recorded();
      const prepared = prepareEvidence(recorder);
      const store = {
        writeExclusive: async () => {
          if (phase === 'write')
            recorder.record({ kind: 'signal', code: 'SIGTERM' });
        },
        readBack: async () => {
          if (phase === 'read')
            recorder.record({ kind: 'signal', code: 'SIGTERM' });
          return prepared.artifact.content;
        },
      };
      const receipt = await retainEvidence(
        recorder,
        prepared,
        evidenceTarget(),
        runId,
        1000,
        store,
      );
      expect(receipt.state).toBe('PARTIAL');
      expect(evidenceAcceptance(recorder, receipt)).toBe('PARTIAL');
    },
  );

  it('should reject reentrant proxy input before executing its trap', () => {
    const recorder = recorded();
    const trap = jest.fn((target: object) => {
      recorder.record({ kind: 'signal', code: 'SIGTERM' });
      return Object.getPrototypeOf(target);
    });
    const input = new Proxy(
      { kind: 'transition', code: 'READY' },
      { getPrototypeOf: trap },
    );
    expect(recorder.record(input)).toBe(false);
    expect(recorder.snapshot().failureCode).toBe('INVALID_EVENT');
    expect(trap).not.toHaveBeenCalled();
    expect(prepareEvidence(recorder).state).toBe('PARTIAL');
  });

  it('should accept capacity exactly at the record boundary', () => {
    const recorder = createProbeRecorder(runId, { maximumRecords: 3 });
    for (let index = 0; index < 3; index += 1)
      expect(recorder.record({ kind: 'exception', code: 'ENOENT' })).toBe(true);
    expect(prepareEvidence(recorder).state).toBe('PREPARED');
    expect(recorder.snapshot().entries).toHaveLength(3);
  });

  it('should invalidate when one critical event exceeds capacity and reserve compact cleanup failure', () => {
    const recorder = createProbeRecorder(runId, { maximumRecords: 3 });
    for (let index = 0; index < 3; index += 1)
      recorder.record({ kind: 'exception', code: 'ENOENT' });
    expect(recorder.record({ kind: 'signal', code: 'SIGTERM' })).toBe(false);
    const before = recorder.snapshot();
    for (let index = 0; index < 10000; index += 1)
      expect(recorder.record({ kind: 'exception', code: 'ECHILD' })).toBe(
        false,
      );
    expect(recorder.snapshot()).toEqual(before);
    expect(before.failureCode).toBe('CAPACITY_EXCEEDED');
    expect(prepareEvidence(recorder).state).toBe('PARTIAL');
  });

  it.each([65, 1_000_000])(
    'should reject a %s-character identity without retaining its string',
    (length) => {
      const recorder = recorded();
      expect(
        recorder.record({
          ...successfulPoll,
          identity: { ...identity(13), startTicks: '9'.repeat(length) },
        }),
      ).toBe(false);
      const prepared = prepareEvidence(recorder);
      expect(prepared.state).toBe('PARTIAL');
      expect(prepared.artifact.byteLength).toBeLessThan(2048);
      expect(recorder.snapshot().entries).toHaveLength(1);
    },
  );

  it('should reject giant unknown strings and accessor payloads without invoking getters', () => {
    const recorder = recorded();
    const getter = jest.fn(() => 'secret');
    const event = { kind: 'exception', code: 'ENOENT' };
    Object.defineProperty(event, 'message', { enumerable: true, get: getter });
    expect(recorder.record(event)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const another = recorded();
    expect(
      another.record({ kind: 'exception', code: '9'.repeat(1_000_000) }),
    ).toBe(false);
    expect(prepareEvidence(another).artifact.byteLength).toBeLessThan(2048);
  });

  it('should bound cyclic A B C successful polling with exact accepted counts and chronology', () => {
    const recorder = createProbeRecorder(runId, { maximumRecords: 6 });
    const polls: ProbeEvent[] = [
      successfulPoll,
      { ...successfulPoll, actor: 'bwrap-supervisor', identity: identity(12) },
      {
        ...successfulPoll,
        actor: 'harmless-descendant',
        identity: identity(14),
      },
    ];
    for (let index = 0; index < 6; index += 1)
      expect(recorder.record(polls[index % 3])).toBe(true);
    expect(
      recorder
        .snapshot()
        .entries.map(({ firstSequence, lastSequence, count }) => [
          firstSequence,
          lastSequence,
          count,
        ]),
    ).toEqual([
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
      [4, 4, 1],
      [5, 5, 1],
      [6, 6, 1],
    ]);
    expect(recorder.record(polls[0])).toBe(false);
    expect(recorder.snapshot().inputEvents).toBe(6);
    expect(prepareEvidence(recorder).state).toBe('PARTIAL');
  });

  it('should preserve critical ordering and refuse merges across generation, identity, state or run', () => {
    const recorder = recorded();
    recorder.record(successfulPoll);
    recorder.record({ kind: 'signal', code: 'SIGTERM' });
    recorder.record(successfulPoll);
    recorder.record({ ...successfulPoll, ownershipGeneration: 2 });
    recorder.record({ ...successfulPoll, identity: identity(14) });
    recorder.record({ ...successfulPoll, state: 'EXIT_OBSERVED' });
    expect(recorder.snapshot().entries.map(({ count }) => count)).toEqual([
      2, 1, 1, 1, 1, 1,
    ]);
    expect(recorder.snapshot().entries[1].firstSequence).toBe(3);
    expect(
      recorder.record({
        ...successfulPoll,
        runId: '60000000-0000-4000-8000-000000000002',
      }),
    ).toBe(false);
    expect(prepareEvidence(recorder).state).toBe('PARTIAL');
  });

  it('should bound input counts even for perfectly aggregated success', () => {
    const recorder = createProbeRecorder(runId, { maximumInputEvents: 2 });
    expect(recorder.record(successfulPoll)).toBe(true);
    expect(recorder.record(successfulPoll)).toBe(true);
    expect(recorder.record(successfulPoll)).toBe(false);
    expect(recorder.snapshot()).toMatchObject({
      inputEvents: 2,
      failureCode: 'CAPACITY_EXCEEDED',
    });
  });

  it('should enforce event bytes and aggregate diagnostic bytes at exact boundaries', () => {
    const event: ProbeEvent = { kind: 'exception', code: 'ENOENT' };
    const bytes = Buffer.byteLength(JSON.stringify(event));
    const recorder = createProbeRecorder(runId, {
      maximumEventBytes: bytes,
      maximumDiagnosticBytes: bytes * 2,
    });
    expect(recorder.record(event)).toBe(true);
    expect(recorder.record(event)).toBe(true);
    expect(recorder.record(event)).toBe(false);
    expect(recorder.snapshot().diagnosticBytes).toBe(bytes * 2);
    const small = createProbeRecorder(runId, { maximumEventBytes: bytes - 1 });
    expect(small.record(event)).toBe(false);
    expect(small.snapshot().entries).toHaveLength(0);
  });

  it('should fail archive preparation early with a compact incomplete artifact', () => {
    const recorder = createProbeRecorder(runId, { maximumArchiveBytes: 512 });
    for (let index = 0; index < 100; index += 1)
      recorder.record({ kind: 'exception', code: 'ENOENT' });
    const prepared = prepareEvidence(recorder);
    expect(prepared.state).toBe('PARTIAL');
    expect(recorder.snapshot().failureCode).toBe('ARCHIVE_CAPACITY_EXCEEDED');
    expect(prepared.artifact.byteLength).toBeLessThanOrEqual(1024);
    expect(
      inspectEvidence(prepared.artifact.content, prepared.artifact.sha256)
        .state,
    ).toBe('PARTIAL');
    expect(prepareEvidence(recorder)).toBe(prepared);
  });

  it('should reject an excessive archive array before iterating or serializing events', () => {
    const snapshot = recorded().seal();
    snapshot.entries = new Array(HARD_RECORDER_LIMITS.maximumRecords + 1);
    expect(() => serializeEvidence(snapshot)).toThrow(
      'ARCHIVE_CAPACITY_EXCEEDED',
    );
  });

  it.each(
    Object.keys(
      DEFAULT_RECORDER_LIMITS,
    ) as (keyof typeof DEFAULT_RECORDER_LIMITS)[],
  )('should reject nonfinite and excessive %s configurations', (key) => {
    expect(() => createProbeRecorder(runId, { [key]: NaN })).toThrow(
      'INVALID_RECORDER_LIMIT',
    );
    expect(() =>
      createProbeRecorder(runId, { [key]: HARD_RECORDER_LIMITS[key] + 1 }),
    ).toThrow('INVALID_RECORDER_LIMIT');
  });

  it('should reject forged reporting booleans and revoke an already returned finalization PASS', async () => {
    const input = finalizationInput();
    const result = await finalizeProbe(
      input,
      finalizationActions(input),
      reportSuccess,
    );
    expect(result.acceptance).toBe('PASS');
    input.recorder.record({ kind: 'signal', code: 'SIGTERM' });
    expect(result.acceptance).toBe('PARTIAL');
    expect(result.reporting.retention?.state).toBe('PARTIAL');
    expect(result.reporting.evidenceRetained).toBe(false);
    const forged = finalizationInput();
    expect(
      (
        await finalizeProbe(forged, finalizationActions(forged), async () => ({
          evidenceRetained: true,
          summaryDelivered: true,
        }))
      ).acceptance,
    ).toBe('PARTIAL');
  });

  it('should refuse finalization PASS for a receipt from another recorder', async () => {
    const input = finalizationInput();
    const receipt = await retain(recorded());
    expect(
      (
        await finalizeProbe(input, finalizationActions(input), async () => ({
          evidenceRetained: true,
          summaryDelivered: true,
          retention: receipt,
        }))
      ).acceptance,
    ).toBe('PARTIAL');
  });
});

describe('bounded canonical input regressions', () => {
  it('should reject hidden identity fields and hidden accessors before schema evaluation', () => {
    const recorder = recorded();
    const hidden = { ...identity(13) };
    Object.defineProperty(hidden, 'startTicks', {
      value: '9'.repeat(1_000_000),
      enumerable: false,
    });
    expect(recorder.record({ ...successfulPoll, identity: hidden })).toBe(
      false,
    );
    expect(prepareEvidence(recorder).artifact.byteLength).toBeLessThan(2048);
    const another = recorded();
    const getter = jest.fn(() => '9'.repeat(1_000_000));
    const hiddenAccessor = { ...successfulPoll };
    Object.defineProperty(hiddenAccessor, 'identity', {
      get: getter,
      enumerable: false,
    });
    expect(another.record(hiddenAccessor)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('should reject changing proxy values before schema validation', () => {
    const recorder = recorded();
    const read = jest.fn(() => '9'.repeat(1_000_000));
    const event = new Proxy(
      { kind: 'transition', code: 'READY' },
      { get: read },
    );
    expect(recorder.record(event)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(prepareEvidence(recorder).state).toBe('PARTIAL');
  });
});

describe('finite capacity inclusive boundaries', () => {
  it('should accept 64-character kernel identifiers with ordinary default budgets', () => {
    const recorder = createProbeRecorder(runId);
    expect(
      recorder.record({
        ...successfulPoll,
        identity: { ...identity(13), startTicks: '9'.repeat(64) },
      }),
    ).toBe(true);
    expect(prepareEvidence(recorder).state).toBe('PREPARED');
  });

  it('should accept exactly the serialized archive limit and reject one byte less', () => {
    const bytes = prepareEvidence(recorded()).artifact.byteLength;
    const exact = createProbeRecorder(runId, { maximumArchiveBytes: bytes });
    exact.record(successfulPoll);
    expect(prepareEvidence(exact).state).toBe('PREPARED');
    const short = createProbeRecorder(runId, {
      maximumArchiveBytes: bytes - 1,
    });
    short.record(successfulPoll);
    expect(prepareEvidence(short).state).toBe('PARTIAL');
    expect(short.snapshot().failureCode).toBe('ARCHIVE_CAPACITY_EXCEEDED');
  });
});

describe('recorder authority identity', () => {
  it('should reject a copied recorder that replaces current state authority', async () => {
    const recorder = recorded();
    const prepared = prepareEvidence(recorder);
    const current = recorder.current();
    const copied = { ...recorder, current: () => current };
    expect(() => prepareEvidence(copied)).toThrow('INVALID_RECORDER');
    const store = memoryStore();
    expect((await retain(copied, prepared, store)).state).toBe('PARTIAL');
    expect(store.writeExclusive).not.toHaveBeenCalled();
    const receipt = await retain(recorder, prepared);
    recorder.record({ kind: 'signal', code: 'SIGTERM' });
    expect(evidenceAcceptance(copied, receipt)).toBe('PARTIAL');
    expect(receipt.state).toBe('PARTIAL');
  });
});

describe('P1-B safe plain data and canonical serialization', () => {
  const signalSnapshot = () => {
    const recorder = createProbeRecorder(runId);
    recorder.record({ kind: 'signal', code: 'SIGTERM' });
    return recorder.seal();
  };

  it('should reject a constructor-name getter without invoking it', () => {
    const nameGetter = jest.fn(() => 'Object');
    const constructor = Object.defineProperty({}, 'name', { get: nameGetter });
    const prototype = Object.defineProperty({}, 'constructor', {
      value: constructor,
    });
    const event = Object.assign(Object.create(prototype), {
      kind: 'signal',
      code: 'SIGTERM',
    });
    expect(copyBoundedEventInput(event)).toBeUndefined();
    const recorder = createProbeRecorder(runId);
    expect(recorder.record(event)).toBe(false);
    const snapshot = signalSnapshot();
    snapshot.entries[0].event = event;
    expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
    expect(nameGetter).not.toHaveBeenCalled();
  });

  it.each(['own', 'prototype', 'nested', 'hidden'] as const)(
    'should reject an %s accessor without invoking it',
    (location) => {
      const getter = jest.fn(() => 'SIGTERM');
      const event = { kind: 'signal', code: 'SIGTERM' };
      let input: unknown = event;
      if (location === 'own' || location === 'hidden')
        Object.defineProperty(event, 'code', {
          get: getter,
          enumerable: location === 'own',
        });
      if (location === 'prototype')
        input = Object.assign(
          Object.create(Object.defineProperty({}, 'code', { get: getter })),
          { kind: 'signal' },
        );
      if (location === 'nested') {
        const nested = identity(13);
        Object.defineProperty(nested, 'startTicks', {
          get: getter,
          enumerable: true,
        });
        input = { ...event, identity: nested };
      }
      expect(copyBoundedEventInput(input)).toBeUndefined();
      const recorder = createProbeRecorder(runId);
      expect(recorder.record(input)).toBe(false);
      const snapshot = signalSnapshot();
      snapshot.entries[0].event = input as ProbeEvent;
      expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it.each(['runId', 'entries', 'nested-terminal', 'prototype'] as const)(
    'should reject a header %s accessor without evaluating it',
    (location) => {
      let snapshot = signalSnapshot();
      const getter = jest.fn(() => (location === 'entries' ? [] : runId));
      if (location === 'runId' || location === 'entries')
        Object.defineProperty(snapshot, location, {
          get: getter,
          enumerable: true,
        });
      if (location === 'nested-terminal')
        Object.defineProperty(snapshot.terminal, 'state', {
          get: getter,
          enumerable: true,
        });
      if (location === 'prototype')
        snapshot = Object.assign(
          Object.create(Object.defineProperty({}, 'toJSON', { get: getter })),
          snapshot,
        );
      expect(() => serializeEvidence(snapshot)).toThrow();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it.each([
    'event',
    'nested-event',
    'header',
    'nested-header',
    'entries',
    'entry',
  ] as const)(
    'should reject a changing %s proxy before any trap executes',
    (location) => {
      let reads = 0;
      const get = jest.fn((target: object, key: string | symbol) => {
        if (key === 'code') return ++reads === 1 ? 'SIGTERM' : 'SIGKILL';
        if (key === 'complete') return ++reads === 1;
        return Reflect.get(target, key);
      });
      const getPrototypeOf = jest.fn(Object.getPrototypeOf);
      const ownKeys = jest.fn(Reflect.ownKeys);
      const getOwnPropertyDescriptor = jest.fn(Object.getOwnPropertyDescriptor);
      const traps = { get, getPrototypeOf, ownKeys, getOwnPropertyDescriptor };
      let snapshot = signalSnapshot();
      if (location === 'event')
        snapshot.entries[0].event = new Proxy(snapshot.entries[0].event, traps);
      if (location === 'nested-event')
        snapshot.entries[0].event = {
          kind: 'signal',
          code: 'SIGTERM',
          identity: new Proxy(identity(13), traps),
        };
      if (location === 'header') snapshot = new Proxy(snapshot, traps);
      if (location === 'nested-header' && snapshot.terminal)
        snapshot.terminal = new Proxy(snapshot.terminal, traps);
      if (location === 'entries')
        snapshot.entries = new Proxy(snapshot.entries, traps);
      if (location === 'entry')
        snapshot.entries[0] = new Proxy(snapshot.entries[0], traps);
      expect(() => serializeEvidence(snapshot)).toThrow();
      if (location === 'event' || location === 'nested-event') {
        const recorder = createProbeRecorder(runId);
        expect(recorder.record(snapshot.entries[0].event)).toBe(false);
      }
      for (const trap of Object.values(traps))
        expect(trap).not.toHaveBeenCalled();
    },
  );

  it('should reject revoked proxies without invoking runtime inspection traps', () => {
    const revocable = Proxy.revocable({ kind: 'signal', code: 'SIGTERM' }, {});
    revocable.revoke();
    expect(copyBoundedEventInput(revocable.proxy)).toBeUndefined();
    const snapshot = signalSnapshot();
    snapshot.entries[0].event = revocable.proxy as ProbeEvent;
    expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
  });

  it.each(['event', 'header', 'terminal'] as const)(
    'should reject %s toJSON methods without running user code',
    (location) => {
      const toJSON = jest.fn(() => ({ kind: 'signal', code: 'SIGKILL' }));
      const snapshot = signalSnapshot();
      const input =
        location === 'event'
          ? snapshot.entries[0].event
          : location === 'header'
            ? snapshot
            : snapshot.terminal;
      Object.defineProperty(input, 'toJSON', {
        value: toJSON,
        enumerable: true,
      });
      expect(() => serializeEvidence(snapshot)).toThrow();
      if (location === 'event')
        expect(createProbeRecorder(runId).record(input)).toBe(false);
      expect(toJSON).not.toHaveBeenCalled();
    },
  );

  it('should bound cyclic input without serializing it', () => {
    const event: Record<string, unknown> = { kind: 'signal', code: 'SIGTERM' };
    event.identity = event;
    expect(copyBoundedEventInput(event)).toBeUndefined();
    expect(createProbeRecorder(runId).record(event)).toBe(false);
    const snapshot = signalSnapshot();
    snapshot.entries[0].event = event as ProbeEvent;
    expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
    const header = signalSnapshot();
    Object.assign(header, { terminal: header });
    expect(() => serializeEvidence(header)).toThrow();
  });

  it.each(['event', 'header', 'nested-header'] as const)(
    'should reject an overlong %s field before schema or serialization',
    (location) => {
      const snapshot = signalSnapshot();
      if (location === 'event')
        snapshot.entries[0].event = {
          ...successfulPoll,
          identity: { ...identity(13), startTicks: '9'.repeat(129) },
        };
      if (location === 'header') snapshot.runId = '9'.repeat(129);
      if (location === 'nested-header')
        Object.assign(snapshot.terminal ?? {}, { state: '9'.repeat(129) });
      expect(() => serializeEvidence(snapshot)).toThrow();
    },
  );

  it.each(['malformed', 'throwing'] as const)(
    'should reject %s descriptor proxies before asking for descriptors',
    (problem) => {
      const descriptorTrap = jest.fn(() => {
        if (problem === 'throwing') throw new Error('caller side effect');
        return {
          value: 'SIGTERM',
          get: () => 'SIGKILL',
          enumerable: true,
          configurable: true,
        };
      });
      const proxy = new Proxy(
        { kind: 'signal', code: 'SIGTERM' },
        { getOwnPropertyDescriptor: descriptorTrap },
      );
      expect(copyBoundedEventInput(proxy)).toBeUndefined();
      const snapshot = signalSnapshot();
      snapshot.entries[0].event = proxy as ProbeEvent;
      expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
      expect(descriptorTrap).not.toHaveBeenCalled();
    },
  );

  it.each([
    'date',
    'array',
    'symbol',
    'hidden',
    'sparse-array',
    'array-accessor',
  ] as const)(
    'should fail closed on non-plain or ambiguous %s shapes',
    (shape) => {
      const snapshot = signalSnapshot();
      const getter = jest.fn(() => snapshot.entries[0]);
      if (shape === 'date')
        snapshot.entries[0].event = new Date() as unknown as ProbeEvent;
      if (shape === 'array')
        snapshot.entries[0].event = [] as unknown as ProbeEvent;
      if (shape === 'symbol')
        Object.defineProperty(snapshot, Symbol('hidden'), { value: true });
      if (shape === 'hidden')
        Object.defineProperty(snapshot, 'complete', {
          value: true,
          enumerable: false,
        });
      if (shape === 'sparse-array') snapshot.entries = new Array(1);
      if (shape === 'array-accessor')
        Object.defineProperty(snapshot.entries, '0', { get: getter });
      expect(() => serializeEvidence(snapshot)).toThrow('INVALID_ARCHIVE');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('should serialize the exact immutable event validated even if original input changes during validation', () => {
    const snapshot = signalSnapshot();
    const original = snapshot.entries[0].event;
    const schema = evidenceSnapshotSchema.shape.entries.element;
    const parse = schema.parse.bind(schema);
    const validation = jest
      .spyOn(schema, 'parse')
      .mockImplementationOnce((canonical) => {
        expect(Object.isFrozen(canonical)).toBe(true);
        expect(
          Object.isFrozen(
            (canonical as EvidenceSnapshot['entries'][number]).event,
          ),
        ).toBe(true);
        if (original.kind === 'signal') original.code = 'SIGKILL';
        return parse(canonical);
      });
    try {
      const artifact = serializeEvidence(snapshot);
      expect(JSON.parse(artifact.content).entries[0].event.code).toBe(
        'SIGTERM',
      );
      expect(inspectEvidence(artifact.content, artifact.sha256).state).toBe(
        'VERIFIED',
      );
      expect(validation).toHaveBeenCalledTimes(1);
    } finally {
      validation.mockRestore();
    }
  });

  it('should serialize the exact immutable header validated even if the original header changes', () => {
    const snapshot = signalSnapshot();
    const schema = evidenceSnapshotSchema.omit({ entries: true });
    const parse = schema.parse.bind(schema);
    const omit = jest
      .spyOn(evidenceSnapshotSchema, 'omit')
      .mockReturnValue(schema);
    const validation = jest
      .spyOn(schema, 'parse')
      .mockImplementationOnce((canonical) => {
        expect(Object.isFrozen(canonical)).toBe(true);
        expect(Object.isFrozen((canonical as EvidenceSnapshot).terminal)).toBe(
          true,
        );
        snapshot.complete = false;
        if (snapshot.terminal) snapshot.terminal.state = 'INVALID';
        return parse(canonical);
      });
    try {
      const artifact = serializeEvidence(snapshot);
      expect(JSON.parse(artifact.content)).toMatchObject({
        complete: true,
        terminal: { state: 'SEALED' },
      });
      expect(inspectEvidence(artifact.content, artifact.sha256).state).toBe(
        'VERIFIED',
      );
      expect(validation).toHaveBeenCalledTimes(1);
    } finally {
      validation.mockRestore();
      omit.mockRestore();
    }
  });

  it('should record the immutable event validated despite mutation of the original input', () => {
    const original = { ...successfulPoll, identity: identity(13) };
    const recorder = createProbeRecorder(runId);
    const safeParse = probeEventSchema.safeParse.bind(probeEventSchema);
    const validation = jest
      .spyOn(probeEventSchema, 'safeParse')
      .mockImplementationOnce((canonical) => {
        expect(Object.isFrozen(canonical)).toBe(true);
        expect(Object.isFrozen((canonical as ProbeEvent).identity)).toBe(true);
        original.identity.startTicks = '999';
        original.runId = '60000000-0000-4000-8000-000000000002';
        return safeParse(canonical);
      });
    try {
      expect(recorder.record(original)).toBe(true);
      const artifact = serializeEvidence(recorder.seal());
      expect(JSON.parse(artifact.content).entries[0].event).toMatchObject({
        runId,
        identity: identity(13),
      });
      expect(inspectEvidence(artifact.content, artifact.sha256).state).toBe(
        'VERIFIED',
      );
      expect(validation).toHaveBeenCalledTimes(1);
    } finally {
      validation.mockRestore();
    }
  });

  it('should detach and freeze nested input after canonical snapshot acquisition', () => {
    const original = { ...successfulPoll, identity: identity(13) };
    const canonical = copyBoundedEventInput(original);
    expect(probeEventSchema.safeParse(canonical).success).toBe(true);
    original.identity.startTicks = '999';
    original.runId = '60000000-0000-4000-8000-000000000002';
    expect(canonical).toMatchObject({ runId, identity: identity(13) });
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(Object.isFrozen((canonical as ProbeEvent).identity)).toBe(true);
    expect(createProbeRecorder(runId).record(canonical)).toBe(true);
  });

  it('should accept plain JSON and null-prototype event data with ordered SHA-256 integrity', () => {
    const recorder = createProbeRecorder(runId);
    expect(
      recorder.record(JSON.parse('{"kind":"signal","code":"SIGTERM"}')),
    ).toBe(true);
    const event = Object.assign(Object.create(null), {
      kind: 'signal',
      code: 'SIGKILL',
    });
    expect(recorder.record(event)).toBe(true);
    const artifact = serializeEvidence(recorder.seal());
    const inspected = inspectEvidence(artifact.content, artifact.sha256);
    expect(inspected.state).toBe('VERIFIED');
    if (inspected.state !== 'VERIFIED') throw new Error('Invalid fixture');
    expect(
      inspected.snapshot.entries.map(
        ({ event }) => 'code' in event && event.code,
      ),
    ).toEqual(['SIGTERM', 'SIGKILL']);
    expect(artifact.byteLength).toBe(Buffer.byteLength(artifact.content));
    expect(artifact.sha256).toBe(sha256(artifact.content));
  });

  it('should preserve event, diagnostic, input count, record and archive budgets after canonicalization', () => {
    const event = { kind: 'signal', code: 'SIGTERM' };
    const eventBytes = Buffer.byteLength(JSON.stringify(event));
    for (const limits of [
      { maximumEventBytes: eventBytes - 1 },
      { maximumDiagnosticBytes: eventBytes - 1 },
    ]) {
      const recorder = createProbeRecorder(runId, limits);
      expect(recorder.record(event)).toBe(false);
      expect(recorder.snapshot().failureCode).toBe('CAPACITY_EXCEEDED');
    }
    for (const limits of [{ maximumRecords: 1 }, { maximumInputEvents: 1 }]) {
      const recorder = createProbeRecorder(runId, limits);
      expect(recorder.record(event)).toBe(true);
      expect(recorder.record(event)).toBe(false);
      expect(recorder.snapshot().failureCode).toBe('CAPACITY_EXCEEDED');
    }
    const snapshot = signalSnapshot();
    const artifact = serializeEvidence(snapshot);
    expect(serializeEvidence(snapshot, artifact.byteLength)).toEqual(artifact);
    expect(() => serializeEvidence(snapshot, artifact.byteLength - 1)).toThrow(
      'ARCHIVE_CAPACITY_EXCEEDED',
    );
  });
});
