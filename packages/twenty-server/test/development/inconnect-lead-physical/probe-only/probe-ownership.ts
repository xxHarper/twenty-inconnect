import { z } from 'zod';

import {
  decode,
  digest,
  identifier,
  namespacesSchema,
  requireLeadPhysical,
  uuid,
} from 'test/development/inconnect-lead-physical/contracts';

const pinSchema = z.strictObject({
  runId: uuid,
  bootId: uuid,
  pid: z.number().int().min(2),
  startTicks: identifier,
  executable: z.literal('/usr/bin/bwrap'),
  executableSha256: digest,
  namespaces: namespacesSchema,
  pidfdLease: digest,
});

// Preview comparison only. A lease label is not a real kernel descriptor.
// Native control acquires its pidfd from its own unreaped Popen child instead.
export const planPinnedProbeTermination = (
  pinnedInput: unknown,
  actualInput: unknown,
) => {
  const pinned = decode(pinSchema, pinnedInput);
  const actual = decode(pinSchema, actualInput);
  requireLeadPhysical(
    Object.keys(pinned).every(
      (key) =>
        JSON.stringify(pinned[key as keyof typeof pinned]) ===
        JSON.stringify(actual[key as keyof typeof actual]),
    ),
    'Probe process identity lost; signals and cleanup forbidden',
  );
  return {
    transport: 'pidfd',
    lease: pinned.pidfdLease,
    signal: 'SIGTERM',
    physicalExecution: 'BLOCKED',
  } as const;
};
