import { resolve } from 'node:path';

import {
  resolveEnvironment,
  validatePostgresEnvironment,
} from 'src/database/scripts/inconnect-exact-upgrade/environment';
import { requireExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';

import {
  dispatchExact,
  ExactUpgradeGuardError,
  requestSchema,
  requireCondition,
  type Snapshot,
  validateGit,
  validateSnapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { inspectReadOnly } from 'src/database/scripts/inconnect-exact-upgrade/inspection';
import {
  readGit,
  requireHostQuiescence,
  verifyBackupFile,
} from 'src/database/scripts/inconnect-exact-upgrade/operator-files';
import { auditSources } from 'src/database/scripts/inconnect-exact-upgrade/source-audit';

export const parseArguments = (
  args: string[],
): ReturnType<typeof requestSchema.parse> => {
  const values: Record<string, string> = {};
  const options: Record<string, string> = {
    '--command': 'command',
    '--mode': 'mode',
    '--expected-commit': 'expectedCommit',
    '--confirm-execute': 'confirmExecute',
    '--backup-manifest': 'backupManifest',
  };

  for (let index = 0; index < args.length; index += 2) {
    const key = options[args[index]];
    const value = args[index + 1];

    requireCondition(
      Boolean(key) &&
        Boolean(value) &&
        !value.startsWith('--') &&
        !(key in values),
      'Unknown, repeated or malformed option',
    );
    values[key] = value;
  }
  return requestSchema.parse(values);
};

export const runCli = async (args: string[]): Promise<void> => {
  const request = parseArguments(args);
  if (request.mode === 'execute') requireExecutionSafety();
  const serverRoot = resolve(__dirname, '../../../..');
  const root = resolve(serverRoot, '../..');
  const environment = resolveEnvironment(serverRoot, process.env);
  let snapshot: Snapshot;
  let ownBackendPid: number | undefined;
  const inventory = auditSources(
    serverRoot,
    environment.IS_BILLING_ENABLED === 'true',
  );
  const preflight = async (): Promise<void> => {
    validateGit(request, readGit(root));
    validatePostgresEnvironment(environment);
    if (request.mode === 'execute') requireHostQuiescence();
    snapshot = await inspectReadOnly(
      environment.PG_DATABASE_URL as string,
      request,
      ownBackendPid,
    );
    validateSnapshot(request, inventory, snapshot);
  };

  await dispatchExact(request, {
    preflight,
    verifyBackup: () => verifyBackupFile(request, snapshot),
    executeOne: async () => {
      const before = snapshot.stateHash;
      const { executeRegistered } =
        await import('src/database/scripts/inconnect-exact-upgrade/registered-execution');
      const result = await executeRegistered(
        request,
        environment,
        snapshot,
        async (pid) => {
          ownBackendPid = pid;
          await verifyBackupFile(request, snapshot);
          await preflight();
          requireCondition(
            before === snapshot.stateHash,
            'State changed during runner preparation',
          );
        },
      );

      if (result.status === 'success') {
        const verificationRequest = {
          ...request,
          mode: 'verify-completed' as const,
        };
        const after = await inspectReadOnly(
          environment.PG_DATABASE_URL as string,
          verificationRequest,
        );
        validateSnapshot(verificationRequest, inventory, after);
        snapshot = after;
      }
      return result;
    },
  });
  process.stdout.write(
    JSON.stringify(
      {
        result:
          request.mode === 'execute'
            ? 'EXECUTED_AND_VERIFIED'
            : request.mode === 'verify-completed'
              ? 'COMPLETED_AND_VERIFIED'
              : 'PREVIEW_ONLY',
        mode: request.mode,
        command: request.command,
        expectedCommit: request.expectedCommit,
        database: snapshot!.database,
        dataDirectory: snapshot!.dataDirectory,
        systemIdentifier: snapshot!.systemIdentifier,
        stateHash: snapshot!.stateHash,
        schemaValid: snapshot!.schemaValid,
        backupValidated:
          request.mode === 'validate-backup' || request.mode === 'execute',
      },
      null,
      2,
    ) + '\n',
  );
};

export const reportFailure = (error: unknown): void => {
  // Library errors can contain URLs, passwords or provider secrets. Detailed
  // diagnostics belong to reviewed local inspection; failures always exit 1.
  const reason =
    error instanceof ExactUpgradeGuardError
      ? error.message
      : 'selector, source, target, tracking, schema, backup or runner validation failed (details withheld)';
  process.stderr.write(`BLOCKED/FAILED: ${reason}. No success declared.\n`);
  process.exitCode = 1;
};

if (require.main === module) {
  void runCli(process.argv.slice(2)).catch(reportFailure);
}
