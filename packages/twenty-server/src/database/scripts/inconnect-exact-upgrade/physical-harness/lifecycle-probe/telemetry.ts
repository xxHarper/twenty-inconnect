import { types } from 'node:util';
import { z } from 'zod';

import {
  actorRoleSchema,
  namespacesSchema,
  processIdentitySchema,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';

// No free-text messages, command arguments, environment, application values,
// arbitrary paths or exception strings may cross this telemetry boundary.
export const probeEventSchema = z.union([
  z
    .object({
      kind: z.literal('successful-poll'),
      actor: actorRoleSchema,
      runId: z.string().uuid(),
      ownershipGeneration: z.number().int().positive().safe(),
      helperOrdinal: z.number().int().positive().safe().optional(),
      state: z.enum(['LIVE_VERIFIED', 'EXIT_OBSERVED', 'VERIFIED_REAPED']),
      check: z.enum([
        'identity',
        'namespaces',
        'exit',
        'reaping',
        'descriptors',
      ]),
      identity: processIdentitySchema,
      namespaces: namespacesSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.enum([
        'exception',
        'signal',
        'transition',
        'ownership-mismatch',
        'exit',
        'reaping',
        'descriptor-closure',
        'output-overflow',
        'retention-failure',
      ]),
      code: z.enum([
        'ENOENT',
        'ESRCH',
        'ECHILD',
        'UNKNOWN',
        'READY',
        'EXIT_OBSERVED',
        'REAP_ACKNOWLEDGED',
        'IDENTITY_MISMATCH',
        'FINALIZATION_INCOMPLETE',
        'SIGTERM',
        'SIGKILL',
        'CLOSED',
        'CLOSE_FAILED',
        'OUTPUT_BUDGET_EXCEEDED',
        'INVALID_EVENT',
        'RECORDING_ALREADY_SEALED',
      ]),
      actor: actorRoleSchema.optional(),
      ownership: z
        .enum([
          'stable-owned-actor',
          'tracked-transient-helper',
          'unowned-observation-candidate',
          'unresolved-owned-process',
        ])
        .optional(),
      observedPid: z.number().int().positive().safe().optional(),
      helperOrdinal: z.number().int().positive().safe().optional(),
      identity: processIdentitySchema.optional(),
      parent: processIdentitySchema.optional(),
      namespaces: namespacesSchema.optional(),
      reapingSource: z
        .enum(['actual-parent-wait', 'kernel-pidfd-hup'])
        .optional(),
      descriptorOrdinal: z.number().int().positive().safe().optional(),
    })
    .strict(),
]);

export type ProbeEvent = z.infer<typeof probeEventSchema>;

// Defaults permit short diagnostic runs; caller overrides may only reduce or
// increase within these conservative ceilings. Bytes are UTF-8 serialized bytes.
export const DEFAULT_RECORDER_LIMITS = Object.freeze({
  maximumRecords: 4096,
  maximumInputEvents: 1_000_000,
  maximumEventBytes: 4096,
  maximumDiagnosticBytes: 2 * 1024 * 1024,
  maximumArchiveBytes: 4 * 1024 * 1024,
});
export const HARD_RECORDER_LIMITS = Object.freeze({
  maximumRecords: 16384,
  maximumInputEvents: 10_000_000,
  maximumEventBytes: 8192,
  maximumDiagnosticBytes: 8 * 1024 * 1024,
  maximumArchiveBytes: 16 * 1024 * 1024,
});
export type RecorderLimits = {
  [Property in keyof typeof DEFAULT_RECORDER_LIMITS]: number;
};

// Accept only null-prototype records or exact ordinary-object prototypes from
// this realm and Node's structuredClone realm. Custom prototypes are rejected.
const plainPrototypes = new Set([
  Object.prototype,
  Object.getPrototypeOf(structuredClone({})),
]);
const arrayPrototypes = new Set([
  Array.prototype,
  Object.getPrototypeOf(structuredClone([])),
]);

// Node's native isProxy check does not execute traps, including revoked proxies.
// This guarantee depends on Node intrinsics; do not substitute heuristic checks
// in runtimes without reliable proxy detection. Never inspect constructor.name.
export const copyPlainDataProperties = (
  input: unknown,
): Readonly<Record<string, unknown>> | undefined => {
  if (
    typeof input !== 'object' ||
    input === null ||
    types.isProxy(input) ||
    Array.isArray(input)
  )
    return undefined;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && !plainPrototypes.has(prototype)) return undefined;
  const keys = Reflect.ownKeys(input);
  if (keys.length > 32) return undefined;
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 64) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      return undefined;
    copy[key] = descriptor.value;
  }
  return Object.freeze(copy);
};

// Only dense, ordinary arrays with own enumerable data elements are accepted.
// The shallow copy fixes element references without evaluating getters or traps.
export const copyBoundedArrayItems = (
  input: unknown,
  maximumLength: number,
): readonly unknown[] => {
  if (
    typeof input !== 'object' ||
    input === null ||
    types.isProxy(input) ||
    !Array.isArray(input) ||
    !arrayPrototypes.has(Object.getPrototypeOf(input))
  )
    throw new Error('INVALID_ARCHIVE');
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength)
    throw new Error('ARCHIVE_CAPACITY_EXCEEDED');
  if (Reflect.ownKeys(input).length !== length + 1)
    throw new Error('INVALID_ARCHIVE');
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error('INVALID_ARCHIVE');
    copy.push(descriptor.value);
  }
  return Object.freeze(copy);
};

// Before Zod or serialization, cap traversal, depth, keys and strings. Each
// accepted record is recursively frozen and detached from all caller input.
export const copyBoundedEventInput = (input: unknown): unknown => {
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 96 || depth > 4) throw new Error('INVALID_EVENT');
    if (typeof value === 'string') {
      if (value.length > 128) throw new Error('INVALID_EVENT');
      return value;
    }
    if (value === null || value === undefined || typeof value === 'boolean')
      return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    const properties = copyPlainDataProperties(value);
    if (!properties) throw new Error('INVALID_EVENT');
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(properties))
      copy[key] = visit(properties[key], depth + 1);
    return Object.freeze(copy);
  };
  try {
    return visit(input, 0);
  } catch {
    return undefined;
  }
};
// Inventory/evidence boundaries need arrays and deeper nesting than single events.
// Reuse the same accessor/proxy rejection; never relax the event/archive budgets.
export const copyBoundedLifecycleInput = (input: unknown): unknown => {
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 32768 || depth > 16) throw new Error('INVALID_INVENTORY');
    if (typeof value === 'string') {
      if (value.length > 128) throw new Error('INVALID_INVENTORY');
      return value;
    }
    if (
      value === null ||
      value === undefined ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    )
      return value;
    // Detect proxies before Array.isArray, including revoked proxies.
    if (
      typeof value === 'object' &&
      !types.isProxy(value) &&
      Array.isArray(value)
    )
      return Object.freeze(
        copyBoundedArrayItems(value, 256).map((item) => visit(item, depth + 1)),
      );
    const properties = copyPlainDataProperties(value);
    if (!properties) throw new Error('INVALID_INVENTORY');
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(properties))
      copy[key] = visit(properties[key], depth + 1);
    return Object.freeze(copy);
  };
  try {
    return visit(input, 0);
  } catch {
    return undefined;
  }
};

export const boundedEventInput = (input: unknown): boolean =>
  copyBoundedEventInput(input) !== undefined;

export const evidenceSnapshotSchema = z
  .object({
    schema: z.literal('inconnect-lifecycle-evidence'),
    version: z.literal(2),
    runId: z.string().uuid(),
    generation: z.number().int().nonnegative().safe(),
    sealed: z.boolean(),
    terminal: z
      .object({
        state: z.enum(['SEALED', 'INVALID']),
        generation: z.number().int().nonnegative().safe(),
      })
      .strict()
      .optional(),
    complete: z.boolean(),
    failureCode: z
      .enum([
        'INVALID_EVENT',
        'RECORDING_ALREADY_SEALED',
        'CAPACITY_EXCEEDED',
        'ARCHIVE_CAPACITY_EXCEEDED',
        'REENTRANT_ACCESS',
        'OUTPUT_BUDGET_EXCEEDED',
        'RETENTION_FAILED',
      ])
      .optional(),
    inputEvents: z.number().int().nonnegative().safe(),
    diagnosticBytes: z.number().int().nonnegative().safe(),
    entries: z
      .array(
        z
          .object({
            firstSequence: z.number().int().positive().safe(),
            lastSequence: z.number().int().positive().safe(),
            count: z.number().int().positive().safe(),
            event: probeEventSchema,
          })
          .strict(),
      )
      .max(HARD_RECORDER_LIMITS.maximumRecords),
  })
  .strict();
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;
type FailureCode = NonNullable<EvidenceSnapshot['failureCode']>;

// A structural copy or wrapper must not replace the authoritative current()
// function while retaining real record/seal closures from another recorder.
const recorderInstances = new WeakSet<object>();
export const isProbeRecorder = (input: unknown): input is ProbeRecorder =>
  typeof input === 'object' && input !== null && recorderInstances.has(input);

export const createProbeRecorder = (
  runId: string,
  options: Partial<RecorderLimits> = {},
) => {
  const boundedOptions = copyBoundedEventInput(options);
  if (
    !boundedOptions ||
    typeof boundedOptions !== 'object' ||
    Object.keys(boundedOptions).some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(DEFAULT_RECORDER_LIMITS, key),
    )
  )
    throw new Error('INVALID_RECORDER_LIMIT');
  const limits: RecorderLimits = {
    ...DEFAULT_RECORDER_LIMITS,
    ...boundedOptions,
  };
  for (const key of Object.keys(
    DEFAULT_RECORDER_LIMITS,
  ) as (keyof RecorderLimits)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] <= 0 ||
      limits[key] > HARD_RECORDER_LIMITS[key]
    )
      throw new Error('INVALID_RECORDER_LIMIT');
  }
  Object.freeze(limits);
  const snapshot: EvidenceSnapshot = {
    schema: 'inconnect-lifecycle-evidence',
    version: 2,
    runId: z.string().max(36).uuid().parse(runId),
    generation: 0,
    sealed: false,
    complete: true,
    inputEvents: 0,
    diagnosticBytes: 0,
    entries: [],
  };
  let lifecycle: 'OPEN' | 'SEALED' | 'RETAINING' | 'RETAINED' | 'INVALID' =
    'OPEN';
  let busy = false;
  let lastEventContent = '';
  const invalidate = (code: FailureCode) => {
    if (lifecycle === 'INVALID') return;
    // A single out-of-band failure is reserved even when the ledger is full.
    // No attacker payload or unbounded sequence of cleanup diagnostics is copied.
    snapshot.complete = false;
    snapshot.failureCode = code;
    snapshot.generation += 1;
    if (snapshot.sealed)
      snapshot.terminal = { state: 'INVALID', generation: snapshot.generation };
    lifecycle = 'INVALID';
  };
  const current = () => ({
    runId: snapshot.runId,
    generation: snapshot.generation,
    lifecycle,
    complete: snapshot.complete,
  });
  const recorder = {
    limits,
    current,
    invalidate,
    record: (input: unknown): boolean => {
      if (lifecycle !== 'OPEN') {
        invalidate('RECORDING_ALREADY_SEALED');
        return false;
      }
      if (busy) {
        invalidate('REENTRANT_ACCESS');
        return false;
      }
      busy = true;
      try {
        const boundedInput = copyBoundedEventInput(input);
        if (boundedInput === undefined) {
          invalidate('INVALID_EVENT');
          return false;
        }
        const parsed = probeEventSchema.safeParse(boundedInput);
        if (!parsed.success) {
          invalidate('INVALID_EVENT');
          return false;
        }
        if (lifecycle !== 'OPEN') return false;
        // These schemas only validate; retain the exact immutable canonical input.
        const event = boundedInput as ProbeEvent;
        if (
          event.kind === 'successful-poll' &&
          event.runId !== snapshot.runId
        ) {
          invalidate('INVALID_EVENT');
          return false;
        }
        const content = JSON.stringify(event);
        const bytes = Buffer.byteLength(content);
        const last = snapshot.entries[snapshot.entries.length - 1];
        // Keep exact chronology. Alternating actors intentionally hit the finite
        // record cap; no lossy cross-actor compression or extra state machine.
        const aggregate =
          event.kind === 'successful-poll' &&
          last?.event.kind === 'successful-poll' &&
          lastEventContent === content;
        if (
          bytes > limits.maximumEventBytes ||
          snapshot.inputEvents >= limits.maximumInputEvents ||
          (!aggregate &&
            (snapshot.entries.length >= limits.maximumRecords ||
              bytes > limits.maximumDiagnosticBytes - snapshot.diagnosticBytes))
        ) {
          invalidate('CAPACITY_EXCEEDED');
          return false;
        }
        snapshot.inputEvents += 1;
        snapshot.generation += 1;
        if (aggregate && last) {
          last.count += 1;
          last.lastSequence = snapshot.inputEvents;
        } else {
          snapshot.diagnosticBytes += bytes;
          snapshot.entries.push({
            firstSequence: snapshot.inputEvents,
            lastSequence: snapshot.inputEvents,
            count: 1,
            event,
          });
          lastEventContent = content;
        }
        if (event.kind === 'output-overflow')
          invalidate('OUTPUT_BUDGET_EXCEEDED');
        if (event.kind === 'retention-failure') invalidate('RETENTION_FAILED');
        return snapshot.complete;
      } catch {
        invalidate('INVALID_EVENT');
        return false;
      } finally {
        busy = false;
      }
    },
    snapshot: (): EvidenceSnapshot => structuredClone(snapshot),
    seal: (): EvidenceSnapshot => {
      if (busy) invalidate('REENTRANT_ACCESS');
      if (lifecycle === 'OPEN') lifecycle = 'SEALED';
      snapshot.sealed = true;
      snapshot.terminal = {
        state: snapshot.complete ? 'SEALED' : 'INVALID',
        generation: snapshot.generation,
      };
      return structuredClone(snapshot);
    },
    beginRetention: (expectedRunId: string, generation: number): boolean => {
      if (
        lifecycle !== 'SEALED' ||
        !snapshot.complete ||
        snapshot.runId !== expectedRunId ||
        snapshot.generation !== generation
      )
        return false;
      lifecycle = 'RETAINING';
      return true;
    },
    finishRetention: (generation: number, success: boolean): boolean => {
      if (lifecycle !== 'RETAINING' || snapshot.generation !== generation)
        return false;
      if (!success) {
        invalidate('RETENTION_FAILED');
        return false;
      }
      lifecycle = 'RETAINED';
      return true;
    },
  };
  recorderInstances.add(recorder);
  return Object.freeze(recorder);
};
export type ProbeRecorder = ReturnType<typeof createProbeRecorder>;
