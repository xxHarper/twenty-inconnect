import {
  type ActorRole,
  actorRoleSchema,
  type OwnedLifecycle,
  type ProcessIdentity,
  type ReadinessInput,
  type TransientHelper,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';
import {
  type FinalizationActions,
  type FinalizationInput,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/finalization';
import {
  createProbeRecorder,
  type ProbeRecorder,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';
import {
  prepareEvidence,
  retainEvidence,
  type EvidenceTarget,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/evidence';

export const identity = (pid: number): ProcessIdentity => ({
  pid,
  startTicks: `${1000 + pid}`,
  executableDevice: '1',
  executableInode: `${2000 + pid}`,
  pidfdDevice: '5',
  pidfdInode: `${3000 + pid}`,
});

export const namespaces = { user: '1', network: '2', mount: '3', pid: '4' };

export const readyInput = (): ReadinessInput => {
  const parents: Record<ActorRole, number | null> = {
    guardian: null,
    'unshare-supervisor': 10,
    'bwrap-supervisor': 11,
    'fenced-workload': 12,
    'harmless-descendant': 13,
  };

  return {
    runId,
    snapshotTick: 100,
    helperExecutablePolicies: [
      {
        helperOrdinal: 1,
        executable: {
          executableDevice: '1',
          executableInode: '2020',
        },
      },
    ],
    executablePolicies: actorRoleSchema.options.map((role, index) => ({
      role,
      stages: [
        {
          stage: 'steady',
          executable: {
            executableDevice: '1',
            executableInode: `${2010 + index}`,
          },
          namespaces: { ...namespaces },
        },
      ],
    })),
    actors: actorRoleSchema.options.map((role, index) => {
      const parentPid = parents[role];
      const parent = parentPid === null ? null : identity(parentPid);

      return {
        kind: 'stable-owned-actor',
        role,
        expectedGeneration: 1,
        creationTick: 0,
        observationProof: {
          runId,
          actor: role,
          generation: 1,
          observationTick: 100,
          source: 'kernel-owned-observation',
        },
        expectedNamespaces: { ...namespaces },
        creationNamespaces: { ...namespaces },
        creation: {
          source: 'direct-parent-report',
          identity: identity(index + 10),
          parent,
        },
        observation: {
          state: 'live',
          identity: identity(index + 10),
          parent,
          namespaces: { ...namespaces },
        },
      };
    }),
    helpers: [],
    otherProcesses: [],
    nowTick: 100,
    workloadReady: {
      identity: identity(13),
      runId,
      actor: 'fenced-workload',
      generation: 1,
      observationTick: 90,
      source: 'workload-ready-channel',
    },
  };
};

export const exited = (record: OwnedLifecycle): OwnedLifecycle => ({
  creation: record.creation,
  observation: { state: 'unavailable', error: 'ENOENT' },
  exit: {
    identity: record.creation?.identity ?? identity(999),
    pidfdExitObserved: true,
    reaping: { source: 'kernel-pidfd-hup' },
  },
});

export const completedHelper = (): TransientHelper => ({
  kind: 'tracked-transient-helper',
  helperOrdinal: 1,
  parentRole: 'fenced-workload',
  creationTick: 60,
  deadlineTick: 80,
  completionTick: 70,
  parentAcknowledged: true,
  creation: {
    source: 'direct-parent-report',
    identity: identity(20),
    parent: identity(13),
  },
  observation: { state: 'unavailable', error: 'ENOENT' },
  exit: {
    identity: identity(20),
    pidfdExitObserved: true,
    reaping: { source: 'actual-parent-wait', parent: identity(13) },
  },
});

export const finalizationInput = (): FinalizationInput => ({
  recorder: testRecorder(),
  inventory: readyInput(),
  readiness: { state: 'READY', diagnostics: [] },
  requiredDescriptorOrdinals: [1, 2, 3, 4, 5, 6],
  intentionalSignalObserved: true,
  observationWindowComplete: true,
  telemetryComplete: true,
});

export const finalizationActions = (
  input: FinalizationInput,
): FinalizationActions => ({
  processExits: async () =>
    [...input.inventory.actors, ...input.inventory.helpers].map(exited),
  namespaceHolders: async () => ({
    namespaces: { ...namespaces },
    scannedNamespaces: [],
    holders: [],
    scanComplete: true,
  }),
  descriptorClosures: async () => true,
  output: async () => ({ eof: true, bufferedBytes: 0 }),
  parentInvariants: async () => true,
});

const testRecorder = () => {
  const recorder = createProbeRecorder(runId);
  recorder.record({ kind: 'transition', code: 'READY' });
  return recorder;
};

export const reportSuccess = async (
  _result: unknown,
  recorder: ProbeRecorder,
) => {
  let stored = '';
  const retention = await retainEvidence(
    recorder,
    prepareEvidence(recorder),
    evidenceTarget(),
    runId,
    1000,
    {
      writeExclusive: async (_target, content) => {
        stored = content;
      },
      readBack: async () => stored,
    },
  );
  return {
    evidenceRetained: retention.state === 'RETAINED',
    summaryDelivered: true,
    retention,
  };
};

export const runId = '60000000-0000-4000-8000-000000000001';

export const evidenceTarget = (): EvidenceTarget => ({
  runId,
  path: `/tmp/inconnect-lifecycle-${runId}/evidence.json`,
  openedRoot: {
    realPath: `/tmp/inconnect-lifecycle-${runId}`,
    runId,
    device: '1',
    inode: '2',
    ownerUid: 1000,
    mode: 0o700,
    symlinkFree: true,
    exclusiveTestOwned: true,
  },
});

// Synthetic approved policy is supplied independently; never copied from current
// executable observations. No host inode/device value is acquired by this fixture.
export const execInput = (): ReadinessInput => {
  const input = readyInput();
  const actor = input.actors[3];
  const policy = input.executablePolicies[3];
  policy.stages = [
    {
      stage: 'gate-python',
      executable: { executableDevice: '7', executableInode: '101' },
      namespaces: { ...namespaces },
    },
    {
      stage: 'bwrap',
      executable: { executableDevice: '7', executableInode: '102' },
      namespaces: { ...namespaces },
    },
    {
      stage: 'workload-python',
      executable: { executableDevice: '7', executableInode: '103' },
      namespaces: { ...namespaces, network: '99' },
    },
  ];
  if (
    !actor.creation ||
    actor.observation.state !== 'live' ||
    !input.workloadReady
  )
    throw new Error('Invalid fixture');
  actor.creation.identity = { ...identity(13), ...policy.stages[0].executable };
  actor.observation.identity = {
    ...identity(13),
    ...policy.stages[2].executable,
  };
  actor.expectedNamespaces = { ...policy.stages[2].namespaces };
  actor.observation.namespaces = { ...actor.expectedNamespaces };
  actor.execTransitions = [0, 1].map((index) => ({
    from: policy.stages[index].stage,
    to: policy.stages[index + 1].stage,
    before: { ...identity(13), ...policy.stages[index].executable },
    after: { ...identity(13), ...policy.stages[index + 1].executable },
    beforeNamespaces: { ...policy.stages[index].namespaces },
    afterNamespaces: { ...policy.stages[index + 1].namespaces },
    proof: {
      runId,
      actor: actor.role,
      generation: 1,
      observationTick: 20 + index * 30,
      source: 'kernel-owned-observation',
    },
  }));
  input.workloadReady.identity = { ...actor.observation.identity };
  return input;
};
