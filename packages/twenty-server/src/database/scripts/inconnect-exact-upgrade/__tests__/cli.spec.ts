import { requireExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';
import { runCli } from 'src/database/scripts/inconnect-exact-upgrade/cli';
import {
  APPROVED_COMMANDS,
  EXPECTED_BRANCH,
  EXPECTED_DATA_DIRECTORY,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { inspectReadOnly } from 'src/database/scripts/inconnect-exact-upgrade/inspection';
import {
  readGit,
  requireHostQuiescence,
  verifyBackupFile,
} from 'src/database/scripts/inconnect-exact-upgrade/operator-files';
import { executeRegistered } from 'src/database/scripts/inconnect-exact-upgrade/registered-execution';
import { auditSources } from 'src/database/scripts/inconnect-exact-upgrade/source-audit';

jest.mock(
  'src/database/scripts/inconnect-exact-upgrade/execution-safety',
  () => ({ requireExecutionSafety: jest.fn() }),
);

jest.mock('src/database/scripts/inconnect-exact-upgrade/inspection', () => ({
  inspectReadOnly: jest.fn(),
}));
jest.mock(
  'src/database/scripts/inconnect-exact-upgrade/operator-files',
  () => ({
    readGit: jest.fn(),
    requireHostQuiescence: jest.fn(),
    verifyBackupFile: jest.fn(),
  }),
);
jest.mock('src/database/scripts/inconnect-exact-upgrade/source-audit', () => ({
  auditSources: jest.fn(),
}));
jest.mock(
  'src/database/scripts/inconnect-exact-upgrade/registered-execution',
  () => ({ executeRegistered: jest.fn() }),
);

const commit = 'a'.repeat(40);
const args = ['--command', APPROVED_COMMANDS[0], '--expected-commit', commit];
const makeSnapshot = () => ({
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
  legacyNames: [],
  tracking: [],
  workspaceIds: [],
  otherSessions: 0,
  stateHash: 'b'.repeat(64),
  backupRelations: [],
});

describe('one-shot CLI orchestration with mocked inspection and runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireExecutionSafety).mockImplementation(() => undefined);
    jest
      .mocked(readGit)
      .mockReturnValue({ branch: EXPECTED_BRANCH, commit, status: '' });
    jest.mocked(auditSources).mockReturnValue({
      commands: APPROVED_COMMANDS.map((name) => ({
        name,
        kind: 'fast',
        source: '',
      })),
      legacyNames: [],
      previousWorkspaceCommand: 'Previous',
    });
    jest.mocked(inspectReadOnly).mockResolvedValue(makeSnapshot());
    jest.mocked(verifyBackupFile).mockResolvedValue(undefined);
    process.env.PG_DATABASE_URL =
      'postgresql://operator:secret@localhost:5432/default';
    process.env.PG_DATABASE_REPLICA_URL = '';
    jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PG_DATABASE_URL;
    delete process.env.PG_DATABASE_REPLICA_URL;
  });

  it('should inspect read-only in default preview and never import/execute the runner route', async () => {
    await runCli(args);
    expect(inspectReadOnly).toHaveBeenCalledTimes(1);
    expect(executeRegistered).not.toHaveBeenCalled();
    expect(verifyBackupFile).not.toHaveBeenCalled();
  });

  it('should reject dirty Git before connecting to PostgreSQL', async () => {
    jest
      .mocked(readGit)
      .mockReturnValue({ branch: EXPECTED_BRANCH, commit, status: '?? file' });

    await expect(runCli(args)).rejects.toThrow('Dirty');
    expect(inspectReadOnly).not.toHaveBeenCalled();
    expect(executeRegistered).not.toHaveBeenCalled();
  });

  it('should never load runner dependencies when any preflight fails', async () => {
    jest
      .mocked(inspectReadOnly)
      .mockResolvedValue({ ...makeSnapshot(), schemaValid: false });

    await expect(
      runCli([
        ...args,
        '--mode',
        'execute',
        '--confirm-execute',
        APPROVED_COMMANDS[0],
        '--backup-manifest',
        '/verified.json',
      ]),
    ).rejects.toThrow('physical schema');
    expect(executeRegistered).not.toHaveBeenCalled();
  });

  it('should repeat target/Git/process validation before a single mocked execution', async () => {
    jest
      .mocked(executeRegistered)
      .mockImplementation(async (request, _environment, _snapshot, recheck) => {
        await recheck(1234);
        jest.mocked(inspectReadOnly).mockResolvedValue({
          ...makeSnapshot(),
          tracking: [
            {
              name: request.command,
              status: 'completed',
              attempt: 1,
              workspaceId: null,
              isInitial: false,
            },
          ],
        });
        return { status: 'success' };
      });

    await runCli([
      ...args,
      '--mode',
      'execute',
      '--confirm-execute',
      APPROVED_COMMANDS[0],
      '--backup-manifest',
      '/verified.json',
    ]);
    expect(executeRegistered).toHaveBeenCalledTimes(1);
    expect(executeRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ command: APPROVED_COMMANDS[0] }),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    );
    expect(readGit).toHaveBeenCalledTimes(2);
    expect(requireHostQuiescence).toHaveBeenCalledTimes(2);
    expect(inspectReadOnly).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.anything(),
      1234,
    );
    expect(inspectReadOnly).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({ mode: 'verify-completed' }),
    );
  });

  it('should propagate runner errors without post-success verification', async () => {
    const error = new Error('failed');
    jest
      .mocked(executeRegistered)
      .mockResolvedValue({ status: 'failed', error });

    await expect(
      runCli([
        ...args,
        '--mode',
        'execute',
        '--confirm-execute',
        APPROVED_COMMANDS[0],
        '--backup-manifest',
        '/verified.json',
      ]),
    ).rejects.toBe(error);
    expect(inspectReadOnly).toHaveBeenCalledTimes(1);
  });
  it('should report post-commit verification failure without claiming rollback or success', async () => {
    jest.mocked(executeRegistered).mockResolvedValue({ status: 'success' });
    jest
      .mocked(inspectReadOnly)
      .mockResolvedValueOnce(makeSnapshot())
      .mockResolvedValueOnce({ ...makeSnapshot(), schemaValid: false });
    await expect(
      runCli([
        ...args,
        '--mode',
        'execute',
        '--confirm-execute',
        APPROVED_COMMANDS[0],
        '--backup-manifest',
        '/verified.json',
      ]),
    ).rejects.toThrow('physical schema');
    expect(executeRegistered).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('should propagate uncertain rollback/tracking rejection and never claim success', async () => {
    const uncertainty = new Error('rollback or failure tracking unavailable');
    jest.mocked(executeRegistered).mockRejectedValue(uncertainty);
    await expect(
      runCli([
        ...args,
        '--mode',
        'execute',
        '--confirm-execute',
        APPROVED_COMMANDS[0],
        '--backup-manifest',
        '/verified.json',
      ]),
    ).rejects.toBe(uncertainty);
    expect(inspectReadOnly).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).not.toHaveBeenCalled();
  });
});
