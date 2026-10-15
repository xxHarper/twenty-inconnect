import { z } from 'zod';

import {
  evidenceAcceptance,
  type EvidenceRetention,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/evidence';
import {
  copyPlainDataProperties,
  copyBoundedLifecycleInput,
  copyBoundedArrayItems,
  isProbeRecorder,
  type ProbeRecorder,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';

import {
  actorRoleSchema,
  kernelIdentifier,
  type Namespaces,
  type KernelProcessIdentity,
  namespacesSchema,
  type OwnedLifecycle,
  ownedLifecycleSchema,
  type ReadinessInput,
  type ReadinessResult,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';
import {
  inspectOwnedLifecycle,
  inspectPartialAcquisition,
  sameIdentity,
  sameNamespaces,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/ownership';
import {
  evaluateReadiness,
  parseLifecycleInventory,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/readiness';

const EVIDENCE_SCHEMAS = {
  processExits: z.array(ownedLifecycleSchema),
  namespaceHolders: z
    .object({
      namespaces: namespacesSchema.optional(),
      scannedNamespaces: z
        .array(
          z
            .object({
              kind: z.enum(['user', 'network', 'mount', 'pid']),
              identity: kernelIdentifier,
            })
            .strict(),
        )
        .optional(),
      holders: z.array(z.number().int().positive().safe()),
      scanComplete: z.boolean(),
    })
    .strict(),
  output: z
    .object({
      eof: z.boolean(),
      bufferedBytes: z.number().int().nonnegative().safe(),
    })
    .strict(),
  parentInvariants: z.boolean(),
};

export type FailureCode =
  | 'OBSERVATION_FAILED'
  | 'READINESS_UNKNOWN'
  | 'STAGE_NOT_REACHED'
  | 'IDENTITY_MISMATCH';

export type DescriptorEvidence = {
  // Run-local inventory ordinal; descriptor number reuse cannot close this obligation.
  ordinal: number;
  closed: boolean;
};

export type FinalizationEvidence = {
  partialAcquisitions?: {
    identity: KernelProcessIdentity;
    status: ReturnType<typeof inspectPartialAcquisition>;
  }[];
  processExits?: OwnedLifecycle[];
  namespaceHolders?: {
    namespaces?: Namespaces;
    scannedNamespaces?: { kind: keyof Namespaces; identity: string }[];
    holders: number[];
    scanComplete: boolean;
  };
  descriptorClosures?: DescriptorEvidence[];
  output?: { eof: boolean; bufferedBytes: number };
  parentInvariants?: boolean;
};

export type FinalizationActions = {
  processExits: () => Promise<OwnedLifecycle[]>;
  namespaceHolders: () => Promise<
    NonNullable<FinalizationEvidence['namespaceHolders']>
  >;
  descriptorClosures: (ordinal: number) => Promise<boolean>;
  output: () => Promise<NonNullable<FinalizationEvidence['output']>>;
  parentInvariants: () => Promise<boolean>;
};

export type FinalizationResult = {
  state: 'COMPLETE' | 'FINALIZATION_INCOMPLETE';
  acceptance: 'PASS' | 'PARTIAL';
  originalFailure?: FailureCode;
  cleanupFailures: {
    action: keyof FinalizationActions | 'report';
    code: 'CALLBACK_FAILED';
    descriptorOrdinal?: number;
  }[];
  evidence: FinalizationEvidence;
  diagnostics: string[];
  validationErrors: { boundary: string; path: string; code: string }[];
  historicalReport?: HistoricalReport;
  currentStatus?: 'ACCEPTED' | 'INCOMPLETE' | 'REVOKED';
  revocation?: {
    reason: 'RECORDER_INVALIDATED';
    reportedGeneration: number;
    currentGeneration: number;
  };
  reporting: {
    evidenceRetained: boolean;
    summaryDelivered: boolean;
    retention?: EvidenceRetention;
  };
};

// Historical candidate: all available gates have run, but report delivery and
// retention are still obligations. Persisted bytes never change retroactively.
// Current acceptance additionally requires the original receipt and recorder;
// later invalidation is an explicit revocation, not a rewritten historical report.
export type HistoricalReport = Pick<
  FinalizationResult,
  | 'state'
  | 'acceptance'
  | 'originalFailure'
  | 'cleanupFailures'
  | 'evidence'
  | 'diagnostics'
  | 'validationErrors'
> & {
  status: 'CANDIDATE_PENDING_REPORT';
  runId?: string;
  recorderGeneration?: number;
};

export type FinalizationInput = {
  recorder: ProbeRecorder;
  inventory: ReadinessInput;
  readiness: ReadinessResult;
  requiredDescriptorOrdinals: number[];
  originalFailure?: FailureCode;
  intentionalSignalObserved: boolean;
  observationWindowComplete: boolean;
  telemetryComplete: boolean;
};

// Only internally constructed, validated data enters this snapshot helper.
// Output must preserve all validation errors even when larger than input budgets.
const freezeFinalizationData = <TData>(data: TData): TData => {
  const detached = structuredClone(data);
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(detached);
  return detached;
};

// One receipt can discharge only its original invocation's report obligation.
const claimedReportReceipts = new WeakSet<object>();
const finalizedRecorders = new WeakSet<ProbeRecorder>();

// Every callback needs an adapter-enforced finite deadline, including reporting
// and each descriptor close. Promise coordination alone cannot bound a hung adapter.
// Callbacks must be independently safe and bounded by the future driver. This
// coordinator performs no signals, waits, descriptor operations or OS inspection.
export const finalizeProbe = async (
  input: FinalizationInput,
  actions: Partial<FinalizationActions>,
  report: (
    result: HistoricalReport,
    recorder: ProbeRecorder,
  ) => Promise<FinalizationResult['reporting']>,
): Promise<FinalizationResult> => {
  // Capture all inputs and callback references before yielding. Accessors and
  // proxies are rejected without executing caller code at every data boundary.
  const properties = copyPlainDataProperties(input);
  const recorder = properties?.recorder as ProbeRecorder;
  const ownsRecorder =
    isProbeRecorder(recorder) && !finalizedRecorders.has(recorder);
  if (ownsRecorder) finalizedRecorders.add(recorder);
  const callbacks = copyPlainDataProperties(actions) ?? {};
  const inventoryResult = parseLifecycleInventory(properties?.inventory);
  const inventory = inventoryResult.success
    ? (inventoryResult.data as ReadinessInput)
    : undefined;
  const readiness = z
    .object({
      state: z.enum(['READY', 'UNKNOWN', 'NOT_READY']),
      diagnostics: z.array(z.string().max(128)).max(256),
    })
    .strict()
    .safeParse(copyBoundedLifecycleInput(properties?.readiness));
  const originalFailure = z
    .enum([
      'OBSERVATION_FAILED',
      'READINESS_UNKNOWN',
      'STAGE_NOT_REACHED',
      'IDENTITY_MISMATCH',
    ])
    .optional()
    .safeParse(properties?.originalFailure);
  const result: FinalizationResult = {
    state: 'FINALIZATION_INCOMPLETE',
    acceptance: 'PARTIAL',
    originalFailure: originalFailure.success ? originalFailure.data : undefined,
    cleanupFailures: [],
    evidence: {},
    diagnostics: [],
    validationErrors: [],
    reporting: { evidenceRetained: false, summaryDelivered: false },
  };
  if (!properties || !originalFailure.success)
    result.diagnostics.push('INVALID:finalizationInput');
  if (!inventoryResult.success) {
    result.diagnostics.push('INVALID:inventory');
    result.validationErrors.push(
      ...inventoryResult.error.issues.map((issue) => ({
        boundary: 'inventory',
        path: issue.path.join('.'),
        code: issue.code,
      })),
    );
  }
  let descriptorItems: readonly unknown[] = [];
  try {
    descriptorItems = copyBoundedArrayItems(
      properties?.requiredDescriptorOrdinals,
      256,
    );
  } catch {
    result.diagnostics.push('INVALID:requiredDescriptorOrdinals');
  }
  // A malformed sibling never prevents an independently valid close obligation.
  const required = descriptorItems.filter(
    (item): item is number =>
      typeof item === 'number' && Number.isSafeInteger(item) && item > 0,
  );
  if (required.length !== descriptorItems.length)
    result.diagnostics.push('INVALID:requiredDescriptorOrdinals');

  const attempt = async (
    key: Exclude<keyof FinalizationActions, 'descriptorClosures'>,
  ) => {
    const action = callbacks[key];

    if (typeof action !== 'function') {
      result.diagnostics.push(`MISSING:${key}`);
      return;
    }
    try {
      // Each obligation is stored separately, so one failure cannot replace another.
      const parsed = EVIDENCE_SCHEMAS[key].safeParse(
        copyBoundedLifecycleInput(await action()),
      );

      if (parsed.success)
        Object.assign(result.evidence, { [key]: parsed.data });
      else {
        result.diagnostics.push(`MISSING_OR_INVALID:${key}`);
        result.validationErrors.push(
          ...parsed.error.issues.map((issue) => ({
            boundary: key,
            path: issue.path.join('.'),
            code: issue.code,
          })),
        );
      }
    } catch {
      // Raw exceptions can carry credentials; retain action and safe code only.
      result.cleanupFailures.push({ action: key, code: 'CALLBACK_FAILED' });
      result.diagnostics.push(`UNVERIFIED:${key}`);
    }
  };

  await attempt('processExits');
  await attempt('namespaceHolders');
  result.evidence.descriptorClosures = [];
  // A failed close must not skip the next independent descriptor obligation.
  for (const ordinal of new Set(required)) {
    if (!Number.isSafeInteger(ordinal) || ordinal <= 0) continue;
    let closed = false;

    try {
      closed =
        typeof callbacks.descriptorClosures === 'function' &&
        (await callbacks.descriptorClosures(ordinal)) === true;
    } catch {
      result.cleanupFailures.push({
        action: 'descriptorClosures',
        code: 'CALLBACK_FAILED',
        descriptorOrdinal: ordinal,
      });
    }
    result.evidence.descriptorClosures.push({ ordinal, closed });
  }
  await attempt('output');
  await attempt('parentInvariants');

  const namespaceHolders = result.evidence.namespaceHolders;
  if (!namespacesSchema.safeParse(namespaceHolders?.namespaces).success)
    result.diagnostics.push('MISSING:namespaceHolders.namespaces');
  if (!namespaceHolders?.scanComplete || namespaceHolders.holders.length !== 0)
    result.diagnostics.push('UNVERIFIED:namespaceHolders');

  if (inventory) {
    result.evidence.partialAcquisitions = inventory.otherProcesses.flatMap(
      (record) =>
        record.kind === 'partially-acquired-process'
          ? [
              {
                identity: record.identity,
                status: inspectPartialAcquisition(record),
              },
            ]
          : [],
    );
    const owned = [...inventory.actors, ...inventory.helpers];
    const exits = result.evidence.processExits ?? [];

    for (const role of actorRoleSchema.options) {
      if (inventory.actors.filter((actor) => actor.role === role).length !== 1)
        result.diagnostics.push(`MISSING:inventory.${role}`);
    }
    if (
      inventory.otherProcesses.some(
        (record) =>
          record.kind === 'unresolved-owned-process' ||
          record.kind === 'partially-acquired-process',
      )
    )
      result.diagnostics.push('UNKNOWN:ownedProcess');

    if (owned.length !== exits.length)
      result.diagnostics.push('UNVERIFIED:processInventory');

    for (const [index, record] of owned.entries()) {
      const matching = exits.filter(
        (exit) =>
          sameIdentity(record.creation?.identity, exit.creation?.identity) &&
          ((record.creation?.parent === null &&
            exit.creation?.parent === null) ||
            sameIdentity(record.creation?.parent, exit.creation?.parent)),
      );

      if (
        matching.length !== 1 ||
        inspectOwnedLifecycle(matching[0]) !== 'VERIFIED_REAPED'
      )
        result.diagnostics.push(`UNVERIFIED:processExit.${index}`);
    }

    const workloadNamespaces = inventory.actors.find(
      (actor) => actor.role === 'fenced-workload',
    )?.expectedNamespaces;

    if (!sameNamespaces(namespaceHolders?.namespaces, workloadNamespaces))
      result.diagnostics.push('UNVERIFIED:namespaceSnapshot');
    if (
      !namespaceHolders?.scanComplete ||
      namespaceHolders.holders.length !== 0
    )
      result.diagnostics.push('UNVERIFIED:namespaceHolders');

    // Cover every private namespace introduced by any stable actor, including
    // intermediate supervisors. A workload-only scan cannot establish cleanup.
    const guardianNamespaces = inventory.actors.find(
      (actor) => actor.role === 'guardian',
    )?.creationNamespaces;
    const requiredNamespaces = new Set<string>();

    for (const actor of inventory.actors) {
      const observations = [
        actor.creationNamespaces,
        actor.expectedNamespaces,
        ...(actor.execTransitions ?? []).flatMap((transition) => [
          transition.beforeNamespaces,
          transition.afterNamespaces,
        ]),
      ];
      for (const observed of observations) {
        for (const kind of ['user', 'network', 'mount', 'pid'] as const) {
          const identity = observed?.[kind];
          if (identity && identity !== guardianNamespaces?.[kind])
            requiredNamespaces.add(`${kind}:${identity}`);
        }
      }
    }
    const scannedNamespaces = new Set(
      namespaceHolders?.scannedNamespaces?.map(
        ({ kind, identity }) => `${kind}:${identity}`,
      ),
    );

    if (
      !namespaceHolders?.scannedNamespaces ||
      namespaceHolders.scannedNamespaces.length !== scannedNamespaces.size ||
      scannedNamespaces.size !== requiredNamespaces.size ||
      [...requiredNamespaces].some(
        (identity) => !scannedNamespaces.has(identity),
      )
    )
      result.diagnostics.push('UNVERIFIED:namespaceScanCoverage');
  }
  const closures = result.evidence.descriptorClosures ?? [];

  if (
    required.length === 0 ||
    new Set(required).size !== required.length ||
    required.some(
      (ordinal) => !Number.isSafeInteger(ordinal) || ordinal <= 0,
    ) ||
    required.length !== closures.length ||
    required.some((ordinal) => {
      const matching = closures.filter(
        (closure) => closure.ordinal === ordinal,
      );

      return matching.length !== 1 || !matching[0].closed;
    })
  )
    result.diagnostics.push('UNVERIFIED:descriptorClosures');

  if (
    !result.evidence.output?.eof ||
    result.evidence.output.bufferedBytes !== 0
  )
    result.diagnostics.push('UNVERIFIED:outputEOF');
  if (result.evidence.parentInvariants !== true)
    result.diagnostics.push('UNVERIFIED:parentInvariants');

  if (result.diagnostics.length === 0 && result.cleanupFailures.length === 0)
    result.state = 'COMPLETE';

  // All available acceptance gates precede candidate submission. Reporting
  // success is necessarily conditional until the callback returns its receipt.
  const inventoryReadiness = inventory
    ? evaluateReadiness(inventory)
    : undefined;
  for (const diagnostic of inventoryReadiness?.diagnostics ?? [])
    result.diagnostics.push(`INVENTORY:${diagnostic}`);
  const gates = {
    originalFailure: !result.originalFailure && originalFailure.success,
    readiness:
      readiness.success &&
      readiness.data.state === 'READY' &&
      inventory !== undefined &&
      inventoryReadiness?.state === 'READY',
    signal: properties?.intentionalSignalObserved === true,
    window: properties?.observationWindowComplete === true,
    telemetry: properties?.telemetryComplete === true,
    recorder:
      ownsRecorder &&
      recorder.current().complete &&
      recorder.current().runId === inventory?.runId,
  };
  for (const [gate, passed] of Object.entries(gates))
    if (!passed) result.diagnostics.push(`UNVERIFIED:gate.${gate}`);
  if (result.state === 'COMPLETE' && Object.values(gates).every(Boolean))
    result.acceptance = 'PASS';
  else result.state = 'FINALIZATION_INCOMPLETE';
  const historicalReport: HistoricalReport = freezeFinalizationData({
    status: 'CANDIDATE_PENDING_REPORT',
    runId: inventory?.runId,
    recorderGeneration: isProbeRecorder(recorder)
      ? recorder.current().generation
      : undefined,
    state: result.state,
    acceptance: result.acceptance,
    originalFailure: result.originalFailure,
    cleanupFailures: result.cleanupFailures,
    evidence: result.evidence,
    diagnostics: result.diagnostics,
    validationErrors: result.validationErrors,
  });

  // Receipt object identity is deliberately not cloned or traversed: only the
  // evidence module's private WeakMap can establish its authority.
  let retention: EvidenceRetention | undefined;
  let acknowledged = false;
  let summaryDelivered = false;
  try {
    const reporting = copyPlainDataProperties(
      await report(historicalReport, recorder),
    );
    if (
      reporting &&
      Object.keys(reporting).every((key) =>
        ['evidenceRetained', 'summaryDelivered', 'retention'].includes(key),
      ) &&
      typeof reporting.evidenceRetained === 'boolean' &&
      typeof reporting.summaryDelivered === 'boolean'
    ) {
      retention =
        typeof reporting.retention === 'object' && reporting.retention !== null
          ? (reporting.retention as EvidenceRetention)
          : undefined;
      acknowledged = reporting.evidenceRetained;
      summaryDelivered = reporting.summaryDelivered;
    } else result.diagnostics.push('MISSING_OR_INVALID:reporting');
  } catch {
    result.cleanupFailures.push({ action: 'report', code: 'CALLBACK_FAILED' });
  }
  const receiptBound =
    ownsRecorder &&
    retention !== undefined &&
    evidenceAcceptance(recorder, retention) === 'PASS' &&
    recorder.current().generation === historicalReport.recorderGeneration &&
    !claimedReportReceipts.has(retention);
  if (receiptBound && retention) claimedReportReceipts.add(retention);
  else if (retention) result.diagnostics.push('UNVERIFIED:reportReceipt');
  const reportAccepted = acknowledged && summaryDelivered && receiptBound;
  if (!reportAccepted) {
    result.state = 'FINALIZATION_INCOMPLETE';
    result.acceptance = 'PARTIAL';
    result.diagnostics.push('UNVERIFIED:reporting');
  }
  // These accessors read only immutable invocation data and the original trusted
  // recorder/receipt. No caller-owned input or replaceable reporting field is read.
  const revoked = () =>
    reportAccepted && evidenceAcceptance(recorder, retention) !== 'PASS';
  const reporting = Object.freeze({
    get evidenceRetained() {
      return (
        acknowledged &&
        receiptBound &&
        evidenceAcceptance(recorder, retention) === 'PASS'
      );
    },
    summaryDelivered,
    retention,
  });
  const diagnostics = Object.freeze([...result.diagnostics]);
  const revokedDiagnostics = Object.freeze([
    ...diagnostics,
    'REVOKED:recorder',
    'UNVERIFIED:reporting',
  ]);
  return Object.freeze({
    ...result,
    evidence: freezeFinalizationData(result.evidence),
    cleanupFailures: freezeFinalizationData(result.cleanupFailures),
    validationErrors: freezeFinalizationData(result.validationErrors),
    historicalReport,
    reporting,
    get state() {
      return revoked() ? 'FINALIZATION_INCOMPLETE' : result.state;
    },
    get acceptance() {
      return revoked() ? 'PARTIAL' : result.acceptance;
    },
    get currentStatus() {
      return revoked()
        ? 'REVOKED'
        : result.acceptance === 'PASS'
          ? 'ACCEPTED'
          : 'INCOMPLETE';
    },
    get revocation() {
      return revoked()
        ? Object.freeze({
            reason: 'RECORDER_INVALIDATED' as const,
            reportedGeneration: historicalReport.recorderGeneration ?? 0,
            currentGeneration: recorder.current().generation,
          })
        : undefined;
    },
    get diagnostics() {
      return (revoked() ? revokedDiagnostics : diagnostics) as string[];
    },
  });
};
