import { EventEmitter2 } from '@nestjs/event-emitter';

import { ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { type QueryRunner } from 'typeorm';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import {
  type DatabaseBatchEventInput,
  WorkspaceEventEmitter,
} from 'src/engine/workspace-event-emitter/workspace-event-emitter';

type TestRecord = { id: string };

const buildInput = (): DatabaseBatchEventInput<
  TestRecord,
  DatabaseEventAction.UPDATED
> => ({
  objectMetadataNameSingular: 'workspaceMember',
  action: DatabaseEventAction.UPDATED,
  events: [
    Object.assign(new ObjectRecordUpdateEvent<TestRecord>(), {
      recordId: 'member-id',
      properties: {
        updatedFields: ['name'],
        diff: {},
        before: { id: 'member-id' },
        after: { id: 'member-id' },
      },
    }),
  ],
  objectMetadata: {} as FlatObjectMetadata,
  workspaceId: 'workspace-id',
});

const buildQueryRunner = () => {
  const state = { isTransactionActive: true };
  const queryRunner = state as unknown as QueryRunner;

  return { queryRunner, state };
};

describe('WorkspaceEventEmitter after-commit queue', () => {
  it('publishes only after the outer transaction commits', () => {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WorkspaceEventEmitter(eventEmitter);
    const { queryRunner, state } = buildQueryRunner();

    service.markTransactionStarted(queryRunner);
    service.emitDatabaseBatchEvent(buildInput(), queryRunner);

    expect(eventEmitter.emit).not.toHaveBeenCalled();

    state.isTransactionActive = false;
    service.flushDatabaseBatchEventsAfterCommit(queryRunner);

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('discards events from a rolled-back transaction depth', () => {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WorkspaceEventEmitter(eventEmitter);
    const { queryRunner, state } = buildQueryRunner();

    service.markTransactionStarted(queryRunner);
    service.emitDatabaseBatchEvent(buildInput(), queryRunner);
    service.discardDatabaseBatchEventsAfterRollback(queryRunner);

    state.isTransactionActive = false;
    service.flushDatabaseBatchEventsAfterCommit(queryRunner);

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('retains outer events when only an inner savepoint rolls back', () => {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WorkspaceEventEmitter(eventEmitter);
    const { queryRunner, state } = buildQueryRunner();

    service.markTransactionStarted(queryRunner);
    service.emitDatabaseBatchEvent(buildInput(), queryRunner);
    service.markTransactionStarted(queryRunner);
    service.emitDatabaseBatchEvent(buildInput(), queryRunner);

    service.discardDatabaseBatchEventsAfterRollback(queryRunner);
    state.isTransactionActive = false;
    service.flushDatabaseBatchEventsAfterCommit(queryRunner);

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });
});
