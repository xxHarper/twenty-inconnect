import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { CreateEventLogFromInternalEvent } from 'src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event';
import { WorkspaceEventSinkService } from 'src/engine/core-modules/event-logs/ingest/workspace-event-sink.service';
import { EventLogLiveService } from 'src/engine/core-modules/event-logs/live/event-log-live.service';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { WorkflowDatabaseEventTriggerListener } from 'src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener';

const buildHarness = () => {
  const field = (id: string, objectMetadataId: string, name: string) => ({
    id,
    universalIdentifier: id,
    workspaceId: 'workspace',
    objectMetadataId,
    name,
    type: FieldMetadataType.TEXT,
  });
  const fields = [
    field('root-id', 'root', 'id'),
    field('root-label', 'root', 'label'),
    {
      ...field('relation', 'root', 'related'),
      type: FieldMetadataType.RELATION,
      settings: { relationType: RelationType.MANY_TO_ONE },
      relationTargetObjectMetadataId: 'target',
    },
    field('target-id', 'target', 'id'),
    field('target-label', 'target', 'label'),
    field('sensitive', 'target', 'sensitive'),
  ];
  const root = {
    id: 'root',
    universalIdentifier: 'root',
    workspaceId: 'workspace',
    nameSingular: 'root',
    fieldIds: ['root-id', 'root-label', 'relation'],
    isAuditLogged: true,
  };
  const target = {
    id: 'target',
    universalIdentifier: 'target',
    workspaceId: 'workspace',
    nameSingular: 'target',
    fieldIds: ['target-id', 'target-label', 'sensitive'],
  };
  const maps = {
    flatRoleMaps: {},
    flatObjectMetadataMaps: {
      universalIdentifierById: { root: 'root', target: 'target' },
      byUniversalIdentifier: { root, target },
    },
    flatFieldMetadataMaps: {
      universalIdentifierById: Object.fromEntries(
        fields.map((item) => [item.id, item.id]),
      ),
      byUniversalIdentifier: Object.fromEntries(
        fields.map((item) => [item.id, item]),
      ),
    },
  };
  const metadata = { getOrRecompute: jest.fn().mockResolvedValue(maps) };
  const authority = {
    resolveWorkspacePolicy: jest.fn().mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: ['target'],
      rules: [],
    }),
  };
  const authorization = new InconnectRecordAccessAuthorizationService(
    {} as never,
    metadata as never,
    authority as never,
    {} as never,
  );
  const relatedFind = jest
    .fn()
    .mockResolvedValue([
      { id: 'private', label: 'private-label', sensitive: 'protected-value' },
    ]);
  const manager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn(async (_workspace: string, name: string) => {
      if (name === 'target') return { find: relatedFind };
      return {
        find: jest
          .fn()
          .mockResolvedValue([{ workflowId: 'workflow', settings: {} }]),
      };
    }),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const flag = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
  const common = {
    getObjectMetadataInfo: jest.fn().mockResolvedValue({
      ...maps,
      flatObjectMetadata: root,
    }),
  };
  const listener = new WorkflowDatabaseEventTriggerListener(
    manager as never,
    queue as never,
    common as never,
    flag as never,
    metadata as never,
    authorization,
  );
  const subscriptions = { publish: jest.fn().mockResolvedValue(undefined) };
  const presence = { get: jest.fn().mockResolvedValue(true), set: jest.fn() };
  const live = new EventLogLiveService(
    presence as never,
    subscriptions as never,
    authorization,
  );
  const sink = { write: jest.fn().mockResolvedValue(undefined) };
  const ingestion = new WorkspaceEventSinkService([sink], live);
  const audit = new CreateEventLogFromInternalEvent(ingestion);
  const batch = (
    action: string,
    record = { id: 'public', relatedId: 'private' },
  ) => ({
    workspaceId: 'workspace',
    objectMetadata: root,
    name: `root.${action}`,
    events: [
      {
        recordId: 'public',
        properties: {
          ...(action === 'created' || action === 'upserted'
            ? {}
            : { before: { ...record } }),
          ...(action === 'deleted' || action === 'destroyed'
            ? {}
            : { after: { ...record } }),
          ...(action === 'updated' ? { updatedFields: ['relatedId'] } : {}),
        },
      },
    ],
  });
  return {
    fields,
    root,
    target,
    maps,
    metadata,
    authority,
    authorization,
    relatedFind,
    manager,
    queue,
    flag,
    common,
    listener,
    subscriptions,
    presence,
    live,
    sink,
    audit,
    batch,
  };
};

describe('INCONNECT event disclosure alternate paths', () => {
  it.each([
    ['created', 'handleObjectRecordCreateEvent'],
    ['updated', 'handleObjectRecordUpdateEvent'],
    ['deleted', 'handleObjectRecordDeleteEvent'],
    ['destroyed', 'handleObjectRecordDestroyEvent'],
  ] as const)(
    'blocks protected relational workflow enrichment for %s',
    async (action, method) => {
      const harness = buildHarness();
      await harness.listener[method](harness.batch(action) as never);
      expect(harness.queue.add).not.toHaveBeenCalled();
      expect(harness.relatedFind).not.toHaveBeenCalled();
    },
  );

  it.each(['created', 'updated', 'deleted', 'upserted'])(
    'persists complete %s audit but does not broadcast protected relations',
    async (action) => {
      const harness = buildHarness();
      await harness.audit.handle(harness.batch(action) as never);
      expect(harness.sink.write).toHaveBeenCalledTimes(1);
      expect(harness.sink.write.mock.calls[0][0][0].row.properties).toEqual(
        harness.batch(action).events[0].properties,
      );
      expect(harness.subscriptions.publish).not.toHaveBeenCalled();
    },
  );
});

describe('INCONNECT event dependency classification', () => {
  const classify = (
    harness: ReturnType<typeof buildHarness>,
    properties: unknown,
  ) =>
    harness.authorization.isGenericRecordEventPublicationAllowed({
      workspaceId: 'workspace',
      objectMetadataId: 'root',
      eventProperties: [properties],
    });

  it.each([
    { after: { related: { id: 'private', sensitive: 'secret' } } },
    { before: { related: { id: 'private', sensitive: 'secret' } } },
    { diff: { related: { before: { sensitive: 'secret' }, after: null } } },
    { diff: { relatedId: { before: 'private', after: null } } },
  ])(
    'rejects populated relation dependencies anywhere in the payload: %j',
    async (properties) => {
      expect(await classify(buildHarness(), properties)).toBe(false);
    },
  );

  it.each([
    { after: { id: 'public', label: 'safe' } },
    { before: { relatedId: null }, after: { related: null } },
  ])('preserves unrelated unmanaged snapshots: %j', async (properties) => {
    expect(await classify(buildHarness(), properties)).toBe(true);
  });

  it.each([
    'object',
    'field',
    'target',
    'cross-workspace-object',
    'cross-workspace-field',
    'field-parent',
    'unknown-field',
    'unknown-property',
  ])('fails closed on malformed metadata or payload: %s', async (failure) => {
    const harness = buildHarness();
    let properties: unknown = { after: { relatedId: 'private' } };

    if (failure === 'object')
      delete (
        harness.maps.flatObjectMetadataMaps.byUniversalIdentifier as Record<
          string,
          unknown
        >
      ).root;
    if (failure === 'field')
      delete harness.maps.flatFieldMetadataMaps.byUniversalIdentifier.relation;
    if (failure === 'target')
      delete (
        harness.maps.flatObjectMetadataMaps.byUniversalIdentifier as Record<
          string,
          unknown
        >
      ).target;
    if (failure === 'cross-workspace-object')
      harness.target.workspaceId = 'other';
    if (failure === 'cross-workspace-field')
      harness.fields[2].workspaceId = 'other';
    if (failure === 'field-parent')
      harness.fields[2].objectMetadataId = 'target';
    if (failure === 'unknown-field')
      properties = { after: { removedRelation: { sensitive: 'secret' } } };
    if (failure === 'unknown-property')
      properties = { hidden: { sensitive: 'secret' } };
    expect(await classify(harness, properties)).toBe(false);
  });

  it('rejects nested protected relations through an unmanaged intermediate object', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: ['protected'],
      rules: [],
    });
    const relation = {
      id: 'nested',
      universalIdentifier: 'nested',
      workspaceId: 'workspace',
      objectMetadataId: 'target',
      name: 'protected',
      type: FieldMetadataType.RELATION,
      settings: { relationType: RelationType.MANY_TO_ONE },
      relationTargetObjectMetadataId: 'protected',
    };
    harness.target.fieldIds.push('nested');
    harness.maps.flatFieldMetadataMaps.universalIdentifierById.nested =
      'nested';
    harness.maps.flatFieldMetadataMaps.byUniversalIdentifier.nested = relation;
    (
      harness.maps.flatObjectMetadataMaps.universalIdentifierById as Record<
        string,
        string
      >
    ).protected = 'protected';
    (
      harness.maps.flatObjectMetadataMaps.byUniversalIdentifier as Record<
        string,
        unknown
      >
    ).protected = {
      id: 'protected',
      universalIdentifier: 'protected',
      workspaceId: 'workspace',
      fieldIds: [],
    };
    expect(
      await classify(harness, {
        after: { related: { protectedId: 'secret-id' } },
      }),
    ).toBe(false);
  });

  it('preserves batched enrichment of unmanaged targets without per-record queries', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: [],
      rules: [],
    });
    const batch = harness.batch('created');
    batch.events.push(batch.events[0]);
    await harness.listener.handleObjectRecordCreateEvent(batch as never);
    expect(harness.relatedFind).toHaveBeenCalledTimes(1);
    expect(harness.queue.add).toHaveBeenCalledTimes(2);
    expect(
      harness.queue.add.mock.calls[0][1].payload.properties.after.related
        .sensitive,
    ).toBe('protected-value');
    expect(batch.events[0].properties.after).not.toHaveProperty('related');
  });

  it('rechecks authority after listener discovery before enqueue', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: [],
      rules: [],
    });
    harness.flag.isFeatureEnabled.mockImplementation(async () => {
      harness.authority.resolveWorkspacePolicy.mockResolvedValue({
        status: 'configured',
        managedObjectMetadataIds: ['target'],
        rules: [],
      });
      return false;
    });
    await harness.listener.handleObjectRecordCreateEvent(
      harness.batch('created') as never,
    );
    expect(harness.relatedFind).toHaveBeenCalledTimes(1);
    expect(harness.queue.add).not.toHaveBeenCalled();
  });

  it('does not query a target revoked between initial classification and enrichment', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: [],
      rules: [],
    });
    harness.common.getObjectMetadataInfo.mockImplementation(async () => {
      harness.authority.resolveWorkspacePolicy.mockResolvedValue({
        status: 'configured',
        managedObjectMetadataIds: ['target'],
        rules: [],
      });
      return { ...harness.maps, flatObjectMetadata: harness.root };
    });
    await expect(
      harness.listener.handleObjectRecordCreateEvent(
        harness.batch('created') as never,
      ),
    ).rejects.toThrow('not authorized');
    expect(harness.relatedFind).not.toHaveBeenCalled();
    expect(harness.queue.add).not.toHaveBeenCalled();
  });

  it('persists audit even if publication authority fails', async () => {
    const harness = buildHarness();
    harness.metadata.getOrRecompute.mockRejectedValue(new Error('unavailable'));
    await harness.audit.handle(harness.batch('updated') as never);
    expect(harness.sink.write).toHaveBeenCalledTimes(1);
    expect(harness.subscriptions.publish).not.toHaveBeenCalled();
  });

  it('classifies after the presence await and batches rows for the same object', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: [],
      rules: [],
    });
    harness.presence.get.mockImplementation(async () => {
      harness.authority.resolveWorkspacePolicy.mockResolvedValue({
        status: 'configured',
        managedObjectMetadataIds: ['target'],
        rules: [],
      });
      return true;
    });
    const batch = harness.batch('updated');
    batch.events.push(batch.events[0]);
    await harness.audit.handle(batch as never);
    expect(harness.subscriptions.publish).not.toHaveBeenCalled();
    expect(harness.authority.resolveWorkspacePolicy).toHaveBeenCalledTimes(1);
  });

  it('preserves safe live object events and non-object tables in a mixed batch', async () => {
    const harness = buildHarness();
    await harness.audit.handle(
      harness.batch('created', {
        id: 'public',
        relatedId: null,
      } as never) as never,
    );
    expect(harness.subscriptions.publish).toHaveBeenCalledTimes(1);
    harness.subscriptions.publish.mockClear();
    await harness.live.publishWatched([
      {
        table: 'workspaceEvent',
        row: {
          workspaceId: 'workspace',
          properties: {},
          type: 'track',
          event: 'safe',
          timestamp: 'time',
          version: '1',
        },
      },
    ]);
    expect(harness.subscriptions.publish).toHaveBeenCalledTimes(1);
  });
});

describe('Audit history source classification', () => {
  it.each([
    ['not-configured', true],
    ['unmanaged', true],
    ['configured', false],
    ['invalid', false],
    ['unavailable', false],
  ])(
    'classifies %s authority without granting CRM read',
    async (status, allowed) => {
      const harness = buildHarness();
      harness.authority.resolveWorkspacePolicy.mockResolvedValue({
        status,
        managedObjectMetadataIds: ['target'],
        rules: [],
      });
      expect(
        await harness.authorization.isGenericRecordEventHistoryAllowed(
          'workspace',
        ),
      ).toBe(allowed);
    },
  );

  it('denies history when policy retrieval fails', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockRejectedValue(
      new Error('unavailable'),
    );
    expect(
      await harness.authorization.isGenericRecordEventHistoryAllowed(
        'workspace',
      ),
    ).toBe(false);
  });
});

describe('Malformed relation metadata fails closed in unmanaged workspaces', () => {
  it.each([
    'duplicate-id',
    'duplicate-name',
    'join-alias',
    'invalid-foreign-key',
  ])(
    'rejects %s rather than treating protected content as a scalar',
    async (failure) => {
      const harness = buildHarness();
      harness.authority.resolveWorkspacePolicy.mockResolvedValue({
        status: 'configured',
        managedObjectMetadataIds: [],
        rules: [],
      });
      let properties: unknown = { after: { relatedId: 'record' } };

      if (failure === 'duplicate-id') harness.root.fieldIds.push('relation');
      if (failure === 'duplicate-name') harness.fields[1].name = 'related';
      if (failure === 'join-alias') harness.fields[1].name = 'relatedId';
      if (failure === 'invalid-foreign-key')
        properties = { after: { relatedId: { sensitive: 'secret' } } };
      expect(
        await harness.authorization.isGenericRecordEventPublicationAllowed({
          workspaceId: 'workspace',
          objectMetadataId: 'root',
          eventProperties: [properties],
        }),
      ).toBe(false);
    },
  );

  it('rejects enrichment metadata for a different root before querying relations', async () => {
    const harness = buildHarness();
    harness.authority.resolveWorkspacePolicy.mockResolvedValue({
      status: 'configured',
      managedObjectMetadataIds: [],
      rules: [],
    });
    harness.common.getObjectMetadataInfo.mockResolvedValue({
      ...harness.maps,
      flatObjectMetadata: harness.target,
    });
    await expect(
      harness.listener.handleObjectRecordCreateEvent(
        harness.batch('created') as never,
      ),
    ).rejects.toThrow('does not match');
    expect(harness.relatedFind).not.toHaveBeenCalled();
    expect(harness.queue.add).not.toHaveBeenCalled();
  });

  it('filters cross-workspace audit rows on delivery', async () => {
    const harness = buildHarness();
    expect(
      await harness.live.filterPublishableRows('other', 'objectEvent', [
        { workspaceId: 'workspace', objectMetadataId: 'root', properties: {} },
      ]),
    ).toEqual([]);
    expect(harness.metadata.getOrRecompute).not.toHaveBeenCalled();
  });
});

describe('Mixed live audit batches', () => {
  it('preserves a safe row beside a protected relation from the same root object', async () => {
    const harness = buildHarness();
    const rows = await harness.live.filterPublishableRows(
      'workspace',
      'objectEvent',
      [
        {
          workspaceId: 'workspace',
          objectMetadataId: 'root',
          properties: { after: { id: 'safe', label: 'public' } },
        },
        {
          workspaceId: 'workspace',
          objectMetadataId: 'root',
          properties: { after: { relatedId: 'private' } },
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({
      after: { id: 'safe', label: 'public' },
    });
    expect(harness.authority.resolveWorkspacePolicy).toHaveBeenCalledTimes(1);
    expect(harness.metadata.getOrRecompute).toHaveBeenCalledTimes(1);
  });
});
