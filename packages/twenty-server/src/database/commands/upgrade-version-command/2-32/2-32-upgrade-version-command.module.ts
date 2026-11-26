import { Module } from '@nestjs/common';

import { WorkspaceIteratorModule } from 'src/database/commands/command-runners/workspace-iterator.module';
import { RefreshVoicePermissionFlagsCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-workspace-command-1795608000001-refresh-voice-permission-flags.command';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [WorkspaceCacheModule, WorkspaceIteratorModule],
  providers: [RefreshVoicePermissionFlagsCommand],
})
export class V2_32_UpgradeVersionCommandModule {}
