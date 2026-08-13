import { Injectable, Logger } from '@nestjs/common';

import {
  ObjectRecordCreateEvent,
  ObjectRecordRestoreEvent,
  ObjectRecordUpdateEvent,
  ObjectRecordUpsertEvent,
  type ObjectRecordDeleteEvent,
  type ObjectRecordDestroyEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

@Injectable()
export class GlobalWorkspaceMemberListener {
  private readonly logger = new Logger(GlobalWorkspaceMemberListener.name);

  constructor(private readonly workspaceCacheService: WorkspaceCacheService) {}

  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.CREATED)
  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.UPDATED)
  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.DELETED)
  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.DESTROYED)
  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.RESTORED)
  @OnDatabaseBatchEvent('workspaceMember', DatabaseEventAction.UPSERTED)
  async handleWorkspaceMemberEvent(
    payload: WorkspaceEventBatch<
      | ObjectRecordCreateEvent<WorkspaceMemberWorkspaceEntity>
      | ObjectRecordUpdateEvent<WorkspaceMemberWorkspaceEntity>
      | ObjectRecordDeleteEvent<WorkspaceMemberWorkspaceEntity>
      | ObjectRecordDestroyEvent<WorkspaceMemberWorkspaceEntity>
      | ObjectRecordRestoreEvent<WorkspaceMemberWorkspaceEntity>
      | ObjectRecordUpsertEvent<WorkspaceMemberWorkspaceEntity>
    >,
  ) {
    try {
      await this.workspaceCacheService.invalidateAndRecompute(
        payload.workspaceId,
        ['flatWorkspaceMemberMaps', 'inconnectTeamAccessMaps'],
      );
    } catch (error) {
      // Database events run after commit. The fenced INCONNECT value remains
      // invalid when recomputation fails, so this must not mimic a DB rollback.
      this.logger.error(
        `Workspace Member cache refresh failed after commit for workspace ${payload.workspaceId}`,
        error,
      );
    }
  }
}
