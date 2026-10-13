import { z } from 'zod';

export const APPROVED_COMMANDS = [
  '2.32.0_AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand_1790793305698',
  '2.32.0_AddInconnectMessagingAutomationPrincipalFastInstanceCommand_1790793305700',
] as const;

export const EXPECTED_BRANCH = 'feature/inconnect-messaging';
export const EXPECTED_DATA_DIRECTORY = '/var/lib/postgresql/18/main';

export const requestSchema = z.strictObject({
  command: z.enum(APPROVED_COMMANDS),
  mode: z
    .enum(['preview', 'validate-backup', 'execute', 'verify-completed'])
    .default('preview'),
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  confirmExecute: z.enum(APPROVED_COMMANDS).optional(),
  backupManifest: z.string().optional(),
});

export type Request = z.infer<typeof requestSchema>;
export type RegisteredIdentity = {
  name: string;
  kind: 'fast' | 'slow';
  source: string;
};
export type TrackingRow = {
  name: string;
  status: 'completed' | 'failed';
  attempt: number;
  workspaceId: string | null;
  isInitial: boolean;
};
export type Snapshot = {
  database: string;
  host: string;
  port: number;
  version: string;
  dataDirectory: string;
  systemIdentifier: string;
  currentUser: string;
  sessionUser: string;
  extensions: string[];
  schemaValid: boolean;
  legacyNames: string[];
  tracking: TrackingRow[];
  workspaceIds: string[];
  otherSessions: number;
  stateHash: string;
  backupRelations: Array<{ schema: string; name: string; kind: string }>;
};
export type Inventory = {
  commands: RegisteredIdentity[];
  legacyNames: string[];
  previousWorkspaceCommand: string;
};

export class ExactUpgradeGuardError extends Error {}

export const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) throw new ExactUpgradeGuardError(message);
};

export const validateGit = (
  request: Request,
  git: { branch: string; commit: string; status: string },
): void => {
  requireCondition(git.branch === EXPECTED_BRANCH, 'Wrong branch');
  requireCondition(git.commit === request.expectedCommit, 'Unexpected commit');
  requireCondition(
    git.status === '',
    'Dirty repository (including untracked files)',
  );
};

export const validateConfiguredTarget = (connectionString: string): void => {
  const target = new URL(connectionString);

  requireCondition(
    ['postgres:', 'postgresql:'].includes(target.protocol) &&
      ['localhost', '127.0.0.1'].includes(target.hostname) &&
      target.port === '5432' &&
      target.pathname === '/default' &&
      target.search === '' &&
      target.hash === '' &&
      /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(decodeURIComponent(target.username)) &&
      decodeURIComponent(target.password).length > 0,
    'Only explicit localhost:5432/default without connection overrides is allowed',
  );
};

export const validateSnapshot = (
  request: Request,
  inventory: Inventory,
  snapshot: Snapshot,
): void => {
  requireCondition(
    snapshot.database === 'default' &&
      snapshot.host === '127.0.0.1/32' &&
      snapshot.port === 5432 &&
      snapshot.version === '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)' &&
      snapshot.dataDirectory === EXPECTED_DATA_DIRECTORY &&
      /^\d+$/.test(snapshot.systemIdentifier) &&
      Boolean(snapshot.currentUser) &&
      snapshot.currentUser === snapshot.sessionUser,
    'Unexpected physical PostgreSQL target',
  );
  requireCondition(
    snapshot.extensions.includes('uuid-ossp'),
    'Required PostgreSQL extensions are absent',
  );
  requireCondition(snapshot.otherSessions === 0, 'Other target sessions exist');
  requireCondition(
    snapshot.schemaValid,
    'Invalid or partially applied physical schema',
  );
  requireCondition(
    new Set(snapshot.legacyNames).size === snapshot.legacyNames.length &&
      inventory.legacyNames.every((name) =>
        snapshot.legacyNames.includes(name),
      ) &&
      snapshot.legacyNames.every((name) =>
        inventory.legacyNames.includes(name),
      ),
    'Unexpected pending or unknown legacy migration',
  );
  requireCondition(
    new Set(inventory.commands.map(({ name }) => name)).size ===
      inventory.commands.length,
    'Duplicate registered identity',
  );
  requireCondition(
    inventory.commands.filter(
      ({ name, kind }) => name === request.command && kind === 'fast',
    ).length === 1,
    'Exact command is not registered as Fast',
  );

  const scopes = new Map<string, TrackingRow[]>();

  for (const row of snapshot.tracking) {
    requireCondition(
      ['completed', 'failed'].includes(row.status) &&
        Number.isSafeInteger(row.attempt) &&
        row.attempt > 0,
      'Invalid tracking row',
    );
    const key = JSON.stringify([row.name, row.workspaceId]);
    scopes.set(key, [...(scopes.get(key) ?? []), row]);
  }

  const latest = (
    name: string,
    workspaceId: string | null,
  ): TrackingRow | undefined => {
    const rows = (scopes.get(JSON.stringify([name, workspaceId])) ?? []).sort(
      (first, second) => first.attempt - second.attempt,
    );

    requireCondition(
      new Set(rows.map(({ attempt }) => attempt)).size === rows.length,
      'Duplicate tracking attempts',
    );
    if (workspaceId === null)
      requireCondition(
        rows.every((row, index) => row.attempt === index + 1 && !row.isInitial),
        'Inconsistent instance tracking',
      );

    return rows[rows.length - 1];
  };

  for (const rows of scopes.values()) {
    const row = rows[0];
    const last = latest(row.name, row.workspaceId);

    requireCondition(
      last?.status === 'completed',
      'Failed or inconsistent upgrade tracking',
    );
  }

  const completed = (name: string): boolean =>
    latest(name, null)?.status === 'completed';
  const instanceNames = new Set(inventory.commands.map(({ name }) => name));

  for (const row of snapshot.tracking) {
    if (
      !instanceNames.has(row.name) ||
      row.workspaceId === null ||
      row.isInitial
    )
      continue;
    const matchingInstance = snapshot.tracking.find(
      (instance) =>
        instance.name === row.name &&
        instance.workspaceId === null &&
        instance.attempt === row.attempt,
    );

    requireCondition(
      matchingInstance?.status === row.status,
      'Orphan or contradictory workspace tracking',
    );
  }
  const verifying = request.mode === 'verify-completed';

  requireCondition(
    verifying
      ? completed(request.command)
      : !snapshot.tracking.some(({ name }) => name === request.command),
    verifying
      ? 'Command is not completed'
      : 'Command already completed or attempted',
  );
  requireCondition(
    request.command !== APPROVED_COMMANDS[1] || completed(APPROVED_COMMANDS[0]),
    '5698 must be completed before 5700',
  );
  requireCondition(
    !completed(APPROVED_COMMANDS[1]) || completed(APPROVED_COMMANDS[0]),
    'Invalid 5698 → 5700 order',
  );
  for (const workspaceId of snapshot.workspaceIds) {
    requireCondition(
      latest(inventory.previousWorkspaceCommand, workspaceId)?.status ===
        'completed',
      'Previous version workspace command has not completed',
    );
  }

  const expectedPending = APPROVED_COMMANDS.filter((name) => !completed(name));
  const pending = inventory.commands
    .filter(({ name }) => !completed(name))
    .map(({ name }) => name);

  requireCondition(
    pending.length === expectedPending.length &&
      pending.every((name) =>
        expectedPending.includes(name as (typeof APPROVED_COMMANDS)[number]),
      ),
    'Unexpected pending Fast/Slow command',
  );
  // Twenty initializes new workspaces at a cursor, not with one row for every
  // historical instance command. Existing rows must correlate with attempts;
  // only these two newly executed commands require complete current-workspace rows.
  for (const name of APPROVED_COMMANDS.filter(completed)) {
    const instance = latest(name, null);

    for (const workspaceId of snapshot.workspaceIds) {
      const workspace = latest(name, workspaceId);

      requireCondition(
        workspace?.status === 'completed' &&
          (workspace.isInitial || workspace.attempt === instance?.attempt),
        'Inconsistent workspace tracking',
      );
    }
  }
};

export const backupSchema = z.strictObject({
  command: z.enum(APPROVED_COMMANDS),
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  database: z.literal('default'),
  host: z.literal('127.0.0.1'),
  port: z.literal(5432),
  dataDirectory: z.literal(EXPECTED_DATA_DIRECTORY),
  systemIdentifier: z.string().regex(/^\d+$/),
  stateHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentUser: z.string().min(1),
  serverVersion: z.string().min(1),
  backupPath: z.string().startsWith('/'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  restoreVerifiedAt: z.iso.datetime(),
  verifiedBy: z.string().min(1),
  verificationEvidencePath: z.string().startsWith('/'),
  verificationEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Legacy attestations describe claims only. They never satisfy execution safety.
  restoreVerified: z.literal(true),
  fullDatabaseBackup: z.literal(true),
  writersStoppedAndRestartPrevented: z.literal(true),
});
export type Backup = z.infer<typeof backupSchema>;

export const validateBackup = (
  request: Request,
  snapshot: Snapshot,
  backup: Backup,
  now = Date.now(),
): void => {
  const createdAt = Date.parse(backup.createdAt);
  const verifiedAt = Date.parse(backup.restoreVerifiedAt);

  requireCondition(
    backup.command === request.command &&
      backup.expectedCommit === request.expectedCommit &&
      backup.systemIdentifier === snapshot.systemIdentifier &&
      backup.currentUser === snapshot.currentUser &&
      backup.serverVersion === snapshot.version &&
      backup.stateHash === snapshot.stateHash &&
      createdAt <= verifiedAt &&
      verifiedAt <= now &&
      now - createdAt < 24 * 60 * 60 * 1000,
    'Backup identity, restore evidence or freshness mismatch',
  );
};

export const dispatchExact = async (
  request: Request,
  dependencies: {
    preflight: () => Promise<void>;
    verifyBackup: () => Promise<void>;
    executeOne: (
      name: (typeof APPROVED_COMMANDS)[number],
    ) => Promise<
      | { status: 'success' }
      | { status: 'already-executed' }
      | { status: 'failed'; error: unknown }
    >;
  },
): Promise<void> => {
  await dependencies.preflight();
  if (request.mode === 'preview' || request.mode === 'verify-completed') return;
  requireCondition(
    Boolean(request.backupManifest),
    'Verified backup manifest is required',
  );
  await dependencies.verifyBackup();
  if (request.mode === 'validate-backup') return;
  requireCondition(
    request.confirmExecute === request.command,
    'Execution requires exact --confirm-execute identity',
  );
  const result = await dependencies.executeOne(request.command);

  if (result.status === 'failed') throw result.error;
  requireCondition(
    result.status === 'success',
    'Runner did not execute: already-executed race',
  );
};
