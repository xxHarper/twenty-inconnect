import {
  completedHelper,
  execInput,
  identity,
  readyInput,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/__tests__/fixtures';
import { type PartialAcquisition } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';
import {
  inspectOwnedLifecycle,
  sameIdentity,
  inspectPartialAcquisition,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/ownership';
import { evaluateReadiness } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/readiness';

describe('pure lifecycle ownership and readiness', () => {
  it('should reject a transient helper sharing a stable actor identity', () => {
    const input = readyInput();
    const helper = completedHelper();

    helper.creation = {
      source: 'direct-parent-report',
      identity: identity(14),
      parent: identity(13),
    };
    helper.exit = {
      identity: identity(14),
      pidfdExitObserved: true,
      reaping: { source: 'actual-parent-wait', parent: identity(13) },
    };
    input.helpers.push(helper);
    expect(evaluateReadiness(input).state).toBe('NOT_READY');
  });

  it('should bound helper lifetimes and refuse expired live helpers', () => {
    const input = readyInput();
    const helper = completedHelper();

    helper.deadlineTick = 2000;
    input.helpers.push(helper);
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    helper.deadlineTick = 80;
    helper.exit = undefined;
    helper.observation = {
      state: 'live',
      identity: identity(20),
      parent: identity(13),
    };
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it('should refuse missing namespace evidence and a mismatched guardian parent', () => {
    const input = readyInput();
    const guardian = input.actors[0].observation;

    if (guardian.state !== 'live') throw new Error('Invalid fixture');
    guardian.namespaces = undefined;
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    guardian.parent = identity(99);
    expect(evaluateReadiness(input).state).toBe('NOT_READY');
  });

  it('should preserve stable readiness after a parent-acknowledged helper completed within its deadline', () => {
    const input = readyInput();

    input.helpers.push(completedHelper());
    input.otherProcesses.push({
      kind: 'unowned-observation-candidate',
      pid: 64,
      error: 'ENOENT',
    });
    const before = structuredClone(input);

    expect(evaluateReadiness(input)).toEqual({
      state: 'READY',
      diagnostics: [],
    });
    expect(input).toEqual(before);
    expect(evaluateReadiness(input)).toEqual(evaluateReadiness(before));
  });

  it('should prevent readiness when a stable actor is unknown', () => {
    const input = readyInput();

    input.actors[2].observation = { state: 'unavailable', error: 'ENOENT' };
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it('should prevent readiness when a required stable role is missing', () => {
    const input = readyInput();

    input.actors.pop();
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it('should keep an owned unidentified process UNKNOWN even after incidental disappearance', () => {
    const input = readyInput();

    input.otherProcesses.push({ kind: 'unresolved-owned-process', pid: 65 });
    expect(evaluateReadiness(input)).toEqual({
      state: 'UNKNOWN',
      diagnostics: ['OWNED_PROCESS_UNIDENTIFIED'],
    });
  });

  it.each(['ENOENT', 'ESRCH'] as const)(
    'should reconcile %s only with identity-bound exit and reaping evidence',
    (error) => {
      const helper = completedHelper();

      helper.observation = { state: 'unavailable', error };
      expect(inspectOwnedLifecycle(helper)).toBe('VERIFIED_REAPED');
      helper.exit = { identity: identity(20), pidfdExitObserved: true };
      expect(inspectOwnedLifecycle(helper)).toBe('EXIT_OBSERVED');
      helper.exit = {
        identity: identity(20),
        pidfdExitObserved: false,
        reaping: { source: 'kernel-pidfd-hup' },
      };
      expect(inspectOwnedLifecycle(helper)).toBe('UNKNOWN');
      helper.exit = undefined;
      expect(inspectOwnedLifecycle(helper)).toBe('UNKNOWN');
      helper.creation = undefined;
      expect(inspectOwnedLifecycle(helper)).toBe('UNKNOWN');
    },
  );

  it.each([
    'pid',
    'startTicks',
    'executableDevice',
    'executableInode',
    'pidfdDevice',
    'pidfdInode',
  ] as const)('should reject PID reuse or %s identity mismatch', (key) => {
    const input = readyInput();
    const observation = input.actors[3].observation;

    if (observation.state !== 'live') throw new Error('Invalid fixture');
    observation.identity = {
      ...observation.identity,
      [key]: key === 'pid' ? 99 : '999',
    };
    expect(evaluateReadiness(input).state).toBe('NOT_READY');
  });

  it('should reject exit evidence referring to a different retained identity', () => {
    const helper = completedHelper();

    helper.exit = {
      identity: identity(99),
      pidfdExitObserved: true,
      reaping: { source: 'kernel-pidfd-hup' },
    };
    expect(inspectOwnedLifecycle(helper)).toBe('IDENTITY_MISMATCH');
  });

  it('should require the actual creating parent for a helper wait acknowledgment', () => {
    const helper = completedHelper();

    helper.exit = {
      identity: identity(20),
      pidfdExitObserved: true,
      reaping: { source: 'actual-parent-wait', parent: identity(99) },
    };
    expect(inspectOwnedLifecycle(helper)).toBe('EXIT_OBSERVED');
  });

  it('should treat ECHILD alone as insufficient even for a previously identified child', () => {
    const helper = completedHelper();

    helper.exit = {
      identity: identity(20),
      pidfdExitObserved: false,
      waitError: 'ECHILD',
    };
    expect(inspectOwnedLifecycle(helper)).toBe('UNKNOWN');
  });

  it.each(['parent', 'namespace', 'ready', 'duplicate'] as const)(
    'should reject invalid %s evidence',
    (field) => {
      const input = readyInput();
      const actor = input.actors[3];

      if (actor.observation.state !== 'live')
        throw new Error('Invalid fixture');
      if (field === 'parent') actor.observation.parent = identity(99);
      if (field === 'namespace')
        actor.observation.namespaces = {
          user: '99',
          network: '2',
          mount: '3',
          pid: '4',
        };
      if (field === 'ready' && input.workloadReady)
        input.workloadReady.identity = identity(99);
      if (field === 'duplicate') input.actors.push(structuredClone(actor));
      expect(evaluateReadiness(input).state).not.toBe('READY');
    },
  );

  it.each(['acknowledgment', 'deadline', 'acquisition'] as const)(
    'should block a helper with incomplete %s',
    (field) => {
      const input = readyInput();
      const helper = completedHelper();

      if (field === 'acknowledgment') helper.parentAcknowledged = false;
      if (field === 'deadline') helper.completionTick = 81;
      if (field === 'acquisition') helper.creation = undefined;
      input.helpers.push(helper);
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );
});

describe('P1 run-bound fresh readiness regressions without helpers', () => {
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'should reject nowTick %s even without helper obligations',
    (nowTick) => {
      const input = readyInput();
      input.nowTick = nowTick;
      expect(input.helpers).toHaveLength(0);
      expect(evaluateReadiness(input)).toEqual({
        state: 'UNKNOWN',
        diagnostics: ['INVALID_OR_STALE_SNAPSHOT'],
      });
    },
  );

  it('should reject a stale required stable actor with a fresh snapshot and READY proof', () => {
    const input = readyInput();
    input.nowTick = 1101;
    input.snapshotTick = 1101;
    for (const actor of input.actors)
      actor.observationProof.observationTick = 1101;
    if (!input.workloadReady) throw new Error('Invalid fixture');
    input.workloadReady.observationTick = 1100;
    input.actors[0].observationProof.observationTick = 100;
    expect(evaluateReadiness(input).diagnostics).toContain(
      'guardian:STALE_OR_UNBOUND_OBSERVATION',
    );
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it('should reject stale workload READY while all stable actors are fresh', () => {
    const input = readyInput();
    input.nowTick = 1101;
    input.snapshotTick = 1101;
    for (const actor of input.actors)
      actor.observationProof.observationTick = 1101;
    if (!input.workloadReady) throw new Error('Invalid fixture');
    input.workloadReady.observationTick = 100;
    expect(evaluateReadiness(input)).toEqual({
      state: 'UNKNOWN',
      diagnostics: ['WORKLOAD_READY_UNVERIFIED'],
    });
  });

  it('should reject mixed-run stable observations and READY proof', () => {
    const input = readyInput();
    input.actors[2].observationProof.runId =
      '60000000-0000-4000-8000-000000000002';
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    input.actors[2].observationProof.runId = input.runId;
    if (!input.workloadReady) throw new Error('Invalid fixture');
    input.workloadReady.runId = '60000000-0000-4000-8000-000000000002';
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it.each(['stable', 'ready'] as const)(
    'should reject a future %s observation',
    (field) => {
      const input = readyInput();
      const proof =
        field === 'stable'
          ? input.actors[1].observationProof
          : input.workloadReady;
      if (!proof) throw new Error('Invalid fixture');
      proof.observationTick = input.nowTick + 1;
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );

  it.each(['stable', 'ready'] as const)(
    'should reject a missing %s observation tick',
    (field) => {
      const input = readyInput();
      const proof =
        field === 'stable'
          ? input.actors[1].observationProof
          : input.workloadReady;
      if (!proof) throw new Error('Invalid fixture');
      Reflect.deleteProperty(proof, 'observationTick');
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );

  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'should reject invalid observation tick %s in stable and READY evidence',
    (tick) => {
      const stable = readyInput();
      stable.actors[1].observationProof.observationTick = tick;
      expect(evaluateReadiness(stable).state).toBe('UNKNOWN');
      const ready = readyInput();
      if (!ready.workloadReady) throw new Error('Invalid fixture');
      ready.workloadReady.observationTick = tick;
      expect(evaluateReadiness(ready).state).toBe('UNKNOWN');
    },
  );

  it('should reject replayed old evidence after advancing the current logical tick', () => {
    const input = readyInput();
    expect(evaluateReadiness(input).state).toBe('READY');
    input.nowTick = 1101;
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    // Updating only the containing snapshot cannot refresh the actor proofs.
    input.snapshotTick = 1101;
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it.each(['stable', 'ready'] as const)(
    'should reject a mismatched %s identity generation',
    (field) => {
      const input = readyInput();
      const proof =
        field === 'stable'
          ? input.actors[3].observationProof
          : input.workloadReady;
      if (!proof) throw new Error('Invalid fixture');
      proof.generation = 2;
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );

  it.each(['actor', 'source'] as const)(
    'should reject incorrect observation %s provenance',
    (field) => {
      const input = readyInput();
      if (field === 'actor')
        input.actors[1].observationProof.actor = 'guardian';
      if (field === 'source')
        input.actors[1].observationProof.source = 'workload-ready-channel';
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
      const ready = readyInput();
      if (!ready.workloadReady) throw new Error('Invalid fixture');
      if (field === 'actor') ready.workloadReady.actor = 'guardian';
      if (field === 'source')
        ready.workloadReady.source = 'kernel-owned-observation';
      expect(evaluateReadiness(ready).state).toBe('UNKNOWN');
    },
  );

  it.each(['snapshot', 'creation', 'ready-after-observation'] as const)(
    'should reject contradictory %s ordering',
    (ordering) => {
      const input = readyInput();
      if (ordering === 'snapshot') input.snapshotTick = 99;
      if (ordering === 'creation') input.actors[1].creationTick = 101;
      if (ordering === 'ready-after-observation') {
        input.actors[3].observationProof.observationTick = 80;
      }
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );

  it('should accept finite fresh evidence at the inclusive freshness boundary and reject one tick later', () => {
    const input = readyInput();
    input.nowTick = 1090;
    expect(evaluateReadiness(input)).toEqual({
      state: 'READY',
      diagnostics: [],
    });
    input.nowTick = 1091;
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
  });

  it('should reject a missing stable proof and missing workload READY evidence', () => {
    const input = readyInput();
    Reflect.deleteProperty(input.actors[0], 'observationProof');
    expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    const ready = readyInput();
    ready.workloadReady = undefined;
    expect(evaluateReadiness(ready).state).toBe('UNKNOWN');
  });
});

describe('M2 kernel identity, executable approval and acquisition', () => {
  it('should accept independent approved process policy', () => {
    const input = readyInput();
    expect(evaluateReadiness(input)).toEqual({
      state: 'READY',
      diagnostics: [],
    });
    expect(
      sameIdentity(identity(13), { ...identity(13), executableInode: '999' }),
    ).toBe(true);
    expect(
      sameIdentity(identity(13), { ...identity(13), startTicks: '999' }),
    ).toBe(false);
  });

  it('should model both approved C4 execs without classifying them as PID reuse', () => {
    const input = execInput();
    expect(inspectOwnedLifecycle(input.actors[3])).toBe('LIVE_VERIFIED');
    expect(evaluateReadiness(input)).toEqual({
      state: 'READY',
      diagnostics: [],
    });
  });

  it.each([
    'creation-provenance',
    'current-provenance',
    'undeclared',
    'wrong-stage',
    'changed-starttime',
    'changed-pidfd',
    'missing-pidfd',
    'namespace-continuity',
    'creation-namespace',
    'transition-before',
    'namespace-policy',
    'missing-policy',
    'self-asserted-approval',
    'duplicate-policy',
    'partial-policy',
    'skipped-stage',
  ])('should reject %s from a valid exec baseline', (problem) => {
    const input = execInput();
    expect(evaluateReadiness(input).state).toBe('READY');
    const actor = input.actors[3];
    const transitions = actor.execTransitions;
    if (!actor.creation || actor.observation.state !== 'live' || !transitions)
      throw new Error('Invalid fixture');
    if (problem === 'creation-provenance')
      actor.creation.identity.executableInode = '999';
    if (
      problem === 'current-provenance' ||
      problem === 'self-asserted-approval'
    )
      actor.observation.identity.executableInode = '999';
    if (problem === 'self-asserted-approval') {
      transitions[1].after.executableInode = '999';
      if (input.workloadReady)
        input.workloadReady.identity.executableInode = '999';
    }
    if (problem === 'undeclared') actor.execTransitions = [];
    if (problem === 'wrong-stage') transitions[0].to = 'workload-python';
    if (problem === 'changed-starttime')
      actor.observation.identity.startTicks = '999';
    if (problem === 'changed-pidfd')
      actor.observation.identity.pidfdInode = '999';
    if (problem === 'missing-pidfd')
      Reflect.deleteProperty(actor.creation.identity, 'pidfdInode');
    if (problem === 'namespace-continuity')
      transitions[1].beforeNamespaces.network = '55';
    if (problem === 'creation-namespace') actor.creationNamespaces = undefined;
    if (problem === 'transition-before')
      transitions[1].before.executableInode = '999';
    if (problem === 'namespace-policy') {
      actor.expectedNamespaces.network = '55';
      actor.observation.namespaces = { ...actor.expectedNamespaces };
      transitions[1].afterNamespaces = { ...actor.expectedNamespaces };
    }
    if (problem === 'missing-policy') input.executablePolicies.splice(3, 1);
    if (problem === 'duplicate-policy')
      input.executablePolicies.push(
        structuredClone(input.executablePolicies[3]),
      );
    if (problem === 'partial-policy') input.executablePolicies[3].stages.pop();
    if (problem === 'skipped-stage') transitions.shift();
    expect(evaluateReadiness(input).state).not.toBe('READY');
    if (problem === 'current-provenance')
      expect(evaluateReadiness(input).diagnostics).not.toContain(
        'fenced-workload:IDENTITY_MISMATCH',
      );
  });

  it.each([
    'stale',
    'mixed-run',
    'generation',
    'future',
    'order',
    'ready-before-exec',
  ])('should reject %s transition evidence under P1 freshness', (problem) => {
    const input = execInput();
    expect(evaluateReadiness(input).state).toBe('READY');
    const transitions = input.actors[3].execTransitions;
    if (!transitions) throw new Error('Invalid fixture');
    if (problem === 'stale') {
      input.nowTick = 1100;
      input.snapshotTick = 1100;
      for (const actor of input.actors)
        actor.observationProof.observationTick = 1100;
      if (input.workloadReady) input.workloadReady.observationTick = 1090;
    }
    if (problem === 'mixed-run')
      transitions[0].proof.runId = '60000000-0000-4000-8000-000000000002';
    if (problem === 'generation') transitions[0].proof.generation = 2;
    if (problem === 'future') transitions[0].proof.observationTick = 101;
    if (problem === 'order') transitions[1].proof.observationTick = 19;
    if (problem === 'ready-before-exec' && input.workloadReady)
      input.workloadReady.observationTick = 49;
    expect(evaluateReadiness(input).state).not.toBe('READY');
  });

  it.each(['live', 'exited', 'wrong-exit'] as const)(
    'should keep partial pidfd acquisition unresolved after %s accounting',
    (state) => {
      const input = readyInput();
      const { pid, startTicks, pidfdDevice, pidfdInode } = identity(66);
      const partial: PartialAcquisition = {
        kind: 'partially-acquired-process',
        identity: { pid, startTicks, pidfdDevice, pidfdInode },
        missing: ['executable', 'namespaces'],
      };
      if (state !== 'live')
        partial.exit = {
          identity: {
            ...partial.identity,
            startTicks: state === 'wrong-exit' ? '999' : startTicks,
          },
          pidfdExitObserved: true,
          reaped: true,
        };
      input.otherProcesses.push(partial);
      expect(inspectPartialAcquisition(partial)).toBe(
        state === 'exited'
          ? 'EXIT_ACCOUNTED_ACQUISITION_UNRESOLVED'
          : 'UNRESOLVED',
      );
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );

  it('should reject malformed lifecycle observation directly without throwing a TypeError', () => {
    expect(
      inspectOwnedLifecycle({
        creation: {
          source: 'direct-parent-report',
          identity: identity(13),
          parent: null,
        },
      }),
    ).toBe('UNKNOWN');
    const trap = jest.fn(() => {
      throw new Error('forbidden');
    });
    expect(
      inspectOwnedLifecycle(
        Object.defineProperty({}, 'observation', {
          get: trap,
          enumerable: true,
        }),
      ),
    ).toBe('UNKNOWN');
    expect(trap).not.toHaveBeenCalled();
  });
});

describe('M2 approved single exec and helper provenance', () => {
  it.each(['gate-python>bwrap', 'bwrap>workload-python'])(
    'should verify a declared %s transition independently',
    (pair) => {
      const input = execInput();
      const actor = input.actors[3];
      const policy = input.executablePolicies[3];
      if (
        !actor.creation ||
        actor.observation.state !== 'live' ||
        !actor.execTransitions ||
        !input.workloadReady
      )
        throw new Error('Invalid fixture');
      const offset = pair === 'gate-python>bwrap' ? 0 : 1;
      policy.stages = policy.stages.slice(offset, offset + 2);
      actor.execTransitions = actor.execTransitions.slice(offset, offset + 1);
      actor.creation.identity = {
        ...identity(13),
        ...policy.stages[0].executable,
      };
      actor.creationNamespaces = { ...policy.stages[0].namespaces };
      actor.expectedNamespaces = { ...policy.stages[1].namespaces };
      actor.observation.identity = {
        ...identity(13),
        ...policy.stages[1].executable,
      };
      actor.observation.namespaces = { ...actor.expectedNamespaces };
      input.workloadReady.identity = { ...actor.observation.identity };
      expect(evaluateReadiness(input)).toEqual({
        state: 'READY',
        diagnostics: [],
      });
    },
  );

  it.each(['missing', 'self-asserted', 'duplicate'] as const)(
    'should reject %s helper executable approval even after exit',
    (problem) => {
      const input = readyInput();
      input.helpers.push(completedHelper());
      expect(evaluateReadiness(input).state).toBe('READY');
      if (problem === 'missing') input.helperExecutablePolicies = [];
      if (problem === 'duplicate')
        input.helperExecutablePolicies.push(
          structuredClone(input.helperExecutablePolicies[0]),
        );
      if (problem === 'self-asserted' && input.helpers[0].creation)
        input.helpers[0].creation.identity.executableInode = '999';
      expect(evaluateReadiness(input).state).toBe('UNKNOWN');
    },
  );
});
