import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  boundedEventInput,
  copyBoundedEventInput,
  copyPlainDataProperties,
  copyBoundedArrayItems,
  HARD_RECORDER_LIMITS,
  isProbeRecorder,
  type EvidenceSnapshot,
  evidenceSnapshotSchema,
  type ProbeRecorder,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';

export const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

// One bounded record at a time, one final join. No whole-archive Zod clone or
// parse round trip during preparation. Reject oversized arrays before walking.
export const serializeEvidence = (
  snapshot: EvidenceSnapshot,
  maximumBytes = HARD_RECORDER_LIMITS.maximumArchiveBytes,
) => {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    maximumBytes > HARD_RECORDER_LIMITS.maximumArchiveBytes
  )
    throw new Error('ARCHIVE_CAPACITY_EXCEEDED');
  const properties = copyPlainDataProperties(snapshot);
  if (!properties) throw new Error('INVALID_ARCHIVE');
  const { entries: inputEntries, ...inputHeader } = properties;
  const entries = copyBoundedArrayItems(
    inputEntries,
    HARD_RECORDER_LIMITS.maximumRecords,
  );
  const header = copyBoundedEventInput(inputHeader);
  evidenceSnapshotSchema.omit({ entries: true }).parse(header);
  const contentHeader = JSON.stringify(header);
  const parts = [contentHeader.slice(0, -1) + ',"entries":['];
  let bytes = Buffer.byteLength(parts[0]) + 2;
  for (const entry of entries) {
    const canonical = copyBoundedEventInput(entry);
    if (canonical === undefined) throw new Error('INVALID_ARCHIVE');
    evidenceSnapshotSchema.shape.entries.element.parse(canonical);
    const content = JSON.stringify(canonical);
    const addedBytes = Buffer.byteLength(content) + (parts.length > 1 ? 1 : 0);
    if (addedBytes > maximumBytes - bytes)
      throw new Error('ARCHIVE_CAPACITY_EXCEEDED');
    bytes += addedBytes;
    parts.push((parts.length > 1 ? ',' : '') + content);
  }
  if (bytes > maximumBytes) throw new Error('ARCHIVE_CAPACITY_EXCEEDED');
  parts.push(']}');
  const content = parts.join('');
  return Object.freeze({ content, sha256: sha256(content), byteLength: bytes });
};

// Historical byte integrity only. Detached bytes NEVER establish current
// recorder completeness or acceptance; use evidenceAcceptance with authority.
export const inspectEvidence = (content: string, expectedSha256: string) => {
  try {
    // Check UTF-16 length before scanning UTF-8 or parsing untrusted content.
    if (
      typeof content !== 'string' ||
      content.length > HARD_RECORDER_LIMITS.maximumArchiveBytes ||
      Buffer.byteLength(content) > HARD_RECORDER_LIMITS.maximumArchiveBytes
    )
      return {
        state: 'PARTIAL',
        diagnostic: 'ARCHIVE_CAPACITY_EXCEEDED',
      } as const;
    if (
      !/^[a-f0-9]{64}$/.test(expectedSha256) ||
      sha256(content) !== expectedSha256
    )
      return { state: 'PARTIAL', diagnostic: 'HASH_MISMATCH' } as const;
    const decoded: EvidenceSnapshot = JSON.parse(content);
    if (
      !Array.isArray(decoded.entries) ||
      decoded.entries.length > HARD_RECORDER_LIMITS.maximumRecords ||
      !decoded.entries.every(boundedEventInput)
    )
      return { state: 'PARTIAL', diagnostic: 'INVALID_ARCHIVE' } as const;
    const parsed = evidenceSnapshotSchema.safeParse(decoded);
    if (!parsed.success)
      return { state: 'PARTIAL', diagnostic: 'INVALID_ARCHIVE' } as const;
    const snapshot = parsed.data;
    let nextSequence = 1;
    let diagnosticBytes = 0;
    for (const entry of snapshot.entries) {
      if (
        entry.firstSequence !== nextSequence ||
        entry.count > Number.MAX_SAFE_INTEGER - entry.firstSequence ||
        entry.lastSequence !== entry.firstSequence + entry.count - 1 ||
        (entry.event.kind !== 'successful-poll' && entry.count !== 1) ||
        (entry.event.kind === 'successful-poll' &&
          entry.event.runId !== snapshot.runId)
      )
        return { state: 'PARTIAL', diagnostic: 'INVALID_CHRONOLOGY' } as const;
      const bytes = Buffer.byteLength(JSON.stringify(entry.event));
      if (
        bytes > HARD_RECORDER_LIMITS.maximumEventBytes ||
        bytes > HARD_RECORDER_LIMITS.maximumDiagnosticBytes - diagnosticBytes
      )
        return {
          state: 'PARTIAL',
          diagnostic: 'ARCHIVE_CAPACITY_EXCEEDED',
        } as const;
      diagnosticBytes += bytes;
      nextSequence = entry.lastSequence + 1;
    }
    if (
      !snapshot.sealed ||
      !snapshot.complete ||
      snapshot.failureCode ||
      snapshot.terminal?.state !== 'SEALED' ||
      snapshot.terminal.generation !== snapshot.generation ||
      snapshot.generation !== snapshot.inputEvents ||
      snapshot.inputEvents === 0 ||
      snapshot.inputEvents > HARD_RECORDER_LIMITS.maximumInputEvents ||
      nextSequence !== snapshot.inputEvents + 1 ||
      diagnosticBytes !== snapshot.diagnosticBytes ||
      snapshot.entries.some(
        ({ event }) =>
          event.kind === 'retention-failure' ||
          event.kind === 'output-overflow',
      )
    )
      return { state: 'PARTIAL', diagnostic: 'INCOMPLETE_ARCHIVE' } as const;
    return { state: 'VERIFIED', snapshot } as const;
  } catch {
    return { state: 'PARTIAL', diagnostic: 'INVALID_ARCHIVE' } as const;
  }
};

type PreparedEvidence = {
  readonly state: 'PREPARED' | 'PARTIAL';
  readonly runId: string;
  readonly generation: number;
  readonly summaryText: string;
  readonly outputOverflow: boolean;
  readonly artifact: ReturnType<typeof serializeEvidence>;
};
const preparations = new WeakMap<ProbeRecorder, PreparedEvidence>();
const preparedAuthority = new WeakMap<PreparedEvidence, ProbeRecorder>();
const validGeneration = (
  recorder: ProbeRecorder,
  prepared: PreparedEvidence,
) => {
  const current = recorder.current();
  return (
    preparedAuthority.get(prepared) === recorder &&
    current.complete &&
    current.runId === prepared.runId &&
    current.generation === prepared.generation &&
    ['SEALED', 'RETAINING', 'RETAINED'].includes(current.lifecycle)
  );
};

// First preparation fixes the summary budget and bytes. Repeated calls return
// the same immutable artifact, including after invalidation; never reseal a run.
export const prepareEvidence = (
  recorder: ProbeRecorder,
  maximumBytes = 1024,
): PreparedEvidence => {
  if (!isProbeRecorder(recorder)) throw new Error('INVALID_RECORDER');
  const existing = preparations.get(recorder);
  if (existing) return existing;
  const budget =
    Number.isSafeInteger(maximumBytes) && maximumBytes >= 0
      ? Math.min(maximumBytes, 4096)
      : 0;
  let snapshot = recorder.seal();
  const summary = (digest: string) =>
    JSON.stringify({
      state: snapshot.complete ? 'RECORDED' : 'PARTIAL',
      runId: snapshot.runId,
      inputEvents: snapshot.inputEvents,
      retainedRecords: snapshot.entries.length,
      aggregatedPolls: snapshot.inputEvents - snapshot.entries.length,
      sha256: digest,
    });
  const outputOverflow = Buffer.byteLength(summary('0'.repeat(64))) > budget;
  if (outputOverflow) {
    recorder.invalidate('OUTPUT_BUDGET_EXCEEDED');
    snapshot = {
      ...snapshot,
      complete: false,
      failureCode: 'OUTPUT_BUDGET_EXCEEDED',
      generation: recorder.current().generation,
      terminal: { state: 'INVALID', generation: recorder.current().generation },
    };
  }
  let artifact: ReturnType<typeof serializeEvidence>;
  try {
    artifact = serializeEvidence(snapshot, recorder.limits.maximumArchiveBytes);
  } catch {
    recorder.invalidate('ARCHIVE_CAPACITY_EXCEEDED');
    // Reserved compact failure artifact, even if the requested archive budget is
    // too small for its header. No full-ledger retry or serialization occurs.
    snapshot = {
      ...snapshot,
      complete: false,
      failureCode: snapshot.failureCode ?? 'ARCHIVE_CAPACITY_EXCEEDED',
      generation: recorder.current().generation,
      terminal: { state: 'INVALID', generation: recorder.current().generation },
      entries: [],
    };
    artifact = serializeEvidence(snapshot, 1024);
  }
  const fallback = '{"state":"PARTIAL","outputOverflow":true}';
  const summaryText = outputOverflow
    ? Buffer.byteLength(fallback) <= budget
      ? fallback
      : ''
    : summary(artifact.sha256);
  const eligible =
    !outputOverflow && snapshot.complete && snapshot.inputEvents > 0;
  const prepared: PreparedEvidence = Object.freeze({
    get state() {
      return validGeneration(recorder, prepared) && eligible
        ? 'PREPARED'
        : 'PARTIAL';
    },
    runId: snapshot.runId,
    generation: snapshot.generation,
    summaryText,
    outputOverflow,
    artifact,
  });
  preparedAuthority.set(prepared, recorder);
  preparations.set(recorder, prepared);
  return prepared;
};

const targetSchema = z
  .object({
    runId: z.string().uuid(),
    path: z.string().max(128),
    // Supplied by an independently reviewed future opened-directory adapter,
    // never by an untrusted manifest. This module does not acquire OS authority.
    openedRoot: z
      .object({
        realPath: z.string().max(128),
        runId: z.string().uuid(),
        device: z
          .string()
          .max(64)
          .regex(/^[1-9][0-9]*$/),
        inode: z
          .string()
          .max(64)
          .regex(/^[1-9][0-9]*$/),
        ownerUid: z.number().int().nonnegative().safe(),
        mode: z.literal(0o700),
        symlinkFree: z.literal(true),
        exclusiveTestOwned: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type EvidenceTarget = z.infer<typeof targetSchema>;

export const validateEvidenceTarget = (
  input: unknown,
  expectedRunId: string,
  expectedOwnerUid: number,
) => {
  if (
    typeof expectedRunId !== 'string' ||
    expectedRunId.length !== 36 ||
    !Number.isSafeInteger(expectedOwnerUid) ||
    expectedOwnerUid < 0
  )
    return undefined;
  const parsed = targetSchema.safeParse(copyBoundedEventInput(input));

  if (!parsed.success) return undefined;
  const target = parsed.data;
  const root = `/tmp/inconnect-lifecycle-${expectedRunId}`;

  if (
    target.runId !== expectedRunId ||
    target.openedRoot.runId !== expectedRunId ||
    target.openedRoot.realPath !== root ||
    target.path !== `${root}/evidence.json` ||
    target.openedRoot.ownerUid !== expectedOwnerUid
  )
    return undefined;

  return target;
};

export type EvidenceStore = {
  // Future adapter must use the held directory, exclusive create, no symlinks,
  // regular single-link file, owner/mode verification, flush and same-inode readback.
  // It must never overwrite an existing artifact, including the C4 archive.
  writeExclusive: (target: EvidenceTarget, content: string) => Promise<void>;
  readBack: (target: EvidenceTarget) => Promise<string>;
};

type RetentionReceipt = {
  readonly state: 'RETAINED' | 'PARTIAL';
  readonly path?: string;
  readonly sha256?: string;
  readonly diagnostic?: string;
};
type RetentionAuthority = {
  recorder: ProbeRecorder;
  prepared: PreparedEvidence;
};
const retentionAuthority = new WeakMap<RetentionReceipt, RetentionAuthority>();
const receipts = new WeakMap<PreparedEvidence, RetentionReceipt>();

export const evidenceAcceptance = (
  recorder: ProbeRecorder,
  receipt: RetentionReceipt | undefined,
): 'PASS' | 'PARTIAL' => {
  if (!isProbeRecorder(recorder) || !receipt) return 'PARTIAL';
  const authority = retentionAuthority.get(receipt);
  return authority?.recorder === recorder &&
    validGeneration(recorder, authority.prepared) &&
    recorder.current().lifecycle === 'RETAINED'
    ? 'PASS'
    : 'PARTIAL';
};
export type EvidenceRetention = RetentionReceipt;

export const retainEvidence = async (
  recorder: ProbeRecorder,
  prepared: PreparedEvidence,
  input: unknown,
  expectedRunId: string,
  expectedOwnerUid: number,
  store: EvidenceStore,
): Promise<RetentionReceipt> => {
  if (!isProbeRecorder(recorder))
    return Object.freeze({ state: 'PARTIAL', diagnostic: 'INVALID_RECORDER' });
  const target = validateEvidenceTarget(input, expectedRunId, expectedOwnerUid);
  if (!target)
    return Object.freeze({
      state: 'PARTIAL',
      diagnostic: 'UNSAFE_OR_UNOWNED_TARGET',
    });
  if (
    !validGeneration(recorder, prepared) ||
    expectedRunId !== prepared.runId ||
    prepared.state !== 'PREPARED'
  )
    return Object.freeze({
      state: 'PARTIAL',
      diagnostic: 'INVALID_RETENTION_INPUT',
    });
  const existing = receipts.get(prepared);
  if (existing) return existing;
  // Synchronous acquisition precedes any untrusted callback/await. A concurrent
  // or reentrant retention cannot initiate another write. Failure is terminal;
  // repeated success returns its receipt without touching storage again.
  if (!recorder.beginRetention(expectedRunId, prepared.generation))
    return Object.freeze({
      state: 'PARTIAL',
      diagnostic: 'RETENTION_NOT_SEALED',
    });
  try {
    await store.writeExclusive(target, prepared.artifact.content);
    if (!validGeneration(recorder, prepared)) throw new Error('INVALIDATED');
    const content = await store.readBack(target);
    if (
      !validGeneration(recorder, prepared) ||
      typeof content !== 'string' ||
      content.length !== prepared.artifact.content.length ||
      content !== prepared.artifact.content ||
      !recorder.finishRetention(prepared.generation, true)
    )
      throw new Error('INVALIDATED_OR_CORRUPTED');
    const receipt: RetentionReceipt = Object.freeze({
      get state() {
        return evidenceAcceptance(recorder, receipt) === 'PASS'
          ? 'RETAINED'
          : 'PARTIAL';
      },
      get diagnostic() {
        return evidenceAcceptance(recorder, receipt) === 'PASS'
          ? undefined
          : 'INVALIDATED_RETENTION';
      },
      path: target.path,
      sha256: prepared.artifact.sha256,
    });
    retentionAuthority.set(receipt, { recorder, prepared });
    receipts.set(prepared, receipt);
    return receipt;
  } catch {
    recorder.finishRetention(prepared.generation, false);
    return Object.freeze({ state: 'PARTIAL', diagnostic: 'RETENTION_FAILED' });
  }
};
