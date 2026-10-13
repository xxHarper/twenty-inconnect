import { DataSource } from 'typeorm';

import { runCli } from 'src/database/scripts/inconnect-exact-upgrade/cli';
import {
  APPROVED_COMMANDS,
  type Request,
  type Snapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { executeRegistered } from 'src/database/scripts/inconnect-exact-upgrade/registered-execution';
import { requireHostQuiescence } from 'src/database/scripts/inconnect-exact-upgrade/operator-files';
import { requirePhysicalHarnessSafety } from 'src/database/scripts/inconnect-exact-upgrade/test-only-contract';

const request: Request = {
  command: APPROVED_COMMANDS[0],
  mode: 'execute',
  confirmExecute: APPROVED_COMMANDS[0],
  expectedCommit: 'a'.repeat(40),
  backupManifest: '/self-attestation.json',
};

describe('blocked real execution routes (no network or runner startup)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should reject standalone execution before preparing any datasource or spare failure-tracking connection', async () => {
    const initialize = jest
      .spyOn(DataSource.prototype, 'initialize')
      .mockRejectedValue(new Error('Network forbidden'));
    const recheck = jest.fn();
    await expect(
      executeRegistered(request, {}, {} as Snapshot, recheck),
    ).rejects.toThrow('Execution BLOCKED');
    expect(initialize).not.toHaveBeenCalled();
    expect(recheck).not.toHaveBeenCalled();
  });

  it('should reject the operational execute route before even Git, manifest or environment inspection', async () => {
    await expect(
      runCli([
        '--command',
        request.command,
        '--expected-commit',
        request.expectedCommit,
        '--mode',
        'execute',
        '--confirm-execute',
        request.command,
        '--backup-manifest',
        '/missing.json',
      ]),
    ).rejects.toThrow('UNKNOWN');
  });

  it('should never turn incomplete process visibility into maintenance PASS', () => {
    expect(() => requireHostQuiescence()).toThrow(
      'Maintenance isolation UNKNOWN',
    );
  });

  it('should block a physical harness while actual writer/restart/restore guarantees remain unknown', () => {
    expect(() => requirePhysicalHarnessSafety()).toThrow('UNKNOWN');
  });
});
