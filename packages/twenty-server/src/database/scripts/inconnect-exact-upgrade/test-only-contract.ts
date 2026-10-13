import { z } from 'zod';

import {
  sessionIdentitySchema,
  verifySessionIdentity,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import { requireExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';
import {
  EXPECTED_DATA_DIRECTORY,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';

// Contract validation only; intentionally no physical entrypoint, connection,
// dotenv fallback, Redis client, application imports or command execution.
export const disposableContractSchema = z.strictObject({
  connectionUrl: z.string(),
  localSystemIdentifier: z.string().regex(/^\d+$/),
  expected: sessionIdentitySchema.omit({
    backendPid: true,
    backendStart: true,
  }),
});

export const validateDisposableContract = (input: unknown) => {
  const contract = disposableContractSchema.parse(input);
  const target = new URL(contract.connectionUrl);

  requireCondition(
    ['postgres:', 'postgresql:'].includes(target.protocol) &&
      target.hostname === '127.0.0.1' &&
      target.port !== '' &&
      target.port !== '5432' &&
      /^\/inconnect_disposable_[a-z0-9_]+$/.test(target.pathname) &&
      target.search === '' &&
      target.hash === '' &&
      target.username !== '' &&
      target.password !== '' &&
      contract.expected.host === '127.0.0.1/32' &&
      contract.expected.port === Number(target.port) &&
      contract.expected.database === target.pathname.slice(1) &&
      contract.expected.currentUser === decodeURIComponent(target.username) &&
      contract.expected.sessionUser === decodeURIComponent(target.username) &&
      contract.expected.dataDirectory.startsWith('/') &&
      contract.expected.dataDirectory !== EXPECTED_DATA_DIRECTORY &&
      contract.expected.systemIdentifier !== contract.localSystemIdentifier,
    'Disposable target must be isolated from local default in database, port, directory, cluster and role',
  );
  return contract;
};

export const verifyDisposableSession = (
  input: unknown,
  session: unknown,
): void => {
  const contract = validateDisposableContract(input);
  verifySessionIdentity(session, contract.expected);
};

// A valid test contract cannot initialize or execute without separate physical
// approval and resolved isolation/review gates. This is not a runnable harness.
export const requirePhysicalHarnessSafety = (): void =>
  requireExecutionSafety();
