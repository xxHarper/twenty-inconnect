import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { z } from 'zod';

import { sessionIdentitySchema } from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import {
  EXPECTED_DATA_DIRECTORY,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

const namespaceSchema = z.string().regex(/^(net|mnt|pid):\[\d+\]$/);
const namespacesSchema = z.strictObject({
  network: namespaceSchema.regex(/^net:/),
  mount: namespaceSchema.regex(/^mnt:/),
  process: namespaceSchema.regex(/^pid:/),
});

// These are linkage checks, not authentication of a caller-supplied manifest.
// PG1 must obtain this record from a separately reviewed setup supervisor.
export const targetContractSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  host: z.literal('127.0.0.1'),
  port: z.number().int().min(1024).max(65535),
  database: z.string().regex(/^inconnect_disposable_[a-z0-9_]+$/),
  role: z.string().regex(/^inconnect_disposable_[a-z0-9_]+$/),
  expected: sessionIdentitySchema.omit({
    backendPid: true,
    backendStart: true,
  }),
  evidence: z.strictObject({
    origin: z.literal('independent-disposable-supervisor'),
    controlDataSha256: z.string().regex(/^[a-f0-9]{64}$/),
    credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
    // Both identifiers come from offline pg_controldata setup evidence. Never
    // populate the expected identifier from the session being checked.
    defaultSystemIdentifier: z.string().regex(/^[1-9]\d*$/),
    disposableSystemIdentifier: z.string().regex(/^[1-9]\d*$/),
    resourceRoot: z.string(),
    postmasterPid: z.number().int().positive(),
    postmasterStartTicks: z.string().regex(/^\d+$/),
    hostNamespaces: namespacesSchema,
    isolatedNamespaces: namespacesSchema,
  }),
});

export type TargetContract = z.infer<typeof targetContractSchema>;

export const validateTargetContract = (input: unknown): TargetContract => {
  // Fixed diagnostics prevent malformed secret-bearing input appearing in logs.
  const parsed = targetContractSchema.safeParse(input);
  requireCondition(
    parsed.success,
    'Explicit independent disposable target evidence required',
  );
  if (!parsed.success) throw new Error('Invalid disposable target');
  const contract = parsed.data;
  const { expected, evidence } = contract;
  const resourceRoot = `/tmp/inconnect-pg-${contract.runId}`;

  requireCondition(
    contract.port !== 5432 &&
      expected.port === contract.port &&
      expected.host === '127.0.0.1/32' &&
      expected.database === contract.database &&
      expected.currentUser === contract.role &&
      expected.sessionUser === contract.role &&
      evidence.resourceRoot === resourceRoot &&
      expected.dataDirectory === `${resourceRoot}/data` &&
      posix.normalize(expected.dataDirectory) === expected.dataDirectory &&
      expected.dataDirectory !== EXPECTED_DATA_DIRECTORY &&
      expected.systemIdentifier === evidence.disposableSystemIdentifier &&
      expected.systemIdentifier !== evidence.defaultSystemIdentifier &&
      Object.keys(evidence.hostNamespaces).every((key) => {
        const namespace = key as keyof typeof evidence.hostNamespaces;
        return (
          evidence.hostNamespaces[namespace] !==
          evidence.isolatedNamespaces[namespace]
        );
      }),
    'Disposable database, port, role, directory, cluster and namespaces must be independently isolated',
  );
  return contract;
};

export const validateDisposableCredential = (
  input: unknown,
  password: string,
): TargetContract => {
  const contract = validateTargetContract(input);
  requireCondition(
    typeof password === 'string' &&
      password.length >= 32 &&
      createHash('sha256').update(password).digest('hex') ===
        contract.evidence.credentialSha256,
    'Unexpected disposable credential; fallback forbidden',
  );
  return contract;
};

// Application loaders use process > .env.test/.env > defaults. The physical
// harness has a different contract: no dotenv imports and no PG environment.
export const validateHarnessEnvironment = (
  environment: Record<string, string | undefined>,
): void => {
  requireCondition(
    environment.NODE_ENV === 'test' &&
      Object.entries(environment).every(
        ([key, value]) =>
          value === undefined ||
          !/^(PG|REDIS|DATABASE_URL$|INCONNECT_.*(URL|EXECUTE|FORCE)|NODE_OPTIONS$|NODE_PATH$|TS_NODE|DOTENV)/i.test(
            key,
          ),
      ),
    'Harness requires NODE_ENV=test and no inherited database, Redis or loader configuration',
  );
};

export const isolatedChildEnvironment = (): Readonly<Record<string, string>> =>
  Object.freeze({ NODE_ENV: 'test', LANG: 'C', LC_ALL: 'C' });
