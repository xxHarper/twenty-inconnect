import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { EntityEventsToDbListener } from 'src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener';
import { CreateEventLogFromInternalEvent } from 'src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event';
import { UpsertTimelineActivityFromInternalEvent } from 'src/modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job';

const buildHarness = (allowed: boolean) => {
  const auditQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const webhookQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const triggerQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const publisher = {
    isGenericPublicationAllowed: jest.fn().mockResolvedValue(allowed),
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new EntityEventsToDbListener(
    auditQueue as never,
    webhookQueue as never,
    triggerQueue as never,
    publisher as never,
  );
  const batch = {
    name: 'company.updated',
    workspaceId: 'workspace',
    objectMetadata: {
      id: 'object',
      workspaceId: 'workspace',
      nameSingular: 'company',
      universalIdentifier: 'company',
      isAuditLogged: true,
    },
    events: [
      {
        recordId: 'record',
        properties: {
          before: { id: 'record', name: 'private-before' },
          after: { id: 'record', name: 'private-after' },
        },
      },
    ],
  };
  return { listener, publisher, auditQueue, webhookQueue, triggerQueue, batch };
};

describe('EntityEventsToDbListener generic delivery boundary', () => {
  it.each([
    'handleCreate',
    'handleUpdate',
    'handleDelete',
    'handleRestore',
    'handleDestroy',
  ] as const)(
    'suppresses generic and secondary delivery for managed or unclassified objects: %s',
    async (method) => {
      const harness = buildHarness(false);
      await harness.listener[method](harness.batch as never);
      expect(
        harness.publisher.isGenericPublicationAllowed,
      ).toHaveBeenCalledWith(harness.batch);
      expect(harness.publisher.publish).not.toHaveBeenCalled();
      expect(harness.webhookQueue.add).not.toHaveBeenCalled();
      expect(harness.triggerQueue.add).not.toHaveBeenCalled();
      expect(harness.auditQueue.add).toHaveBeenCalledTimes(
        method === 'handleDestroy' ? 0 : 1,
      );
      if (method !== 'handleDestroy')
        expect(harness.auditQueue.add).toHaveBeenCalledWith(
          CreateEventLogFromInternalEvent.name,
          harness.batch,
        );
    },
  );

  it.each([
    'handleCreate',
    'handleUpdate',
    'handleDelete',
    'handleRestore',
    'handleDestroy',
  ] as const)(
    'preserves unmanaged delivery, payloads and audit contracts: %s',
    async (method) => {
      const harness = buildHarness(true);
      await harness.listener[method](harness.batch as never);
      expect(harness.publisher.publish).toHaveBeenCalledWith(harness.batch);
      expect(harness.webhookQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        {
          ...harness.batch,
          objectMetadata: { id: 'object', nameSingular: 'company' },
        },
        { retryLimit: 3 },
      );
      expect(harness.triggerQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        harness.batch,
        { retryLimit: 3 },
      );
      expect(harness.auditQueue.add).toHaveBeenCalledTimes(
        method === 'handleDestroy' ? 0 : 2,
      );
      if (method !== 'handleDestroy')
        expect(harness.auditQueue.add).toHaveBeenCalledWith(
          UpsertTimelineActivityFromInternalEvent.name,
          harness.batch,
        );
    },
  );

  it.each([false, true])(
    'keeps the timeline special route behind the gate: allowed=%s',
    async (allowed) => {
      const harness = buildHarness(allowed);
      harness.batch.objectMetadata.universalIdentifier =
        STANDARD_OBJECTS.timelineActivity.universalIdentifier;
      await harness.listener.handleUpdate(harness.batch as never);
      expect(harness.publisher.publish).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(harness.auditQueue.add).not.toHaveBeenCalled();
      expect(harness.webhookQueue.add).not.toHaveBeenCalled();
      expect(harness.triggerQueue.add).not.toHaveBeenCalled();
    },
  );
});
