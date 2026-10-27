import {
  BLOCKED,
  ownedPaths,
  validateConfiguration,
} from 'test/development/inconnect-lead-physical/contracts';
import { rejectInheritedEnvironment } from 'test/development/inconnect-lead-physical/environment';

// There is no executor, process adapter, fs adapter or authorization flag in P1.
export const requirePhysicalExecution = (): never => {
  throw new Error(
    'PHYS-P1: physical execution BLOCKED; separately reviewed A0 implementation and authorization required',
  );
};

export const buildSupervisorCandidate = (
  input: unknown,
  inherited: Record<string, string | undefined>,
) => {
  rejectInheritedEnvironment(inherited);
  const configuration = validateConfiguration(input);
  return {
    phase: 'PHYS-P1',
    physicalExecution: BLOCKED,
    shell: false,
    executable: '/usr/bin/bwrap',
    // Probe command only. The service tree and live guardian are not implemented.
    arguments: [
      '--unshare-user',
      '--unshare-net',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--die-with-parent',
      '--new-session',
      '--clearenv',
      '--ro-bind',
      '/usr',
      '/usr',
      '--ro-bind',
      '/lib',
      '/lib',
      '--ro-bind',
      '/lib64',
      '/lib64',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/run',
      '--dir',
      '/var',
      '--dir',
      '/var/run',
      '--dir',
      '/var/lib',
      '--bind',
      configuration.resourceRoot,
      '/lm',
      '--setenv',
      'HOME',
      '/lm/home',
      '--setenv',
      'LANG',
      'C',
      '--setenv',
      'LC_ALL',
      'C',
      '--',
      '/usr/bin/true',
    ],
    environment: { LANG: 'C', LC_ALL: 'C' },
    resources: ownedPaths(configuration),
    limits: {
      memoryMiB: configuration.memoryMiB,
      processLimit: configuration.processLimit,
      deadlineSeconds: configuration.deadlineSeconds,
    },
    limitsEnforced: false,
    lifecycleEnforced: false,
  } as const;
};

export const buildServiceCandidates = (input: unknown) => {
  const configuration = validateConfiguration(input);
  return {
    physicalExecution: BLOCKED,
    shell: false,
    initdb: {
      executable: '/usr/lib/postgresql/18/bin/initdb',
      arguments: [
        '-D',
        '/lm/data',
        '-U',
        configuration.role,
        '--pwfile=/lm/secrets/postgres',
        '--auth-local=scram-sha-256',
        '--auth-host=scram-sha-256',
      ],
    },
    postgres: {
      executable: '/usr/lib/postgresql/18/bin/postgres',
      arguments: [
        '-D',
        '/lm/data',
        '-h',
        '127.0.0.1',
        '-p',
        String(configuration.postgresPort),
        '-k',
        '/lm/socket',
        '-c',
        'shared_buffers=64MB',
        '-c',
        'max_connections=20',
        '-c',
        'work_mem=2MB',
        '-c',
        'max_parallel_workers_per_gather=0',
      ],
    },
    redis: {
      executable: '/usr/bin/redis-server',
      arguments: [
        '--bind',
        '127.0.0.1',
        '--port',
        String(configuration.redisPort),
        '--dir',
        '/lm/redis',
        '--save',
        '',
        '--appendonly',
        'no',
        '--maxmemory',
        '64mb',
        '--maxmemory-policy',
        'noeviction',
        '--protected-mode',
        'yes',
        '--aclfile',
        '/lm/secrets/redis.acl',
      ],
    },
  } as const;
};

export const inspectLauncherRequest = (arguments_: readonly string[]) => {
  if (arguments_.length !== 1 || arguments_[0] !== '--describe')
    requirePhysicalExecution();
  return {
    phase: 'PHYS-P1',
    physicalExecution: BLOCKED,
    databaseCalls: 0,
    processCalls: 0,
    filesystemCalls: 0,
    nextStage: 'PHYS-A0 requires independent physical review and authorization',
  } as const;
};
