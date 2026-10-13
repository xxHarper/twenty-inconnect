import { resolve } from 'node:path';

import { parseArguments } from 'src/database/scripts/inconnect-exact-upgrade/cli';
import {
  APPROVED_COMMANDS,
  backupSchema,
  dispatchExact,
  EXPECTED_BRANCH,
  EXPECTED_DATA_DIRECTORY,
  type Inventory,
  type Request,
  type Snapshot,
  validateBackup,
  validateConfiguredTarget,
  validateGit,
  validateSnapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { canonicalCheck } from 'src/database/scripts/inconnect-exact-upgrade/schema';
import { auditSources } from 'src/database/scripts/inconnect-exact-upgrade/source-audit';

const commit = 'a'.repeat(40);
const previous = '2.31.0_PreviousWorkspaceCommand_1234567890000';
const request: Request = {
  command: APPROVED_COMMANDS[0],
  mode: 'preview',
  expectedCommit: commit,
};
const inventory: Inventory = {
  commands: APPROVED_COMMANDS.map((name) => ({
    name,
    kind: 'fast',
    source: '',
  })),
  legacyNames: ['Legacy1234567890000'],
  previousWorkspaceCommand: previous,
};
const makeSnapshot = (): Snapshot => ({
  database: 'default',
  host: '127.0.0.1/32',
  port: 5432,
  version: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
  dataDirectory: EXPECTED_DATA_DIRECTORY,
  systemIdentifier: '123',
  currentUser: 'operator',
  sessionUser: 'operator',
  extensions: ['uuid-ossp'],
  schemaValid: true,
  legacyNames: [...inventory.legacyNames],
  tracking: [
    {
      name: previous,
      status: 'completed',
      attempt: 1,
      workspaceId: 'workspace',
      isInitial: false,
    },
  ],
  workspaceIds: ['workspace'],
  otherSessions: 0,
  stateHash: 'b'.repeat(64),
  backupRelations: [],
});

describe('exact local instance command guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should default a valid selector to preview', () => {
    expect(
      parseArguments([
        '--command',
        APPROVED_COMMANDS[0],
        '--expected-commit',
        commit,
      ]).mode,
    ).toBe('preview');
  });

  it.each([
    'unknown',
    '1790793305698',
    `${APPROVED_COMMANDS[0]} `,
    '*',
    '2.32.0_UnrelatedFastInstanceCommand_1790793305699',
    APPROVED_COMMANDS.join(','),
  ])(
    'should reject an unknown, malformed or multi-command identity: %s',
    (command) => {
      expect(() =>
        parseArguments(['--command', command, '--expected-commit', commit]),
      ).toThrow();
    },
  );

  it.each([
    [
      '--command',
      APPROVED_COMMANDS[0],
      '--command',
      APPROVED_COMMANDS[1],
      '--expected-commit',
      commit,
    ],
    [
      '--command',
      APPROVED_COMMANDS[0],
      '--expected-commit',
      commit,
      '--all',
      'true',
    ],
    ['--command', APPROVED_COMMANDS[0], '--expected-commit'],
  ])('should reject repeated selectors or unsupported arguments', (...args) => {
    expect(() => parseArguments(args)).toThrow();
  });

  it('should never call the runner or backup verifier in preview', async () => {
    const dependencies = {
      preflight: jest.fn().mockResolvedValue(undefined),
      verifyBackup: jest.fn(),
      executeOne: jest.fn(),
    };

    await dispatchExact(request, dependencies);
    expect(dependencies.preflight).toHaveBeenCalledTimes(1);
    expect(dependencies.verifyBackup).not.toHaveBeenCalled();
    expect(dependencies.executeOne).not.toHaveBeenCalled();
  });

  it('should reject 5700 before 5698 is completed', () => {
    expect(() =>
      validateSnapshot(
        { ...request, command: APPROVED_COMMANDS[1] },
        inventory,
        makeSnapshot(),
      ),
    ).toThrow('5698');
  });

  it('should reject an already-completed command', () => {
    const snapshot = makeSnapshot();
    snapshot.tracking.push({
      name: request.command,
      status: 'completed',
      attempt: 1,
      workspaceId: null,
      isInitial: false,
    });

    expect(() => validateSnapshot(request, inventory, snapshot)).toThrow(
      'already completed',
    );
  });

  it('should accept only consistent completed 5698 tracking before selecting 5700', () => {
    const snapshot = makeSnapshot();
    for (const workspaceId of [null, 'workspace'])
      snapshot.tracking.push({
        name: APPROVED_COMMANDS[0],
        status: 'completed',
        attempt: 1,
        workspaceId,
        isInitial: false,
      });

    expect(() =>
      validateSnapshot(
        { ...request, command: APPROVED_COMMANDS[1] },
        inventory,
        snapshot,
      ),
    ).not.toThrow();
    snapshot.tracking.pop();
    expect(() =>
      validateSnapshot(
        { ...request, command: APPROVED_COMMANDS[1] },
        inventory,
        snapshot,
      ),
    ).toThrow('workspace tracking');
  });

  it.each([
    { database: 'production' },
    { host: '10.0.0.1/32' },
    { port: 5433 },
    { version: '18.7' },
    { dataDirectory: '/other/cluster' },
    { otherSessions: 1 },
    { schemaValid: false },
    { legacyNames: [] },
  ])(
    'should reject a wrong physical target or invalid database state %j',
    (change) => {
      expect(() =>
        validateSnapshot(request, inventory, { ...makeSnapshot(), ...change }),
      ).toThrow();
    },
  );

  it.each([
    'postgresql://user:secret@remote:5432/default',
    'postgresql://user:secret@localhost:5432/other',
    'postgresql://user:secret@localhost:5432/default?host=remote',
    'postgresql://user:secret@localhost/default',
  ])(
    'should reject configured target overrides without printing credentials',
    (connectionString) => {
      expect(() => validateConfiguredTarget(connectionString)).toThrow(
        'Only explicit',
      );
    },
  );

  it('should reject an unexpected pending Fast or Slow command', () => {
    for (const kind of ['fast', 'slow'] as const) {
      expect(() =>
        validateSnapshot(
          request,
          {
            ...inventory,
            commands: [
              ...inventory.commands,
              { name: 'Unrelated', kind, source: '' },
            ],
          },
          makeSnapshot(),
        ),
      ).toThrow('pending Fast/Slow');
    }
  });

  it('should reject an allow-listed identity missing from the registration', () => {
    expect(() =>
      validateSnapshot(request, { ...inventory, commands: [] }, makeSnapshot()),
    ).toThrow('not registered');
  });

  it('should reject dirty, wrong-branch and wrong-commit repositories', () => {
    const git = { branch: EXPECTED_BRANCH, commit, status: '' };

    expect(() => validateGit(request, git)).not.toThrow();
    for (const change of [
      { status: '?? tooling.ts' },
      { status: ' M tracked.ts' },
      { branch: 'main' },
      { commit: 'c'.repeat(40) },
    ]) {
      expect(() => validateGit(request, { ...git, ...change })).toThrow();
    }
  });

  it('should reject inconsistent, duplicate or failed tracking', () => {
    const snapshot = makeSnapshot();
    snapshot.tracking.push({
      name: 'Earlier',
      status: 'failed',
      attempt: 1,
      workspaceId: null,
      isInitial: false,
    });
    expect(() => validateSnapshot(request, inventory, snapshot)).toThrow(
      'Failed',
    );
    snapshot.tracking[snapshot.tracking.length - 1].status = 'completed';
    snapshot.tracking[snapshot.tracking.length - 1].attempt = 2;
    expect(() => validateSnapshot(request, inventory, snapshot)).toThrow(
      'Inconsistent',
    );
    snapshot.tracking[snapshot.tracking.length - 1].attempt = 1;
    snapshot.tracking.push({
      ...snapshot.tracking[snapshot.tracking.length - 1],
    });
    expect(() => validateSnapshot(request, inventory, snapshot)).toThrow(
      'Duplicate',
    );
  });

  it('should reject missing prior workspace completion', () => {
    expect(() =>
      validateSnapshot(request, inventory, { ...makeSnapshot(), tracking: [] }),
    ).toThrow('Previous version');
  });
  it('should preserve initial-cursor semantics for historical workspace tracking', () => {
    const snapshot = makeSnapshot();
    snapshot.tracking.push({
      name: 'Historical',
      status: 'completed',
      attempt: 1,
      workspaceId: null,
      isInitial: false,
    });

    expect(() =>
      validateSnapshot(
        request,
        {
          ...inventory,
          commands: [
            ...inventory.commands,
            { name: 'Historical', kind: 'fast', source: '' },
          ],
        },
        snapshot,
      ),
    ).not.toThrow();
  });

  it('should reject a later command with orphan workspace tracking', () => {
    const snapshot = makeSnapshot();
    snapshot.tracking.push({
      name: APPROVED_COMMANDS[1],
      status: 'completed',
      attempt: 1,
      workspaceId: 'workspace',
      isInitial: false,
    });

    expect(() => validateSnapshot(request, inventory, snapshot)).toThrow(
      'Orphan',
    );
  });

  it('should require a verified backup and exact opt-in before dispatch', async () => {
    const dependencies = {
      preflight: jest.fn().mockResolvedValue(undefined),
      verifyBackup: jest.fn().mockResolvedValue(undefined),
      executeOne: jest.fn(),
    };

    await expect(
      dispatchExact(
        { ...request, mode: 'execute', confirmExecute: request.command },
        dependencies,
      ),
    ).rejects.toThrow('backup');
    await expect(
      dispatchExact(
        { ...request, mode: 'execute', backupManifest: '/backup.json' },
        dependencies,
      ),
    ).rejects.toThrow('confirm-execute');
    expect(dependencies.executeOne).not.toHaveBeenCalled();
  });

  it('should verify a backup without dispatching a command', async () => {
    const dependencies = {
      preflight: jest.fn().mockResolvedValue(undefined),
      verifyBackup: jest.fn().mockResolvedValue(undefined),
      executeOne: jest.fn(),
    };

    await dispatchExact(
      { ...request, mode: 'validate-backup', backupManifest: '/backup.json' },
      dependencies,
    );
    expect(dependencies.verifyBackup).toHaveBeenCalledTimes(1);
    expect(dependencies.executeOne).not.toHaveBeenCalled();
  });

  it('should dispatch exactly one approved name after its guards', async () => {
    const dependencies = {
      preflight: jest.fn().mockResolvedValue(undefined),
      verifyBackup: jest.fn().mockResolvedValue(undefined),
      executeOne: jest.fn().mockResolvedValue({ status: 'success' }),
    };

    await dispatchExact(
      {
        ...request,
        mode: 'execute',
        backupManifest: '/backup.json',
        confirmExecute: request.command,
      },
      dependencies,
    );
    expect(dependencies.executeOne).toHaveBeenCalledTimes(1);
    expect(dependencies.executeOne).toHaveBeenCalledWith(APPROVED_COMMANDS[0]);
  });

  it('should propagate runner errors and reject already-executed races', async () => {
    const failure = new Error('DDL failed');
    const execution = {
      ...request,
      mode: 'execute' as const,
      backupManifest: '/backup.json',
      confirmExecute: request.command,
    };
    const dependencies = {
      preflight: jest.fn().mockResolvedValue(undefined),
      verifyBackup: jest.fn().mockResolvedValue(undefined),
      executeOne: jest
        .fn()
        .mockResolvedValue({ status: 'failed', error: failure }),
    };

    await expect(dispatchExact(execution, dependencies)).rejects.toBe(failure);
    dependencies.executeOne.mockResolvedValue({ status: 'already-executed' });
    await expect(dispatchExact(execution, dependencies)).rejects.toThrow(
      'already-executed',
    );
    dependencies.executeOne.mockRejectedValue(failure);
    await expect(dispatchExact(execution, dependencies)).rejects.toBe(failure);
  });

  it('should require backup identity, verified restore and fresh evidence', () => {
    const now = Date.now();
    const backup = backupSchema.parse({
      command: request.command,
      expectedCommit: commit,
      database: 'default',
      host: '127.0.0.1',
      port: 5432,
      dataDirectory: EXPECTED_DATA_DIRECTORY,
      systemIdentifier: '123',
      stateHash: 'b'.repeat(64),
      currentUser: 'operator',
      serverVersion: '18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)',
      backupPath: '/backup.dump',
      sha256: 'c'.repeat(64),
      createdAt: new Date(now - 2000).toISOString(),
      restoreVerifiedAt: new Date(now - 1000).toISOString(),
      verifiedBy: 'operator',
      verificationEvidencePath: '/restore.log',
      verificationEvidenceSha256: 'e'.repeat(64),
      restoreVerified: true,
      fullDatabaseBackup: true,
      writersStoppedAndRestartPrevented: true,
    });

    expect(() =>
      validateBackup(request, makeSnapshot(), backup, now),
    ).not.toThrow();
    expect(() =>
      backupSchema.parse({ ...backup, restoreVerified: false }),
    ).toThrow();
    expect(() =>
      validateBackup(
        request,
        makeSnapshot(),
        { ...backup, stateHash: 'd'.repeat(64) },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateBackup(
        request,
        makeSnapshot(),
        { ...backup, command: APPROVED_COMMANDS[1] },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateBackup(
        request,
        makeSnapshot(),
        backup,
        now + 25 * 60 * 60 * 1000,
      ),
    ).toThrow();
  });

  it('should retain CHECK grouping while accepting PostgreSQL cosmetic parentheses', () => {
    expect(canonicalCheck('CHECK ((("revision" >= 0)))')).toBe(
      canonicalCheck('CHECK (revision >= 0)'),
    );
    expect(
      canonicalCheck(
        "CHECK ((((autoCreateLabelPolicy)::text IS NULL) OR ((autoCreateLabelPolicy)::text = 'OMIT'::text)))",
      ),
    ).toBe(
      canonicalCheck(
        "CHECK (autoCreateLabelPolicy IS NULL OR autoCreateLabelPolicy = 'OMIT')",
      ),
    );
    expect(
      canonicalCheck('CHECK ((a = false AND b IS NULL) OR c IS NULL)'),
    ).not.toBe(
      canonicalCheck('CHECK (a = false AND (b IS NULL OR c IS NULL))'),
    );
    expect(() =>
      canonicalCheck('CHECK (revision >= 0); DROP TABLE x'),
    ).toThrow();
  });

  it('should statically find the actual registered allowlist without importing providers', () => {
    const actual = auditSources(resolve(__dirname, '../../../../..'), false);

    expect(
      actual.commands
        .filter(({ name }) =>
          APPROVED_COMMANDS.includes(
            name as (typeof APPROVED_COMMANDS)[number],
          ),
        )
        .map(({ name }) => name),
    ).toEqual(APPROVED_COMMANDS);
    expect(actual.legacyNames.length).toBeGreaterThan(100);
    expect(actual.previousWorkspaceCommand).toBe(
      '2.31.0_TrimMessageCampaignRecordPageCommand_1786456707000',
    );
  });
});
