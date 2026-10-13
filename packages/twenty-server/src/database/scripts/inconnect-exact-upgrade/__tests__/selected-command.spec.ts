import { APPROVED_COMMANDS } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { runSelectedCommand } from 'src/database/scripts/inconnect-exact-upgrade/selected-command';

const expectedIdentity = {
  database: 'inconnect_disposable_proof',
  host: '127.0.0.1/32',
  port: 55432,
  version: '18.6',
  dataDirectory: '/tmp/isolated-cluster',
  systemIdentifier: '456',
  currentUser: 'tester',
  sessionUser: 'tester',
  clientAddress: '127.0.0.1/32' as const,
};

describe('registered single-command runner boundary (mock runner, no PostgreSQL)', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(APPROVED_COMMANDS)(
    'should pass exactly one real registered implementation for %s',
    async (name) => {
      const runner = {
        runFastInstanceCommand: jest
          .fn()
          .mockResolvedValue({ status: 'success' }),
      };

      await runSelectedCommand(
        {
          command: name,
          mode: 'execute',
          expectedCommit: 'a'.repeat(40),
          confirmExecute: name,
          backupManifest: '/verified.json',
        },
        runner,
        expectedIdentity,
      );
      expect(runner.runFastInstanceCommand).toHaveBeenCalledTimes(1);
      const selection = runner.runFastInstanceCommand.mock.calls[0][0];

      expect(selection.connectionVerification.verifyConnection).toBeInstanceOf(
        Function,
      );
      expect(selection.name).toBe(name);
      expect(
        `2.32.0_${selection.command.constructor.name}_${name.split('_').pop()}`,
      ).toBe(name);
      expect(selection.command.up).toBeInstanceOf(Function);
      expect(selection.command.down).toBeInstanceOf(Function);
    },
  );

  it('should never execute from a preview request', async () => {
    const runner = { runFastInstanceCommand: jest.fn() };

    await expect(
      runSelectedCommand(
        {
          command: APPROVED_COMMANDS[0],
          mode: 'preview',
          expectedCommit: 'a'.repeat(40),
        },
        runner,
        expectedIdentity,
      ),
    ).rejects.toThrow();
    expect(runner.runFastInstanceCommand).not.toHaveBeenCalled();
  });

  it('should propagate the actual runner failure result without converting it to success', async () => {
    const error = new Error('runner failure');
    const runner = {
      runFastInstanceCommand: jest
        .fn()
        .mockResolvedValue({ status: 'failed', error }),
    };

    await expect(
      runSelectedCommand(
        {
          command: APPROVED_COMMANDS[0],
          mode: 'execute',
          expectedCommit: 'a'.repeat(40),
          confirmExecute: APPROVED_COMMANDS[0],
          backupManifest: '/verified.json',
        },
        runner,
        expectedIdentity,
      ),
    ).resolves.toEqual({ status: 'failed', error });
  });
});
