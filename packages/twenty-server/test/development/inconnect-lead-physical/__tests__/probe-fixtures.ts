import { createHash } from 'node:crypto';

import { type ProbeEvent } from 'test/development/inconnect-lead-physical/probe-only/probe-lifecycle';
import { type ProbeRequest } from 'test/development/inconnect-lead-physical/probe-only/probe-plan';
import { type ProbePort } from 'test/development/inconnect-lead-physical/probe-only/probe-session';

export const syntheticProgram = Buffer.from(
  '# Synthetic source, never executed\n',
);
export const probeRequest = (): ProbeRequest => ({
  capability: 'PROBE_ONLY',
  probe: 'BOUNDARY',
  expectedTermination: 'NORMAL_EXIT',
  runId: '10000000-0000-4000-8000-000000000001',
  bootId: '20000000-0000-4000-8000-000000000001',
  reviewedCommit: '0fc4a3114dde9f1b6c57c76948b562de0dfe3ada',
  supervisorSha256: createHash('sha256').update(syntheticProgram).digest('hex'),
  resourceRoot: '/tmp/inconnect-lead-phys-10000000-0000-4000-8000-000000000001',
  deadlineSeconds: 2,
  memoryMiB: 256,
  processLimit: 32,
});

export const probeEvents = (
  cause: ProbeEvent['kind'] = 'NORMAL_EXIT',
): ProbeEvent[] =>
  (
    [
      'ACQUIRING',
      'ACQUIRED',
      'LAUNCHING',
      'RUNNING',
      cause,
      'CLOSED',
    ] as ProbeEvent['kind'][]
  ).map((kind, index) => ({
    runId: probeRequest().runId,
    bootId: probeRequest().bootId,
    sequence: index + 1,
    kind,
    ...(kind === 'CLOSED'
      ? {
          supervisorExited: true,
          treeEmpty: true,
          hostUnchanged: true,
          evidenceComplete: true,
          boundaryPassed: true,
          observations: {
            before: probeSnapshot(),
            after: probeSnapshot(),
            probe: {
              ...probeSnapshot(),
              namespaces: {
                user: 'user:[11]',
                net: 'net:[12]',
                mnt: 'mnt:[13]',
                pid: 'pid:[14]',
              },
            },
          },
        }
      : {}),
    ...(kind === 'ACQUIRED' ? { before: probeSnapshot() } : {}),
  }));

const probeSnapshot = () => ({
  bootId: probeRequest().bootId,
  namespaces: {
    user: 'user:[1]',
    net: 'net:[2]',
    mnt: 'mnt:[3]',
    pid: 'pid:[4]',
  },
  mountinfo: 'a'.repeat(64),
  'net/route': 'header\n',
  'net/ipv6_route': '',
  'net/unix': 'header\n',
});

export const simulatedProbePort = (events: unknown[] = probeEvents()) => {
  const requestCancel = jest.fn(async () => undefined);
  const confirmAcquisition = jest.fn(async () => undefined);
  const port: ProbePort = {
    currentBootId: jest.fn(async () => probeRequest().bootId),
    record: jest.fn(async () => undefined),
    launch: jest.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
      requestCancel,
      confirmAcquisition,
      exit: Promise.resolve({ code: 0, signal: null }),
    })),
  };
  return { port, requestCancel, confirmAcquisition };
};
