import { Command } from 'nest-commander';
import { PermissionFlagType, SystemPermissionFlag } from 'twenty-shared/constants';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

@RegisteredWorkspaceCommand('2.32.0', 1795608000001)
@Command({
  name: 'upgrade:2-32:refresh-voice-permission-flags',
  description: 'Refresh the workspace permission flag metadata after installing Voice V1.4',
})
export class RefreshVoicePermissionFlagsCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly workspaceCache: WorkspaceCacheService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({ workspaceId, options }: RunOnWorkspaceArgs): Promise<void> {
    if (options.dryRun) return;

    await this.workspaceCache.invalidateAndRecompute(workspaceId, ['flatPermissionFlagMaps']);
    const { flatPermissionFlagMaps } = await this.workspaceCache.getOrRecompute(workspaceId, ['flatPermissionFlagMaps']);
    for (const key of [
      PermissionFlagType.DIAL_INCONNECT_VOICE,
      PermissionFlagType.READ_UNLINKED_INCONNECT_VOICE_HISTORY,
    ]) {
      const flag = flatPermissionFlagMaps.byUniversalIdentifier[SystemPermissionFlag[key]];
      if (flag?.key !== key || flag.workspaceId !== workspaceId)
        throw new Error('Voice permission metadata is unavailable');
    }
  }
}
