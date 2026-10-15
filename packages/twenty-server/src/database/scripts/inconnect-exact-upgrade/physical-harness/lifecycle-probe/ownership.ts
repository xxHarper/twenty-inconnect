import { copyBoundedLifecycleInput } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/telemetry';
import {
  ownedLifecycleSchema,
  kernelProcessIdentitySchema,
  type KernelProcessIdentity,
  type PartialAcquisition,
  partialAcquisitionSchema,
  type Namespaces,
  namespacesSchema,
  type ProcessIdentity,
  executableIdentitySchema,
  type ExecutableIdentity,
  type ProcessState,
  processIdentitySchema,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/lifecycle-probe/lifecycle.types';

export const sameNamespaces = (
  left: Namespaces | undefined,
  right: Namespaces | undefined,
): boolean => {
  const parsedLeft = namespacesSchema.safeParse(
    copyBoundedLifecycleInput(left),
  );
  const parsedRight = namespacesSchema.safeParse(
    copyBoundedLifecycleInput(right),
  );

  return (
    parsedLeft.success &&
    parsedRight.success &&
    JSON.stringify(parsedLeft.data) === JSON.stringify(parsedRight.data)
  );
};

export const sameIdentity = (
  left: ProcessIdentity | KernelProcessIdentity | null | undefined,
  right: ProcessIdentity | KernelProcessIdentity | null | undefined,
): boolean => {
  const schema = processIdentitySchema.or(kernelProcessIdentitySchema);
  const parsedLeft = schema.safeParse(copyBoundedLifecycleInput(left));
  const parsedRight = schema.safeParse(copyBoundedLifecycleInput(right));
  if (!parsedLeft.success || !parsedRight.success) return false;
  return (
    parsedLeft.data.pid === parsedRight.data.pid &&
    parsedLeft.data.startTicks === parsedRight.data.startTicks &&
    parsedLeft.data.pidfdDevice === parsedRight.data.pidfdDevice &&
    parsedLeft.data.pidfdInode === parsedRight.data.pidfdInode
  );
};

export const sameExecutable = (
  observed: ProcessIdentity | undefined,
  approved: ExecutableIdentity | undefined,
): boolean => {
  const left = processIdentitySchema.safeParse(
    copyBoundedLifecycleInput(observed),
  );
  const right = executableIdentitySchema.safeParse(
    copyBoundedLifecycleInput(approved),
  );
  return (
    left.success &&
    right.success &&
    left.data.executableDevice === right.data.executableDevice &&
    left.data.executableInode === right.data.executableInode
  );
};

// This checks lifecycle accounting only. LIVE_VERIFIED still requires independent
// executable policy, namespaces and fresh run evidence before readiness.
export const inspectOwnedLifecycle = (input: unknown): ProcessState => {
  const canonical = copyBoundedLifecycleInput(input);
  if (!canonical || typeof canonical !== 'object') return 'UNKNOWN';
  const fields = canonical as Record<string, unknown>;
  const parsed = ownedLifecycleSchema.safeParse({
    creation: fields.creation,
    observation: fields.observation,
    exit: fields.exit,
  });
  if (!parsed.success) return 'UNKNOWN';
  const record = parsed.data;
  const creation = record.creation;

  if (
    creation?.source !== 'direct-parent-report' ||
    !processIdentitySchema.safeParse(creation.identity).success
  )
    return 'UNKNOWN';

  if (record.observation.state === 'live') {
    if (!sameIdentity(creation.identity, record.observation.identity))
      return 'IDENTITY_MISMATCH';
    // Contradictory live and exit observations cannot prove either lifecycle.
    if (record.exit?.pidfdExitObserved || record.exit?.reaping)
      return 'UNKNOWN';

    return 'LIVE_VERIFIED';
  }

  if (!record.exit) return 'UNKNOWN';
  if (!sameIdentity(creation.identity, record.exit.identity))
    return 'IDENTITY_MISMATCH';
  if (!record.exit.pidfdExitObserved) return 'UNKNOWN';

  const reaping = record.exit.reaping;

  if (
    reaping?.source === 'kernel-pidfd-hup' ||
    (reaping?.source === 'actual-parent-wait' &&
      sameIdentity(reaping.parent, creation.parent))
  )
    return 'VERIFIED_REAPED';

  return 'EXIT_OBSERVED';
};

export const inspectPartialAcquisition = (
  input: PartialAcquisition,
): 'UNRESOLVED' | 'EXIT_ACCOUNTED_ACQUISITION_UNRESOLVED' => {
  const parsed = partialAcquisitionSchema.safeParse(
    copyBoundedLifecycleInput(input),
  );
  if (!parsed.success) return 'UNRESOLVED';
  const record = parsed.data;
  return record.exit?.pidfdExitObserved &&
    record.exit.reaped &&
    sameIdentity(record.identity, record.exit.identity)
    ? 'EXIT_ACCOUNTED_ACQUISITION_UNRESOLVED'
    : 'UNRESOLVED';
};
