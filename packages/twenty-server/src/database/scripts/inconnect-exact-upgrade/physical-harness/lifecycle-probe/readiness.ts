import { copyBoundedLifecycleInput } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';
import {
  actorRoleSchema,
  readinessInputSchema,
  processIdentitySchema,
  type ActorRole,
  namespacesSchema,
  logicalTickSchema,
  observationProofSchema,
  type ReadinessInput,
  type ReadinessResult,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';
import {
  inspectOwnedLifecycle,
  sameIdentity,
  sameExecutable,
  sameNamespaces,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/ownership';

const REQUIRED_PARENTS: Record<ActorRole, ActorRole | null> = {
  guardian: null,
  'unshare-supervisor': 'guardian',
  'bwrap-supervisor': 'unshare-supervisor',
  'fenced-workload': 'bwrap-supervisor',
  'harmless-descendant': 'fenced-workload',
};

export const MAX_HELPER_LIFETIME_MILLISECONDS = 1000;
// Logical milliseconds since the run origin. Inclusive limit for every actor,
// READY proof and snapshot; no wall clock or helper presence affects freshness.
export const MAX_READINESS_AGE_TICKS = 1000;

// Validate a detached canonical inventory before traversing any nested input.
export const parseLifecycleInventory = (input: unknown) =>
  readinessInputSchema.safeParse(copyBoundedLifecycleInput(input));

export const evaluateReadiness = (
  supplied: ReadinessInput,
): ReadinessResult => {
  // Preserve the existing snapshot diagnostic even for NaN/nonfinite ticks.
  const canonical = copyBoundedLifecycleInput(supplied);
  if (!canonical || typeof canonical !== 'object')
    return { state: 'UNKNOWN', diagnostics: ['INVALID_INVENTORY'] };
  const snapshot = canonical as Record<string, unknown>;
  if (
    !logicalTickSchema.safeParse(snapshot.nowTick).success ||
    !logicalTickSchema.safeParse(snapshot.snapshotTick).success
  )
    return { state: 'UNKNOWN', diagnostics: ['INVALID_OR_STALE_SNAPSHOT'] };
  const parsed = readinessInputSchema.safeParse(canonical);
  if (!parsed.success)
    return { state: 'UNKNOWN', diagnostics: ['INVALID_INVENTORY'] };
  const input = parsed.data as ReadinessInput;
  const diagnostics: string[] = [];
  let unknown = false;
  let failed = false;
  if (
    !logicalTickSchema.safeParse(input.nowTick).success ||
    !logicalTickSchema.safeParse(input.snapshotTick).success ||
    input.snapshotTick > input.nowTick ||
    input.nowTick - input.snapshotTick > MAX_READINESS_AGE_TICKS ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      input.runId,
    )
  )
    return { state: 'UNKNOWN', diagnostics: ['INVALID_OR_STALE_SNAPSHOT'] };

  const freshProof = (
    proof: unknown,
    actor: ReadinessInput['actors'][number],
    source: 'kernel-owned-observation' | 'workload-ready-channel',
  ) => {
    const parsed = observationProofSchema.safeParse(proof);
    return (
      parsed.success &&
      parsed.data.source === source &&
      parsed.data.runId === input.runId &&
      parsed.data.actor === actor.role &&
      Number.isSafeInteger(actor.expectedGeneration) &&
      actor.expectedGeneration > 0 &&
      parsed.data.generation === actor.expectedGeneration &&
      logicalTickSchema.safeParse(actor.creationTick).success &&
      actor.creationTick <= parsed.data.observationTick &&
      parsed.data.observationTick <= input.snapshotTick &&
      input.nowTick - parsed.data.observationTick <= MAX_READINESS_AGE_TICKS
    );
  };
  const usedPids = new Set<number>();
  const usedPidfds = new Set<string>();

  for (const role of actorRoleSchema.options) {
    const matches = input.actors.filter((actor) => actor.role === role);

    if (matches.length !== 1) {
      diagnostics.push(`${role}:MISSING_OR_DUPLICATE_ACTOR`);
      unknown = true;
      continue;
    }
    const actor = matches[0];
    if (
      !freshProof(actor.observationProof, actor, 'kernel-owned-observation')
    ) {
      diagnostics.push(`${role}:STALE_OR_UNBOUND_OBSERVATION`);
      unknown = true;
    }
    const state = inspectOwnedLifecycle(actor);

    if (state !== 'LIVE_VERIFIED' || actor.observation.state !== 'live') {
      diagnostics.push(`${role}:${state}`);
      if (state === 'UNKNOWN') unknown = true;
      else failed = true;
      continue;
    }
    // The policy is independent of actor observations. Each ordered stage is an
    // explicit authorization, including namespace membership at that stage.
    const policies = input.executablePolicies.filter(
      (policy) => policy.role === role,
    );
    const policy = policies.length === 1 ? policies[0] : undefined;
    const stages = policy?.stages ?? [];
    const transitions = actor.execTransitions ?? [];
    const declaredStages = stages.map((stage) => stage.stage).join('>');
    let executionValid =
      (stages.length === 1 ||
        [
          'gate-python>bwrap',
          'bwrap>workload-python',
          'gate-python>bwrap>workload-python',
        ].includes(declaredStages)) &&
      new Set(stages.map((stage) => stage.stage)).size === stages.length &&
      transitions.length === stages.length - 1 &&
      sameExecutable(actor.creation?.identity, stages[0]?.executable) &&
      sameNamespaces(actor.creationNamespaces, stages[0]?.namespaces);
    let previousTick = actor.creationTick;
    let previousIdentity = actor.creation?.identity;
    let previousNamespaces = actor.creationNamespaces;
    for (const [index, transition] of transitions.entries()) {
      const from = stages[index];
      const to = stages[index + 1];
      if (
        !from ||
        !to ||
        transition.from !== from.stage ||
        transition.to !== to.stage ||
        !sameIdentity(previousIdentity, transition.before) ||
        !sameIdentity(transition.before, transition.after) ||
        !sameExecutable(transition.before, from.executable) ||
        !sameExecutable(transition.after, to.executable) ||
        !sameNamespaces(previousNamespaces, transition.beforeNamespaces) ||
        !sameNamespaces(transition.beforeNamespaces, from.namespaces) ||
        !sameNamespaces(transition.afterNamespaces, to.namespaces) ||
        !freshProof(transition.proof, actor, 'kernel-owned-observation') ||
        transition.proof.observationTick < previousTick ||
        transition.proof.observationTick >
          actor.observationProof?.observationTick
      )
        executionValid = false;
      previousIdentity = transition.after;
      previousNamespaces = transition.afterNamespaces;
      previousTick = transition.proof.observationTick;
    }
    const finalStage = stages[stages.length - 1];
    if (
      !executionValid ||
      !sameExecutable(actor.observation.identity, finalStage?.executable) ||
      !sameNamespaces(actor.expectedNamespaces, finalStage?.namespaces) ||
      !sameNamespaces(actor.observation.namespaces, previousNamespaces)
    ) {
      diagnostics.push(`${role}:EXECUTABLE_OR_NAMESPACE_POLICY_MISMATCH`);
      // Missing acquisition remains unknown; contradictory known policy fails.
      if (!actor.creationNamespaces || !actor.observation.namespaces || !policy)
        unknown = true;
      else failed = true;
    }
    const identity = actor.observation.identity;
    const pidfd = `${identity.pidfdDevice}:${identity.pidfdInode}`;

    if (usedPids.has(identity.pid) || usedPidfds.has(pidfd)) {
      diagnostics.push(`${role}:DUPLICATE_IDENTITY`);
      failed = true;
    }
    usedPids.add(identity.pid);
    usedPidfds.add(pidfd);

    const parentRole = REQUIRED_PARENTS[role];
    const parent = input.actors.find(
      (candidate) => candidate.role === parentRole,
    );

    if (
      parentRole === null
        ? !(
            actor.creation?.parent === null && actor.observation.parent === null
          ) && !sameIdentity(actor.creation?.parent, actor.observation.parent)
        : !sameIdentity(actor.creation?.parent, parent?.creation?.identity) ||
          !sameIdentity(actor.observation.parent, parent?.creation?.identity)
    ) {
      diagnostics.push(`${role}:ANCESTRY_MISMATCH`);
      failed = true;
    }
    const observed = namespacesSchema.safeParse(actor.observation.namespaces);
    const expected = namespacesSchema.safeParse(actor.expectedNamespaces);

    if (!observed.success || !expected.success) {
      diagnostics.push(`${role}:MISSING_NAMESPACES`);
      unknown = true;
    } else if (!sameNamespaces(observed.data, expected.data)) {
      diagnostics.push(`${role}:NAMESPACE_MISMATCH`);
      failed = true;
    }
  }

  if (
    input.otherProcesses.some(
      (record) =>
        record.kind === 'unresolved-owned-process' ||
        record.kind === 'partially-acquired-process',
    )
  ) {
    diagnostics.push('OWNED_PROCESS_UNIDENTIFIED');
    unknown = true;
  }

  const helperOrdinals = new Set<number>();

  for (const helper of input.helpers) {
    const parent = input.actors.find(
      (actor) => actor.role === helper.parentRole,
    );
    const state = inspectOwnedLifecycle(helper);
    const identity = helper.creation?.identity;
    const pidfd = identity
      ? `${identity.pidfdDevice}:${identity.pidfdInode}`
      : '';

    if (identity && (usedPids.has(identity.pid) || usedPidfds.has(pidfd))) {
      diagnostics.push('TRANSIENT_HELPER_IDENTITY_COLLISION');
      failed = true;
    }
    if (identity) {
      usedPids.add(identity.pid);
      usedPidfds.add(pidfd);
    }
    const helperPolicies = input.helperExecutablePolicies.filter(
      (policy) => policy.helperOrdinal === helper.helperOrdinal,
    );
    const approvedExecutable =
      helperPolicies.length === 1 ? helperPolicies[0].executable : undefined;
    const executableApproved =
      sameExecutable(identity, approvedExecutable) &&
      (helper.observation.state !== 'live' ||
        sameExecutable(helper.observation.identity, approvedExecutable));
    const valid =
      executableApproved &&
      Number.isSafeInteger(helper.helperOrdinal) &&
      helper.helperOrdinal > 0 &&
      !helperOrdinals.has(helper.helperOrdinal) &&
      Number.isSafeInteger(input.nowTick) &&
      input.nowTick >= 0 &&
      Number.isSafeInteger(helper.creationTick) &&
      helper.creationTick >= 0 &&
      helper.creationTick <= input.nowTick &&
      Number.isSafeInteger(helper.deadlineTick) &&
      helper.deadlineTick >= helper.creationTick &&
      helper.deadlineTick - helper.creationTick <=
        MAX_HELPER_LIFETIME_MILLISECONDS &&
      helper.parentAcknowledged &&
      sameIdentity(helper.creation?.parent, parent?.creation?.identity) &&
      ((state === 'VERIFIED_REAPED' &&
        helper.completionTick !== undefined &&
        Number.isSafeInteger(helper.completionTick) &&
        helper.completionTick >= helper.creationTick &&
        helper.completionTick <= helper.deadlineTick &&
        helper.completionTick <= input.nowTick) ||
        (state === 'LIVE_VERIFIED' &&
          helper.deadlineTick >= input.nowTick &&
          helper.observation.state === 'live' &&
          sameIdentity(helper.observation.parent, parent?.creation?.identity)));

    helperOrdinals.add(helper.helperOrdinal);
    if (!valid) {
      diagnostics.push('TRANSIENT_HELPER_UNRESOLVED');
      unknown = true;
    }
  }

  const workload = input.actors.find(
    (actor) => actor.role === 'fenced-workload',
  );

  if (
    !workload ||
    !input.workloadReady ||
    !freshProof(
      input.workloadReady && {
        runId: input.workloadReady.runId,
        actor: input.workloadReady.actor,
        generation: input.workloadReady.generation,
        observationTick: input.workloadReady.observationTick,
        source: input.workloadReady.source,
      },
      workload,
      'workload-ready-channel',
    ) ||
    input.workloadReady.observationTick >
      workload.observationProof?.observationTick ||
    input.workloadReady.observationTick <
      (workload.execTransitions?.[workload.execTransitions.length - 1]?.proof
        .observationTick ?? workload.creationTick) ||
    !sameIdentity(
      input.workloadReady.identity,
      workload.observation.state === 'live'
        ? workload.observation.identity
        : undefined,
    ) ||
    !processIdentitySchema.safeParse(input.workloadReady.identity).success ||
    (workload.observation.state === 'live' &&
      (input.workloadReady.identity.executableDevice !==
        workload.observation.identity.executableDevice ||
        input.workloadReady.identity.executableInode !==
          workload.observation.identity.executableInode))
  ) {
    diagnostics.push('WORKLOAD_READY_UNVERIFIED');
    unknown = true;
  }

  return {
    state: failed ? 'NOT_READY' : unknown ? 'UNKNOWN' : 'READY',
    diagnostics,
  };
};
