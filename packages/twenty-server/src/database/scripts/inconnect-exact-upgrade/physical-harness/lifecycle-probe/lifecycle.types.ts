import { z } from 'zod';

export const actorRoleSchema = z.enum([
  'guardian',
  'unshare-supervisor',
  'bwrap-supervisor',
  'fenced-workload',
  'harmless-descendant',
]);

export type ActorRole = z.infer<typeof actorRoleSchema>;

// Linux identifiers fit comfortably within 64 decimal characters. Reject before
// regex/serialization so caller strings cannot amplify recorder allocations.
export const MAX_IDENTIFIER_CHARACTERS = 64;
export const kernelIdentifier = z
  .string()
  .max(MAX_IDENTIFIER_CHARACTERS)
  .regex(/^[1-9][0-9]*$/);

// Stable kernel identity excludes executable identity: exec preserves the process.
export const kernelProcessIdentitySchema = z
  .object({
    pid: z.number().int().positive().safe(),
    startTicks: kernelIdentifier,
    pidfdDevice: kernelIdentifier,
    pidfdInode: kernelIdentifier,
  })
  .strict();
export type KernelProcessIdentity = z.infer<typeof kernelProcessIdentitySchema>;
export const executableIdentitySchema = z
  .object({
    executableDevice: kernelIdentifier,
    executableInode: kernelIdentifier,
  })
  .strict();
export type ExecutableIdentity = z.infer<typeof executableIdentitySchema>;
// Observation wire shape retains both concepts, without conflating comparison.
export const processIdentitySchema = kernelProcessIdentitySchema
  .extend(executableIdentitySchema.shape)
  .strict();

export type ProcessIdentity = z.infer<typeof processIdentitySchema>;

export const namespacesSchema = z
  .object({
    user: kernelIdentifier,
    network: kernelIdentifier,
    mount: kernelIdentifier,
    pid: kernelIdentifier,
  })
  .strict();

export type Namespaces = z.infer<typeof namespacesSchema>;

export type ProcessObservation =
  | {
      state: 'live';
      identity: ProcessIdentity;
      parent: ProcessIdentity | null;
      namespaces?: Namespaces;
    }
  | { state: 'unavailable'; error: 'ENOENT' | 'ESRCH' | 'UNKNOWN' };

export type ExitEvidence = {
  identity: ProcessIdentity;
  pidfdExitObserved: boolean;
  reaping?:
    | { source: 'kernel-pidfd-hup' }
    | { source: 'actual-parent-wait'; parent: ProcessIdentity };
  // ECHILD is diagnostic only; it does not establish an exit or a reap.
  waitError?: 'ECHILD';
};

export const ownedLifecycleSchema = z
  .object({
    creation: z
      .object({
        source: z.literal('direct-parent-report'),
        identity: processIdentitySchema,
        parent: processIdentitySchema.nullable(),
      })
      .strict()
      .optional(),
    observation: z.union([
      z
        .object({
          state: z.literal('live'),
          identity: processIdentitySchema,
          parent: processIdentitySchema.nullable(),
          namespaces: namespacesSchema.optional(),
        })
        .strict(),
      z
        .object({
          state: z.literal('unavailable'),
          error: z.enum(['ENOENT', 'ESRCH', 'UNKNOWN']),
        })
        .strict(),
    ]),
    exit: z
      .object({
        identity: processIdentitySchema,
        pidfdExitObserved: z.boolean(),
        reaping: z
          .union([
            z.object({ source: z.literal('kernel-pidfd-hup') }).strict(),
            z
              .object({
                source: z.literal('actual-parent-wait'),
                parent: processIdentitySchema,
              })
              .strict(),
          ])
          .optional(),
        waitError: z.literal('ECHILD').optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type OwnedLifecycle = {
  creation?: {
    source: 'direct-parent-report';
    identity: ProcessIdentity;
    parent: ProcessIdentity | null;
  };
  observation: ProcessObservation;
  exit?: ExitEvidence;
};

export const logicalTickSchema = z.number().int().nonnegative().safe();

export const observationProofSchema = z
  .object({
    runId: z.string().uuid(),
    actor: actorRoleSchema,
    generation: z.number().int().positive().safe(),
    observationTick: logicalTickSchema,
    source: z.enum(['kernel-owned-observation', 'workload-ready-channel']),
  })
  .strict();

export type ObservationProof = z.infer<typeof observationProofSchema>;

// Independently supplied trusted policy, never inferred from observations.
// Future adapters must open/verify approved executables separately from /proc
// observations. Pure policy data alone is not kernel-backed signal authority.
export const executableStageSchema = z
  .object({
    stage: z.enum(['steady', 'gate-python', 'bwrap', 'workload-python']),
    executable: executableIdentitySchema,
    namespaces: namespacesSchema,
  })
  .strict();
export const actorExecutionPolicySchema = z
  .object({
    role: actorRoleSchema,
    stages: z.array(executableStageSchema).min(1).max(3),
  })
  .strict();
export type ActorExecutionPolicy = z.infer<typeof actorExecutionPolicySchema>;
export const execTransitionSchema = z
  .object({
    from: executableStageSchema.shape.stage,
    to: executableStageSchema.shape.stage,
    before: processIdentitySchema,
    after: processIdentitySchema,
    beforeNamespaces: namespacesSchema,
    afterNamespaces: namespacesSchema,
    proof: observationProofSchema,
  })
  .strict();
export type ExecTransition = z.infer<typeof execTransitionSchema>;

export const stableActorSchema = ownedLifecycleSchema
  .extend({
    kind: z.literal('stable-owned-actor'),
    role: actorRoleSchema,
    expectedNamespaces: namespacesSchema,
    creationNamespaces: namespacesSchema.optional(),
    execTransitions: z.array(execTransitionSchema).max(2).optional(),
    expectedGeneration: z.number(),
    creationTick: z.number(),
    // Detailed freshness/provenance errors are evaluated separately.
    observationProof: z.unknown(),
  })
  .strict();
export type StableActor = Omit<
  z.infer<typeof stableActorSchema>,
  'observationProof'
> & {
  observationProof: ObservationProof;
};
export const transientHelperSchema = ownedLifecycleSchema
  .extend({
    kind: z.literal('tracked-transient-helper'),
    helperOrdinal: z.number(),
    parentRole: actorRoleSchema,
    creationTick: z.number(),
    deadlineTick: z.number(),
    completionTick: z.number().optional(),
    parentAcknowledged: z.boolean(),
  })
  .strict();
export type TransientHelper = z.infer<typeof transientHelperSchema>;

// Retained pidfd acquisition is an obligation even when other evidence fails.
// Exit accounting never promotes this to verified acquisition/signal authority.
export const partialAcquisitionSchema = z
  .object({
    kind: z.literal('partially-acquired-process'),
    identity: kernelProcessIdentitySchema,
    missing: z
      .array(z.enum(['executable', 'namespaces', 'ancestry']))
      .min(1)
      .max(3)
      .refine((missing) => new Set(missing).size === missing.length),
    exit: z
      .object({
        identity: kernelProcessIdentitySchema,
        pidfdExitObserved: z.boolean(),
        reaped: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PartialAcquisition = z.infer<typeof partialAcquisitionSchema>;
export const otherProcessSchema = z.union([
  z
    .object({
      kind: z.literal('unowned-observation-candidate'),
      pid: z.number().int().positive().safe(),
      error: z.enum(['ENOENT', 'ESRCH', 'UNKNOWN']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unresolved-owned-process'),
      pid: z.number().int().positive().safe(),
    })
    .strict(),
  partialAcquisitionSchema,
]);
export type OtherProcess = z.infer<typeof otherProcessSchema>;
export const readinessInputSchema = z
  .object({
    runId: z.string(),
    snapshotTick: z.number(),
    actors: z.array(stableActorSchema).max(64),
    helpers: z.array(transientHelperSchema).max(128),
    otherProcesses: z.array(otherProcessSchema).max(128),
    // Required independent policy boundary; observations cannot supply approval.
    executablePolicies: z.array(actorExecutionPolicySchema).max(64),
    helperExecutablePolicies: z
      .array(
        z
          .object({
            helperOrdinal: z.number().int().positive().safe(),
            executable: executableIdentitySchema,
          })
          .strict(),
      )
      .max(128),
    nowTick: z.number(),
    workloadReady: z.unknown(),
  })
  .strict();
export type ReadinessInput = Omit<
  z.infer<typeof readinessInputSchema>,
  'actors' | 'workloadReady'
> & {
  actors: StableActor[];
  workloadReady?: ObservationProof & { identity: ProcessIdentity };
};
export type ProcessState =
  | 'LIVE_VERIFIED'
  | 'VERIFIED_REAPED'
  | 'EXIT_OBSERVED'
  | 'UNKNOWN'
  | 'IDENTITY_MISMATCH';
export type ReadinessResult = {
  state: 'READY' | 'UNKNOWN' | 'NOT_READY';
  diagnostics: string[];
};
