import { z } from 'zod';

import {
  decode,
  digest,
  requireLeadPhysical,
  uuid,
} from 'test/development/inconnect-lead-physical/contracts';
import { rejectInheritedEnvironment } from 'test/development/inconnect-lead-physical/environment';

const requestSchema = z.strictObject({
  capability: z.literal('PROBE_ONLY'),
  probe: z.enum(['BOUNDARY', 'LIFECYCLE_WAIT']),
  expectedTermination: z.enum([
    'NORMAL_EXIT',
    'TIMEOUT',
    'CANCELLED',
    'INTERRUPTED',
  ]),
  runId: uuid,
  bootId: uuid,
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  supervisorSha256: digest,
  resourceRoot: z.string(),
  deadlineSeconds: z.number().int().min(1).max(30),
  memoryMiB: z.number().int().min(128).max(512),
  processLimit: z.number().int().min(16).max(64),
});

export type ProbeRequest = z.infer<typeof requestSchema>;

export const planProbeOnly = (
  input: unknown,
  inherited: Record<string, string | undefined>,
) => {
  rejectInheritedEnvironment(inherited);
  const request = decode(requestSchema, input);
  requireLeadPhysical(
    request.resourceRoot === `/tmp/inconnect-lead-phys-${request.runId}` &&
      (request.probe !== 'BOUNDARY' ||
        request.expectedTermination === 'NORMAL_EXIT'),
    'Exclusive PROBE_ONLY resource root required',
  );
  return {
    request,
    executable: '/usr/bin/python3',
    arguments: ['-I', '-S', '/proc/self/fd/3', '--supervise'],
    shell: false,
    environment: { LANG: 'C', LC_ALL: 'C' },
    protocolLimitBytes: 65536,
    physicalExecution: 'BLOCKED',
    nextCapabilities: [] as never[],
  } as const;
};

export const requireProbePhysicalAuthorization = (): void => {
  // Human permission requires a subsequent reviewed binding, never a JSON flag.
  throw new Error(
    'PHYS-P2 SOURCE-ONLY: live PROBE_ONLY entry BLOCKED; future explicit authorization and review required',
  );
};
