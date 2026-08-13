import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ObjectRecordCreateEvent,
  ObjectRecordDeleteEvent,
  ObjectRecordDestroyEvent,
  ObjectRecordRestoreEvent,
  ObjectRecordUpdateEvent,
  ObjectRecordUpsertEvent,
} from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';
import { type QueryRunner } from 'typeorm';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import type { FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type CustomEventName } from 'src/engine/workspace-event-emitter/types/custom-event-name.type';
import { CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { computeEventName } from 'src/engine/workspace-event-emitter/utils/compute-event-name';

type ActionEventMap<T> = {
  [DatabaseEventAction.CREATED]: ObjectRecordCreateEvent<T>;
  [DatabaseEventAction.UPDATED]: ObjectRecordUpdateEvent<T>;
  [DatabaseEventAction.DELETED]: ObjectRecordDeleteEvent<T>;
  [DatabaseEventAction.DESTROYED]: ObjectRecordDestroyEvent<T>;
  [DatabaseEventAction.RESTORED]: ObjectRecordRestoreEvent<T>;
  [DatabaseEventAction.UPSERTED]: ObjectRecordUpsertEvent<T>;
};

export type DatabaseBatchEventInput<T, A extends keyof ActionEventMap<T>> = {
  objectMetadataNameSingular: string;
  action: A;
  events: ActionEventMap<T>[A][];
  objectMetadata: FlatObjectMetadata;
  workspaceId: string;
};

type PendingDatabaseBatchEvent = {
  transactionDepth: number;
  emit: () => void;
};

@Injectable()
export class WorkspaceEventEmitter {
  private readonly transactionDepthByQueryRunner = new WeakMap<
    QueryRunner,
    number
  >();
  private readonly pendingDatabaseBatchEvents = new WeakMap<
    QueryRunner,
    PendingDatabaseBatchEvent[]
  >();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  public emitDatabaseBatchEvent<T, A extends keyof ActionEventMap<T>>(
    databaseBatchEventInput: DatabaseBatchEventInput<T, A> | undefined,
    queryRunner?: QueryRunner,
  ) {
    if (
      !isDefined(databaseBatchEventInput) ||
      databaseBatchEventInput.events.length === 0
    ) {
      return;
    }

    if (queryRunner?.isTransactionActive) {
      const pendingEvents =
        this.pendingDatabaseBatchEvents.get(queryRunner) ?? [];

      pendingEvents.push({
        transactionDepth:
          this.transactionDepthByQueryRunner.get(queryRunner) ?? 1,
        emit: () => this.emitDatabaseBatchEventNow(databaseBatchEventInput),
      });
      this.pendingDatabaseBatchEvents.set(queryRunner, pendingEvents);

      return;
    }

    this.emitDatabaseBatchEventNow(databaseBatchEventInput);
  }

  public markTransactionStarted(queryRunner: QueryRunner): void {
    const currentDepth =
      this.transactionDepthByQueryRunner.get(queryRunner) ?? 0;

    this.transactionDepthByQueryRunner.set(queryRunner, currentDepth + 1);
  }

  public flushDatabaseBatchEventsAfterCommit(queryRunner: QueryRunner): void {
    const currentDepth =
      this.transactionDepthByQueryRunner.get(queryRunner) ?? 1;

    if (currentDepth > 1) {
      this.transactionDepthByQueryRunner.set(queryRunner, currentDepth - 1);

      return;
    }

    this.transactionDepthByQueryRunner.delete(queryRunner);
    if (queryRunner.isTransactionActive) {
      return;
    }

    const pendingEvents =
      this.pendingDatabaseBatchEvents.get(queryRunner) ?? [];

    this.pendingDatabaseBatchEvents.delete(queryRunner);

    for (const pendingEvent of pendingEvents) {
      pendingEvent.emit();
    }
  }

  public discardDatabaseBatchEventsAfterRollback(
    queryRunner: QueryRunner,
  ): void {
    const rolledBackTransactionDepth =
      this.transactionDepthByQueryRunner.get(queryRunner) ?? 1;
    const remainingEvents = (
      this.pendingDatabaseBatchEvents.get(queryRunner) ?? []
    ).filter(
      (pendingEvent) =>
        pendingEvent.transactionDepth < rolledBackTransactionDepth,
    );

    if (rolledBackTransactionDepth > 1) {
      this.transactionDepthByQueryRunner.set(
        queryRunner,
        rolledBackTransactionDepth - 1,
      );
    } else {
      this.transactionDepthByQueryRunner.delete(queryRunner);
    }

    if (remainingEvents.length === 0) {
      this.pendingDatabaseBatchEvents.delete(queryRunner);
    } else {
      this.pendingDatabaseBatchEvents.set(queryRunner, remainingEvents);
    }
  }

  public clearPendingDatabaseBatchEvents(queryRunner: QueryRunner): void {
    this.transactionDepthByQueryRunner.delete(queryRunner);
    this.pendingDatabaseBatchEvents.delete(queryRunner);
  }

  public emitCustomBatchEvent<T extends object>(
    eventName: CustomEventName,
    events: T[],
    workspaceId: string | undefined,
  ) {
    if (!events.length) {
      return;
    }

    const customWorkspaceEventBatch: CustomWorkspaceEventBatch<T> = {
      name: eventName,
      workspaceId,
      events,
    };

    this.eventEmitter.emit(eventName, customWorkspaceEventBatch);
  }

  private emitDatabaseBatchEventNow<T, A extends keyof ActionEventMap<T>>(
    databaseBatchEventInput: DatabaseBatchEventInput<T, A>,
  ): void {
    const {
      objectMetadataNameSingular,
      action,
      events,
      objectMetadata,
      workspaceId,
    } = databaseBatchEventInput;
    const eventName = computeEventName(objectMetadataNameSingular, action);
    const workspaceEventBatch: WorkspaceEventBatch<ActionEventMap<T>[A]> = {
      name: eventName,
      workspaceId,
      objectMetadata,
      events,
    };

    this.eventEmitter.emit(eventName, workspaceEventBatch);
  }
}
