import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type CommandShutdownService } from 'src/database/commands/command-runners/command-shutdown.service';
import { type InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';
import { type UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import {
  type UpgradeStep,
  type UpgradeSequenceReaderService,
} from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';
import { UpgradeSequenceRunnerService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-runner.service';
import { type WorkspaceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/workspace-command-runner.service';
import {
  VOICE_HISTORY_FOLLOWING_SLOW_NAME,
  VOICE_HISTORY_UPGRADE_NAME,
} from 'src/engine/core-modules/upgrade/utils/voice-history-upgrade-order.util';
import { type UpgradeAwareEntityMetadataAdapter } from 'src/engine/twenty-orm/upgrade-aware/upgrade-aware-entity-metadata.adapter';
import { type WorkspaceVersionService } from 'src/engine/workspace-manager/workspace-version/services/workspace-version.service';

const WORKSPACE_ID = 'workspace-1';

const makeStep = (kind: UpgradeStep['kind'], name: string) =>
  ({
    kind,
    name,
    command: {},
    version: '1.0.0',
    timestamp: 0,
  }) as unknown as UpgradeStep;

describe('UpgradeSequenceRunnerService shutdown handling', () => {
  let service: UpgradeSequenceRunnerService;
  let isShutdownRequested: jest.Mock<boolean, []>;
  let runFastInstanceCommand: jest.Mock;
  let iterate: jest.Mock;
  let currentCursor: jest.Mock;
  let voiceTracking: jest.Mock;
  let locateStep: jest.Mock;

  beforeEach(() => {
    isShutdownRequested = jest.fn().mockReturnValue(false);
    runFastInstanceCommand = jest.fn().mockResolvedValue({ status: 'success' });
    iterate = jest.fn().mockResolvedValue({
      success: [{ workspaceId: WORKSPACE_ID }],
      fail: [],
      interrupted: false,
    });

    currentCursor = jest
      .fn()
      .mockResolvedValue({ name: 'step-1', status: 'failed' });
    voiceTracking = jest.fn();
    locateStep = jest.fn().mockReturnValue(0);
    const upgradeMigrationService = {
      getLastAttemptedCommandNameOrThrow: currentCursor,
      getVoiceHistoryTrackingState: voiceTracking,
      getWorkspaceLastAttemptedCommandNameOrThrow: jest
        .fn()
        .mockResolvedValue(new Map()),
    } as unknown as UpgradeMigrationService;

    const upgradeSequenceReaderService = {
      locateStepInSequenceOrThrow: locateStep,
      getWorkspaceSegmentBounds: jest
        .fn()
        .mockReturnValue({ startCursor: 0, endCursor: 0 }),
      collectWorkspaceCommandsStartingFrom: jest
        .fn()
        .mockImplementation(({ fromWorkspaceCommand }) => [
          fromWorkspaceCommand,
        ]),
      getPendingWorkspaceCommands: jest.fn().mockReturnValue([]),
    } as unknown as UpgradeSequenceReaderService;

    service = new UpgradeSequenceRunnerService(
      upgradeMigrationService,
      { runFastInstanceCommand } as unknown as InstanceCommandRunnerService,
      {
        runWorkspaceCommands: jest.fn(),
      } as unknown as WorkspaceCommandRunnerService,
      upgradeSequenceReaderService,
      {
        refresh: jest.fn().mockResolvedValue(undefined),
      } as unknown as UpgradeAwareEntityMetadataAdapter,
      { iterate } as unknown as WorkspaceIteratorService,
      {
        getProvisionedWorkspaceIds: jest.fn().mockResolvedValue([WORKSPACE_ID]),
      } as unknown as WorkspaceVersionService,
      { isShutdownRequested } as unknown as CommandShutdownService,
    );

    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  it('should run every step when no shutdown is requested', async () => {
    const sequence = [
      makeStep('fast-instance', 'step-1'),
      makeStep('fast-instance', 'step-2'),
    ];

    await service.run({ sequence, options: {} });

    expect(runFastInstanceCommand).toHaveBeenCalledTimes(2);
  });

  it('should stop before the next step when a shutdown is requested', async () => {
    const sequence = [
      makeStep('fast-instance', 'step-1'),
      makeStep('fast-instance', 'step-2'),
    ];

    isShutdownRequested.mockReturnValueOnce(false).mockReturnValue(true);

    await service.run({ sequence, options: {} });

    expect(runFastInstanceCommand).toHaveBeenCalledTimes(1);
    expect(runFastInstanceCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'step-1' }),
    );
  });

  it('should not advance to the next instance step when a workspace segment is interrupted', async () => {
    const sequence = [
      makeStep('workspace', 'workspace-step-1'),
      makeStep('fast-instance', 'instance-step-1'),
    ];

    iterate.mockResolvedValue({
      success: [{ workspaceId: WORKSPACE_ID }],
      fail: [],
      interrupted: true,
    });

    const report = await service.run({ sequence, options: {} });

    expect(runFastInstanceCommand).not.toHaveBeenCalled();
    expect(report).toEqual({ totalSuccesses: 1, totalFailures: 0 });
  });

  it('should advance to the next instance step when a workspace segment completes', async () => {
    const sequence = [
      makeStep('workspace', 'workspace-step-1'),
      makeStep('fast-instance', 'instance-step-1'),
    ];

    await service.run({ sequence, options: {} });

    expect(runFastInstanceCommand).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'failed'])(
    'Voice V1.2 stops at the known gap with %s tracking',
    async (state) => {
      const sequence = [
        makeStep('fast-instance', VOICE_HISTORY_UPGRADE_NAME),
        makeStep('slow-instance', VOICE_HISTORY_FOLLOWING_SLOW_NAME),
        makeStep('fast-instance', 'other-pending'),
      ];
      currentCursor.mockResolvedValue({
        name: VOICE_HISTORY_FOLLOWING_SLOW_NAME,
        status: 'completed',
      });
      locateStep.mockReturnValue(1);
      voiceTracking.mockResolvedValue(state);
      await expect(service.run({ sequence, options: {} })).rejects.toThrow(
        'Voice V1.2 has missing or failed tracking',
      );
      expect(voiceTracking).toHaveBeenCalledWith([WORKSPACE_ID]);
      expect(runFastInstanceCommand).not.toHaveBeenCalled();
    },
  );

  it('Voice V1.2 resumes the ordinary sequence after verifying the full Voice tracking', async () => {
    const sequence = [
      makeStep('fast-instance', VOICE_HISTORY_UPGRADE_NAME),
      makeStep('slow-instance', VOICE_HISTORY_FOLLOWING_SLOW_NAME),
      makeStep('fast-instance', 'other-pending'),
    ];
    currentCursor.mockResolvedValue({
      name: VOICE_HISTORY_FOLLOWING_SLOW_NAME,
      status: 'completed',
    });
    locateStep.mockReturnValue(1);
    voiceTracking.mockResolvedValue('completed');
    await service.run({ sequence, options: {} });
    expect(runFastInstanceCommand).toHaveBeenCalledTimes(1);
    expect(runFastInstanceCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'other-pending' }),
    );
  });

  it('Voice V1.2 leaves an ordinary empty-cursor predecessor path in native Fast order', async () => {
    const sequence = [
      makeStep('fast-instance', 'step-1'),
      makeStep('fast-instance', VOICE_HISTORY_UPGRADE_NAME),
    ];
    await service.run({ sequence, options: {} });
    expect(voiceTracking).not.toHaveBeenCalled();
    expect(
      runFastInstanceCommand.mock.calls.map(([step]) => step.name),
    ).toEqual(['step-1', VOICE_HISTORY_UPGRADE_NAME]);
  });
});
