import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { type WorkspaceEventEnvelope } from 'src/engine/core-modules/event-logs/types/workspace-event-envelope.type';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { EVENT_LOG_LIVE_TTL_MS } from 'src/engine/core-modules/event-logs/live/event-log-live-ttl.constant';
import { SubscriptionChannel } from 'src/engine/subscriptions/enums/subscription-channel.enum';
import { SubscriptionService } from 'src/engine/subscriptions/subscription.service';

type WatchedGroup = {
  workspaceId: string;
  table: string;
  rows: Record<string, unknown>[];
};

@Injectable()
export class EventLogLiveService {
  private readonly logger = new Logger(EventLogLiveService.name);

  constructor(
    @InjectCacheStorage(CacheStorageNamespace.EngineSubscriptions)
    private readonly cacheStorageService: CacheStorageService,
    private readonly subscriptionService: SubscriptionService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
  ) {}

  private getPresenceKey(workspaceId: string, key: string): string {
    return `workspaceEventLive:${workspaceId}:${key}`;
  }

  async markWatched(workspaceId: string, key: string): Promise<void> {
    await this.cacheStorageService.set<boolean>(
      this.getPresenceKey(workspaceId, key),
      true,
      EVENT_LOG_LIVE_TTL_MS,
    );
  }

  async isWatched(workspaceId: string, key: string): Promise<boolean> {
    const value = await this.cacheStorageService.get<boolean>(
      this.getPresenceKey(workspaceId, key),
    );

    return isDefined(value);
  }

  async filterPublishableRows(
    workspaceId: string,
    table: string,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const workspaceRows = rows.filter((row) => row.workspaceId === workspaceId);

    if (table !== 'objectEvent') return workspaceRows;

    const byObjectId = new Map<string, Record<string, unknown>[]>();

    for (const row of workspaceRows) {
      if (typeof row.objectMetadataId !== 'string') continue;
      const group = byObjectId.get(row.objectMetadataId) ?? [];

      group.push(row);
      byObjectId.set(row.objectMetadataId, group);
    }

    const allowedRows: Record<string, unknown>[] = [];

    for (const [objectMetadataId, group] of byObjectId) {
      try {
        // SECURITY is not a CRM READ grant. Resolve authority once per object/batch.
        const decisions =
          await this.recordAccessAuthorizationService.getGenericRecordEventPublicationDecisions(
            {
              workspaceId,
              objectMetadataId,
              eventPropertiesGroups: group.map((row) => [row.properties]),
            },
          );

        allowedRows.push(
          ...group.filter((_row, index) => decisions[index] === true),
        );
      } catch {
        // Persistence is independent of distribution authority failures.
      }
    }

    return allowedRows;
  }

  async publishWatched(events: WorkspaceEventEnvelope[]): Promise<void> {
    const groups = new Map<string, WatchedGroup>();

    for (const event of events) {
      const workspaceId = event.row.workspaceId;

      if (!isDefined(workspaceId)) {
        continue;
      }

      const key = `${workspaceId}:${event.table}`;
      const group = groups.get(key) ?? {
        workspaceId,
        table: event.table,
        rows: [],
      };

      group.rows.push(event.row);
      groups.set(key, group);
    }

    const results = await Promise.allSettled(
      [...groups.values()].map(async ({ workspaceId, table, rows }) => {
        if (!(await this.isWatched(workspaceId, table))) {
          return;
        }

        // Presence lookup is not authorization; classify after the await.
        const publishableRows = await this.filterPublishableRows(
          workspaceId,
          table,
          rows,
        );

        if (publishableRows.length === 0) return;

        await this.subscriptionService.publish({
          channel: SubscriptionChannel.WORKSPACE_EVENTS_CHANNEL,
          workspaceId,
          payload: { table, rows: publishableRows },
        });
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          'Failed to publish live workspace events',
          result.reason,
        );
      }
    }
  }
}
