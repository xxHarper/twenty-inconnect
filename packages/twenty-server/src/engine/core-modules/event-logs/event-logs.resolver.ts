/* @license Enterprise */

import {
  ForbiddenException,
  UseFilters,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';
import { EventLogTable } from 'twenty-shared/types';

import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { EventLogsGraphqlApiExceptionFilter } from 'src/engine/core-modules/event-logs/filters/event-logs-graphql-api-exception.filter';
import { ForbiddenExceptionGraphqlFilter } from 'src/engine/core-modules/event-logs/filters/forbidden-exception-graphql.filter';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-graphql-api-exception.filter';

import { EventLogsService } from './event-logs.service';

import { EventLogQueryInput } from './dtos/event-log-query.input';
import { EventLogQueryResult } from './dtos/event-log-result.dto';

@MetadataResolver()
@UseFilters(
  ForbiddenExceptionGraphqlFilter,
  AuthGraphqlApiExceptionFilter,
  EventLogsGraphqlApiExceptionFilter,
  PermissionsGraphqlApiExceptionFilter,
  PreventNestToAutoLogGraphqlErrorsFilter,
)
@UsePipes(ResolverValidationPipe)
export class EventLogsResolver {
  constructor(
    private readonly eventLogsService: EventLogsService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
  ) {}

  @UseGuards(
    WorkspaceAuthGuard,
    SettingsPermissionGuard(PermissionFlagType.SECURITY),
  )
  @Query(() => EventLogQueryResult)
  async eventLogs(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('input') input: EventLogQueryInput,
  ): Promise<EventLogQueryResult> {
    await this.assertHistoryAllowed(workspace.id, input.table);
    const result = await this.eventLogsService.queryEventLogs(
      workspace.id,
      input,
    );

    await this.assertHistoryAllowed(workspace.id, input.table);

    return result;
  }

  private async assertHistoryAllowed(
    workspaceId: string,
    table: EventLogTable,
  ) {
    if (
      table === EventLogTable.OBJECT_EVENT &&
      !(await this.recordAccessAuthorizationService.isGenericRecordEventHistoryAllowed(
        workspaceId,
      ))
    ) {
      throw new ForbiddenException('Object event history is unavailable');
    }
  }
}
