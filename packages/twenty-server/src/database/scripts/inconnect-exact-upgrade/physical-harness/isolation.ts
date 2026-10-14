import { z } from 'zod';

import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { validateTargetContract } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

const isolationObservationSchema = z.strictObject({
  harnessNamespaces: z.strictObject({
    network: z.string(),
    mount: z.string(),
    process: z.string(),
  }),
  postmasterNamespaces: z.strictObject({
    network: z.string(),
    mount: z.string(),
    process: z.string(),
  }),
  postmasterPid: z.number().int().positive(),
  postmasterStartTicks: z.string().regex(/^\d+$/),
  postmasterDataDirectory: z.string(),
  interfaces: z.array(z.string()),
  routes: z.array(z.string()),
  listeningTcpPorts: z.array(z.number().int()),
  visiblePostgresSockets: z.array(z.string()),
  databaseNames: z.array(z.string()),
});

// Pure comparison of evidence. PG0 neither collects this observation nor treats
// it as OS fencing. A PG1 supervisor must collect it in the sealed namespaces.
export const validateIsolationObservation = (
  input: unknown,
  observation: unknown,
): void => {
  const contract = validateTargetContract(input);
  const parsed = isolationObservationSchema.safeParse(observation);
  requireCondition(parsed.success, 'Complete isolation observation required');
  if (!parsed.success) throw new Error('Invalid isolation observation');
  const actual = parsed.data;
  const expected = contract.evidence;

  requireCondition(
    Object.keys(expected.isolatedNamespaces).every((key) => {
      const namespace = key as keyof typeof expected.isolatedNamespaces;
      return (
        actual.harnessNamespaces[namespace] ===
          expected.isolatedNamespaces[namespace] &&
        actual.postmasterNamespaces[namespace] ===
          expected.isolatedNamespaces[namespace]
      );
    }) &&
      actual.postmasterPid === expected.postmasterPid &&
      actual.postmasterStartTicks === expected.postmasterStartTicks &&
      actual.postmasterDataDirectory === contract.expected.dataDirectory &&
      actual.interfaces.length === 1 &&
      actual.interfaces[0] === 'lo' &&
      actual.routes.length === 0 &&
      actual.listeningTcpPorts.length === 1 &&
      actual.listeningTcpPorts[0] === contract.port &&
      actual.visiblePostgresSockets.length === 0 &&
      new Set(actual.databaseNames).size === 4 &&
      actual.databaseNames.length === 4 &&
      ['postgres', 'template0', 'template1', contract.database].every((name) =>
        actual.databaseNames.includes(name),
      ),
    'Isolation mismatch: default connectivity, shared sockets/databases or postmaster ownership not excluded',
  );
};

const cleanupObservationSchema = z.strictObject({
  resourceRootRealPath: z.string(),
  dataDirectoryRealPath: z.string(),
  ownershipRunId: z.string().uuid(),
  ownershipSystemIdentifier: z.string().regex(/^\d+$/),
  ownedBySupervisor: z.literal(true),
  hasSymlinksOrMounts: z.literal(false),
  postmasterStopped: z.literal(true),
  testProcessesStopped: z.literal(true),
  connectionsClosed: z.literal(true),
  remainingWriters: z.literal(0),
});

// Produces a candidate path only; never deletes, signals a process or runs SQL.
// Ownership must be freshly established externally before future disposal.
export const planOwnedCleanup = (
  input: unknown,
  observation: unknown,
): string => {
  const contract = validateTargetContract(input);
  const parsed = cleanupObservationSchema.safeParse(observation);
  requireCondition(
    parsed.success,
    'Cleanup ownership or writer shutdown is UNKNOWN; preserve resources',
  );
  if (!parsed.success) throw new Error('Invalid cleanup observation');
  const actual = parsed.data;
  requireCondition(
    actual.resourceRootRealPath === contract.evidence.resourceRoot &&
      actual.dataDirectoryRealPath === contract.expected.dataDirectory &&
      actual.ownershipRunId === contract.runId &&
      actual.ownershipSystemIdentifier === contract.expected.systemIdentifier,
    'Cleanup ownership differs; preserve resources',
  );
  return actual.resourceRootRealPath;
};

// There is deliberately no boolean/flag/env override. PG1 requires reviewed
// implementation of fresh kernel evidence, trusted provenance and fixture proof.
export const requirePhysicalExecutionSafety = (): void => {
  throw new Error(
    'PG0: physical execution BLOCKED; separate PG1 authorization, enforced OS isolation and reviewed fixture are required',
  );
};
