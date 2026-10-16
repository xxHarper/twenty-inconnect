import {
  ForbiddenException,
  UseFilters,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Args, Context, Subscription } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';
import { EventLogTable } from 'twenty-shared/types';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type RawAuthContext } from 'src/engine/core-modules/auth/types/raw-auth-context.type';
import { EventLogsGraphqlApiExceptionFilter } from 'src/engine/core-modules/event-logs/filters/event-logs-graphql-api-exception.filter';
import { ForbiddenExceptionGraphqlFilter } from 'src/engine/core-modules/event-logs/filters/forbidden-exception-graphql.filter';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-graphql-api-exception.filter';
import { APPLICATION_KEEPALIVE_INTERVAL_MS } from 'src/engine/subscriptions/constants/application-keepalive-interval-ms.constant';
import { SubscriptionChannel } from 'src/engine/subscriptions/enums/subscription-channel.enum';
import { SubscriptionService } from 'src/engine/subscriptions/subscription.service';
import { wrapAsyncIteratorWithLifecycle } from 'src/engine/subscriptions/utils/wrap-async-iterator-with-lifecycle';
import { EventLogLiveService } from 'src/engine/core-modules/event-logs/live/event-log-live.service';

import { EventLogsService } from './event-logs.service';

import { EventLogRecord } from './dtos/event-log-result.dto';
import { getClickHouseTableName } from './registry/event-log-registry';
import { normalizeEventLogRecords } from './utils/normalize-event-log-records';

type WorkspaceEventLivePayload = {
  table: string;
  rows: Record<string, unknown>[];
};

type EventLogsLivePrincipal = Readonly<{
  userWorkspaceId: string;
  applicationId: string | undefined;
}>;

@MetadataResolver()
@UseFilters(
  ForbiddenExceptionGraphqlFilter,
  AuthGraphqlApiExceptionFilter,
  EventLogsGraphqlApiExceptionFilter,
  PermissionsGraphqlApiExceptionFilter,
  PreventNestToAutoLogGraphqlErrorsFilter,
)
@UsePipes(ResolverValidationPipe)
export class EventLogsLiveResolver {
  constructor(
    private readonly eventLogsService: EventLogsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly workspaceEventLiveService: EventLogLiveService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @UseGuards(
    WorkspaceAuthGuard,
    SettingsPermissionGuard(PermissionFlagType.SECURITY),
  )
  @Subscription(() => [EventLogRecord], {
    nullable: true,
    filter: (
      payload: WorkspaceEventLivePayload,
      variables: { table: EventLogTable },
    ) => getClickHouseTableName(variables.table) === payload.table,
    resolve: (
      payload: WorkspaceEventLivePayload,
      variables: { table: EventLogTable },
    ) => normalizeEventLogRecords(payload.rows, variables.table),
  })
  async eventLogsLive(
    @Args('table', { type: () => EventLogTable }) table: EventLogTable,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @Context('req') authContext: RawAuthContext,
  ) {
    const workspaceId = workspace.id;
    const application = authContext?.application;

    if (
      !userWorkspaceId ||
      authContext?.userWorkspaceId !== userWorkspaceId ||
      authContext.apiKey != null ||
      (authContext.tokenType === JwtTokenTypeEnum.APPLICATION_ACCESS &&
        !application) ||
      (application != null &&
        (typeof application.id !== 'string' ||
          application.id.trim().length === 0 ||
          application.workspaceId !== workspaceId))
    ) {
      throw new ForbiddenException('Invalid event log subscription principal');
    }

    // Capture IDs before awaiting: a subscription must never drop its application
    // or switch authority through later mutation of the request/cache objects.
    const principal: EventLogsLivePrincipal = {
      userWorkspaceId,
      applicationId: application?.id,
    };

    if (!(await this.hasCurrentAccess(workspaceId, table, principal))) {
      throw new ForbiddenException('Event log subscription access denied');
    }

    const clickHouseTable = getClickHouseTableName(table);

    await this.workspaceEventLiveService.markWatched(
      workspaceId,
      clickHouseTable,
    );

    const iterator = await this.subscriptionService.subscribe({
      channel: SubscriptionChannel.WORKSPACE_EVENTS_CHANNEL,
      workspaceId,
    });

    return wrapAsyncIteratorWithLifecycle(
      this.authorizeDeliveries(iterator, workspaceId, table, principal),
      {
        onHeartbeat: async () => {
          if (!(await this.hasCurrentAccess(workspaceId, table, principal))) {
            await iterator.return?.();

            return false;
          }
          await this.workspaceEventLiveService.markWatched(
            workspaceId,
            clickHouseTable,
          );

          return true;
        },
        heartbeatIntervalMs: APPLICATION_KEEPALIVE_INTERVAL_MS,
      },
    );
  }

  private async hasCurrentAccess(
    workspaceId: string,
    table: EventLogTable,
    principal: EventLogsLivePrincipal,
  ): Promise<boolean> {
    try {
      await this.eventLogsService.validateAccess(workspaceId, table);

      return await this.permissionsService.userHasWorkspaceSettingPermission({
        workspaceId,
        userWorkspaceId: principal.userWorkspaceId,
        applicationId: principal.applicationId,
        setting: PermissionFlagType.SECURITY,
      });
    } catch {
      return false;
    }
  }

  private async *authorizeDeliveries(
    iterator: AsyncIterableIterator<WorkspaceEventLivePayload>,
    workspaceId: string,
    table: EventLogTable,
    principal: EventLogsLivePrincipal,
  ): AsyncIterableIterator<WorkspaceEventLivePayload> {
    try {
      for await (const payload of iterator) {
        if (!(await this.hasCurrentAccess(workspaceId, table, principal)))
          return;
        if (payload.table !== getClickHouseTableName(table)) continue;

        // Revalidate buffered rows at delivery after any policy/metadata revocation.
        const rows = await this.workspaceEventLiveService.filterPublishableRows(
          workspaceId,
          payload.table,
          payload.rows,
        );

        if (rows.length === 0) continue;
        if (!(await this.hasCurrentAccess(workspaceId, table, principal)))
          return;

        yield { table: payload.table, rows };
      }
    } finally {
      await iterator.return?.();
    }
  }
}
