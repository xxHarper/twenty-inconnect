import { z } from 'zod';

import {
  decode,
  digest,
  requireLeadPhysical,
  uuid,
} from 'test/development/inconnect-lead-physical/contracts';
import { type ProbeRequest } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';

const snapshotSchema = z.strictObject({
  bootId: uuid,
  namespaces: z.strictObject({
    user: z.string().regex(/^user:\[[1-9][0-9]*\]$/),
    net: z.string().regex(/^net:\[[1-9][0-9]*\]$/),
    mnt: z.string().regex(/^mnt:\[[1-9][0-9]*\]$/),
    pid: z.string().regex(/^pid:\[[1-9][0-9]*\]$/),
  }),
  mountinfo: digest,
  'net/route': z.string().max(65536),
  'net/ipv6_route': z.string().max(65536),
  'net/unix': z.string().max(65536),
});

const eventSchema = z.strictObject({
  runId: uuid,
  bootId: uuid,
  sequence: z.number().int().positive(),
  kind: z.enum([
    'ACQUIRING',
    'ACQUIRED',
    'LAUNCHING',
    'RUNNING',
    'NORMAL_EXIT',
    'TIMEOUT',
    'CANCELLED',
    'INTERRUPTED',
    'PARTIAL_FAILURE',
    'SUPERVISOR_LOST',
    'RECOVERING',
    'CLOSED',
  ]),
  supervisorExited: z.boolean().optional(),
  treeEmpty: z.boolean().optional(),
  hostUnchanged: z.boolean().optional(),
  evidenceComplete: z.boolean().optional(),
  boundaryPassed: z.boolean().optional(),
  before: snapshotSchema.optional(),
  observations: z
    .strictObject({
      before: snapshotSchema,
      after: snapshotSchema,
      probe: snapshotSchema,
    })
    .optional(),
});

export const parseProbeEvent = (input: unknown) => decode(eventSchema, input);

export type ProbeEvent = z.infer<typeof eventSchema>;
export type ProbeState = {
  phase: 'PREPARING' | ProbeEvent['kind'] | 'UNVERIFIED';
  sequence: number;
  outcome: 'PENDING' | 'PASS' | 'FAIL' | 'UNVERIFIED';
  cause: ProbeEvent['kind'] | null;
  resourcesPreserved: true;
};

export const initialProbeState = (): ProbeState => ({
  phase: 'PREPARING',
  sequence: 0,
  outcome: 'PENDING',
  cause: null,
  resourcesPreserved: true,
});

const transitions: Record<ProbeState['phase'], readonly ProbeEvent['kind'][]> =
  {
    PREPARING: ['ACQUIRING', 'PARTIAL_FAILURE'],
    ACQUIRING: ['ACQUIRED', 'PARTIAL_FAILURE'],
    ACQUIRED: ['LAUNCHING', 'PARTIAL_FAILURE'],
    LAUNCHING: ['RUNNING', 'PARTIAL_FAILURE'],
    RUNNING: [
      'NORMAL_EXIT',
      'TIMEOUT',
      'CANCELLED',
      'INTERRUPTED',
      'PARTIAL_FAILURE',
      'SUPERVISOR_LOST',
    ],
    NORMAL_EXIT: ['CLOSED'],
    TIMEOUT: ['RECOVERING', 'CLOSED'],
    CANCELLED: ['RECOVERING', 'CLOSED'],
    INTERRUPTED: ['RECOVERING', 'CLOSED'],
    PARTIAL_FAILURE: ['RECOVERING', 'CLOSED'],
    SUPERVISOR_LOST: ['RECOVERING'],
    RECOVERING: ['CLOSED'],
    CLOSED: [],
    UNVERIFIED: [],
  };

export const reduceProbeEvent = (
  request: ProbeRequest,
  state: ProbeState,
  input: unknown,
): ProbeState => {
  const event = decode(eventSchema, input);
  requireLeadPhysical(
    event.runId === request.runId &&
      event.bootId === request.bootId &&
      event.sequence === state.sequence + 1 &&
      transitions[state.phase].includes(event.kind),
    'Probe evidence identity, sequence or lifecycle mismatch',
  );
  const cause = [
    'NORMAL_EXIT',
    'TIMEOUT',
    'CANCELLED',
    'INTERRUPTED',
    'PARTIAL_FAILURE',
    'SUPERVISOR_LOST',
  ].includes(event.kind)
    ? event.kind
    : state.cause;
  if (event.kind !== 'CLOSED')
    return { ...state, phase: event.kind, sequence: event.sequence, cause };
  const complete =
    event.observations !== undefined &&
    event.supervisorExited === true &&
    event.treeEmpty === true &&
    event.hostUnchanged === true &&
    event.evidenceComplete === true;
  const observed = event.observations;
  const independent =
    observed !== undefined &&
    [observed.before, observed.after, observed.probe].every(
      (item) => item.bootId === request.bootId,
    ) &&
    JSON.stringify(observed.before) === JSON.stringify(observed.after) &&
    Object.keys(observed.before.namespaces).every((key) => {
      const namespace = key as keyof typeof observed.before.namespaces;
      return (
        observed.before.namespaces[namespace] !==
        observed.probe.namespaces[namespace]
      );
    });
  return {
    ...state,
    phase: 'CLOSED',
    sequence: event.sequence,
    cause,
    outcome: !complete
      ? 'UNVERIFIED'
      : independent &&
          cause === request.expectedTermination &&
          event.boundaryPassed === true
        ? 'PASS'
        : 'FAIL',
  };
};

export const unverifiedProbeState = (state: ProbeState): ProbeState => ({
  ...state,
  phase: 'UNVERIFIED',
  outcome: 'UNVERIFIED',
});

export const planProbeCleanup = (state: ProbeState) => ({
  removePaths: [] as never[],
  numericPidSignals: [] as never[],
  preserveResources: true,
  closureVerified: state.phase === 'CLOSED' && state.outcome !== 'UNVERIFIED',
});
