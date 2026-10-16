import { type EventEmitter2 } from '@nestjs/event-emitter';

import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  type CommonExtendedInput,
  type CreateManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';

import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  FieldMetadataType,
  RelationType,
  type ObjectsPermissions,
} from 'twenty-shared/types';
import {
  DataSource,
  EntitySchema,
  UpdateQueryBuilder,
  type ObjectLiteral,
  type QueryRunner,
} from 'typeorm';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type SyncableFlatEntity } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-from.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';
import { WorkspaceUpdateQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-update-query-builder';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

// Existing Enterprise hooks are inert boundaries; INCONNECT uses only OSS authorization.
jest.mock(
  'src/engine/twenty-orm/utils/apply-row-level-permission-predicates.util',
  () => ({ applyRowLevelPermissionPredicates: jest.fn() }),
);
jest.mock(
  'src/engine/twenty-orm/utils/validate-rls-predicates-for-records.util',
  () => ({ validateRLSPredicatesForRecords: jest.fn() }),
);

const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RECORD_ID = '22222222-2222-4222-8222-222222222222';
const OLD_OWNER_ID = '33333333-3333-4333-8333-333333333333';
const NEW_OWNER_ID = '44444444-4444-4444-8444-444444444444';
const before = {
  id: RECORD_ID,
  ownerId: OLD_OWNER_ID,
  name: 'Original',
  deletedAt: null,
};
const after = {
  ...before,
  ownerId: NEW_OWNER_ID,
  name: 'Persisted by database',
};

const fields = [
  { id: 'id-field', name: 'id', type: FieldMetadataType.UUID },
  { id: 'name-field', name: 'name', type: FieldMetadataType.TEXT },
  {
    id: 'deleted-at-field',
    name: 'deletedAt',
    type: FieldMetadataType.DATE_TIME,
  },
  {
    id: 'created-by-field',
    name: 'createdBy',
    type: FieldMetadataType.ACTOR,
    isSystem: true,
  },
  {
    id: 'owner-field',
    name: 'owner',
    type: FieldMetadataType.RELATION,
    relationTargetObjectMetadataId: 'member-object',
    settings: {
      relationType: RelationType.MANY_TO_ONE,
      joinColumnName: 'ownerId',
    },
  },
].map((field) => ({
  ...field,
  universalIdentifier: field.id,
  objectMetadataId: 'lead-object',
})) as unknown as FlatFieldMetadata[];
const objectMetadata = {
  id: 'lead-object',
  universalIdentifier: 'lead-object',
  nameSingular: 'lead',
  indexMetadataIds: [],
  fieldIds: fields.map((field) => field.id),
} as unknown as FlatObjectMetadata;
const memberMetadata = {
  id: 'member-object',
  universalIdentifier: 'member-object',
  fieldIds: [],
} as unknown as FlatObjectMetadata;
const toMaps = <TEntity extends SyncableFlatEntity>(
  entities: TEntity[],
): FlatEntityMaps<TEntity> => ({
  byUniversalIdentifier: Object.fromEntries(
    entities.map((entity) => [entity.universalIdentifier, entity]),
  ),
  universalIdentifierById: Object.fromEntries(
    entities.map((entity) => [entity.id, entity.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
});

// Only build in-memory metadata. No initialize(), connection, query or infrastructure.
const connection = new DataSource({
  type: 'postgres',
  entities: [
    new EntitySchema({
      name: 'lead',
      tableName: '_lead',
      columns: {
        id: { type: 'uuid', primary: true },
        ownerId: { type: 'uuid' },
        name: { type: String },
        deletedAt: { type: 'timestamptz', nullable: true, deleteDate: true },
      },
    }),
  ],
});

const makeReturningRow = (
  builder: UpdateQueryBuilder<ObjectLiteral>,
  record = after,
): ObjectLiteral => {
  const returning = builder.getQuery().split(' RETURNING ')[1] ?? '';
  const row: ObjectLiteral = {};
  if (Array.isArray(returning)) {
    for (const property of returning)
      row[property] = record[property as keyof typeof record];
  } else {
    if (returning.startsWith('*')) Object.assign(row, record);
    if (returning.startsWith('"id",') || returning === '"id"')
      row.id = record.id;
    for (const match of returning.matchAll(
      /"(id|ownerId|name|deletedAt)" AS "([^"]+)"/g,
    ))
      row[match[2]] = record[match[1] as keyof typeof record];
  }
  return row;
};

const buildHarness = (
  ownerTransferPolicy:
    | 'standardPermissionsOnly'
    | 'denied'
    | 'assignableOwners' = 'standardPermissionsOnly',
) => {
  const publish = jest.fn();
  const eventEmitterService = new WorkspaceEventEmitter({
    emit: publish,
  } as unknown as EventEmitter2);
  const runnerState = { isTransactionActive: true };
  const queryRunner = runnerState as QueryRunner;
  eventEmitterService.markTransactionStarted(queryRunner);
  const permissions: ObjectsPermissions = {
    [objectMetadata.id]: {
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
      restrictedFields: {},
      rowLevelPermissionPredicates: [],
      rowLevelPermissionPredicateGroups: [],
    },
  };
  const internalContext = {
    coreDataSource: connection,
    workspaceId: 'workspace',
    objectIdByNameSingular: { lead: objectMetadata.id },
    flatObjectMetadataMaps: toMaps([objectMetadata, memberMetadata]),
    flatFieldMetadataMaps: toMaps(fields),
    eventEmitterService,
    userWorkspaceRoleMap: { actor: 'role' },
    apiKeyRoleMap: {},
    inconnectRecordAccessPolicy: {
      status: 'configured',
      managedObjectMetadataIds: [objectMetadata.id],
      rules: [
        {
          roleId: 'role',
          objectMetadataId: objectMetadata.id,
          ownerFieldMetadataId: 'owner-field',
          ownerFieldName: 'owner',
          ownerJoinColumnName: 'ownerId',
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy,
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    },
  } as unknown as WorkspaceInternalContext;
  const builder = new WorkspaceUpdateQueryBuilder(
    connection
      .createQueryBuilder()
      .update('lead')
      .set({ ownerId: NEW_OWNER_ID })
      .where('"lead"."ownerId" = :oldOwner', { oldOwner: OLD_OWNER_ID })
      .returning(['id'])
      .setQueryRunner(queryRunner),
    permissions,
    internalContext,
    false,
    {
      type: 'user',
      workspace: { id: 'workspace' },
      userWorkspaceId: 'actor',
      workspaceMemberId: OLD_OWNER_ID,
    } as WorkspaceAuthContext,
    {} as FeatureFlagMap,
  );
  const select = jest
    .spyOn(WorkspaceSelectQueryBuilder.prototype, 'getMany')
    .mockResolvedValueOnce([before])
    .mockResolvedValue([]);
  const mutation = jest
    .spyOn(UpdateQueryBuilder.prototype, 'execute')
    .mockImplementation(
      async function (this: UpdateQueryBuilder<ObjectLiteral>) {
        return {
          raw: [makeReturningRow(this)],
          generatedMaps: [],
          affected: 1,
        };
      },
    );
  const commit = () => {
    runnerState.isTransactionActive = false;
    eventEmitterService.flushDatabaseBatchEventsAfterCommit(queryRunner);
  };
  return {
    builder,
    select,
    mutation,
    publish,
    commit,
    queryRunner,
    eventEmitterService,
    permissions,
    internalContext,
  };
};

beforeAll(async () => {
  await (
    connection as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});
afterEach(() => jest.restoreAllMocks());

describe('WorkspaceUpdateQueryBuilder transfer events', () => {
  it('should emit complete before/after once per action when the old Owner filter stops matching and the actor loses access', async () => {
    const harness = buildHarness();
    const result = await harness.builder.execute();
    expect(result).toEqual({
      raw: [{ id: RECORD_ID }],
      generatedMaps: [{ id: RECORD_ID }],
      affected: 1,
    });
    expect(harness.publish).not.toHaveBeenCalled();
    harness.commit();
    expect(harness.publish.mock.calls.map(([name]) => name)).toEqual([
      'lead.updated',
      'lead.upserted',
    ]);
    for (const [, batch] of harness.publish.mock.calls) {
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0]).toMatchObject({
        recordId: RECORD_ID,
        properties: { before, after },
      });
    }
    expect(harness.select).toHaveBeenCalledTimes(1);
    expect(harness.builder.expressionMap.returning).toEqual(['id']);
  });

  it('should bound snapshot materialization before rejecting an oversized update', async () => {
    const harness = buildHarness();
    harness.select
      .mockReset()
      .mockResolvedValue(
        Array.from({ length: QUERY_MAX_RECORDS + 1 }, () => before),
      );
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'TOO_MANY_RECORDS_TO_UPDATE',
    });
    expect(harness.select.mock.contexts[0].expressionMap.take).toBe(
      QUERY_MAX_RECORDS + 1,
    );
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it('should retain the old Owner and SQL scope while bounding mutation to captured identities', async () => {
    const harness = buildHarness();
    await harness.builder.execute();
    const sql = harness.builder.getQuery();
    expect(sql).toContain('"ownerId" = :oldOwner');
    expect(sql).toContain('inconnectRecordAccessOwnerIds_owner_field');
    expect(Object.values(harness.builder.getParameters()).flat()).toContain(
      RECORD_ID,
    );
  });

  it('should avoid events for rows not affected by the authorized UPDATE', async () => {
    const harness = buildHarness();
    harness.mutation.mockResolvedValue({
      raw: [],
      generatedMaps: [],
      affected: 0,
    });
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: 0,
    });
    harness.commit();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it('should reject excessive executeMany inputs before reading or mutating', async () => {
    const harness = buildHarness();
    harness.builder.setManyInputs(
      Array.from({ length: QUERY_MAX_RECORDS + 1 }, () => ({
        criteria: RECORD_ID,
        partialEntity: { ownerId: NEW_OWNER_ID },
      })),
    );
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'TOO_MANY_RECORDS_TO_UPDATE',
    });
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it('should reject duplicate executeMany identities without duplicate writes or events', async () => {
    const harness = buildHarness();
    harness.builder.setManyInputs(
      [NEW_OWNER_ID, OLD_OWNER_ID].map((ownerId) => ({
        criteria: RECORD_ID,
        partialEntity: { ownerId },
      })),
    );
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
  });
  it('should correlate an uppercase UUID with its canonical database snapshot', async () => {
    const harness = buildHarness();
    const recordId = 'abcdefab-1234-4567-89ab-abcdefabcdef';
    harness.select.mockReset().mockResolvedValue([{ ...before, id: recordId }]);
    harness.mutation.mockImplementation(
      async function (this: UpdateQueryBuilder<ObjectLiteral>) {
        return {
          raw: [makeReturningRow(this, { ...after, id: recordId })],
          generatedMaps: [],
          affected: 1,
        };
      },
    );
    harness.builder.setManyInputs([
      {
        criteria: recordId.toUpperCase(),
        partialEntity: { ownerId: NEW_OWNER_ID },
      },
    ]);
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: 1,
      generatedMaps: [{ id: recordId }],
    });
    harness.commit();
    expect(harness.mutation).toHaveBeenCalledTimes(1);
    expect(harness.publish).toHaveBeenCalledTimes(2);
    expect(harness.builder.getParameters()).toEqual(
      expect.objectContaining({ orm_param_0: recordId }),
    );
  });

  it('should reject duplicate UUIDs with different case before reading or writing', async () => {
    const harness = buildHarness();
    const recordId = 'abcdefab-1234-4567-89ab-abcdefabcdef';
    harness.builder.setManyInputs(
      [recordId, recordId.toUpperCase()].map((criteria) => ({
        criteria,
        partialEntity: { ownerId: NEW_OWNER_ID },
      })),
    );
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'should capture a complete private BEFORE despite an inherited id + owner projection (many=%s)',
    async (many) => {
      const harness = buildHarness();
      const alias = harness.builder.expressionMap.mainAlias!.name;
      harness.builder.expressionMap.selects = [
        { selection: `${alias}.id` },
        { selection: `${alias}.ownerId` },
      ];
      const publicSelects = [...harness.builder.expressionMap.selects];
      harness.select
        .mockReset()
        .mockImplementation(
          async function (this: WorkspaceSelectQueryBuilder<ObjectLiteral>) {
            const selections = this.expressionMap.selects.map(
              (selection) => selection.selection,
            );
            return selections.includes(alias) ||
              selections.includes(`${alias}.name`)
              ? [before]
              : [{ id: RECORD_ID, ownerId: OLD_OWNER_ID }];
          },
        );
      harness.mutation.mockImplementation(
        async function (this: UpdateQueryBuilder<ObjectLiteral>) {
          return {
            raw: [makeReturningRow(this, { ...before, ownerId: NEW_OWNER_ID })],
            generatedMaps: [],
            affected: 1,
          };
        },
      );
      if (many)
        harness.builder.setManyInputs([
          { criteria: RECORD_ID, partialEntity: { ownerId: NEW_OWNER_ID } },
        ]);
      await expect(harness.builder.execute()).resolves.toMatchObject({
        raw: [{ id: RECORD_ID }],
        generatedMaps: [{ id: RECORD_ID }],
      });
      harness.commit();
      expect(harness.builder.expressionMap.selects).toEqual(publicSelects);
      expect(harness.select).toHaveBeenCalledTimes(1);
      const updated = harness.publish.mock.calls.find(
        ([name]) => name === 'lead.updated',
      )![1].events[0].properties;
      expect(updated.updatedFields).not.toContain('name');
      expect(updated.diff).not.toHaveProperty('name');
      expect(updated.before).toEqual(before);
      expect(updated.after).toEqual({ ...before, ownerId: NEW_OWNER_ID });
      const upserted = harness.publish.mock.calls.find(
        ([name]) => name === 'lead.upserted',
      )![1].events[0].properties;
      expect(upserted.after).toEqual(updated.after);
    },
  );

  it.each([
    'invalid',
    '',
    ' 11111111-1111-4111-8111-111111111111',
    '11111111111141118111111111111111',
  ])('should reject malformed identity %s before reading', async (criteria) => {
    const harness = buildHarness();
    harness.builder.setManyInputs([
      { criteria, partialEntity: { ownerId: NEW_OWNER_ID } },
    ]);
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    'abcdefab-1234-7567-89ab-abcdefabcdef',
  ])(
    'should preserve canonical PostgreSQL UUID identities without imposing a version restriction: %s',
    async (criteria) => {
      const harness = buildHarness();
      harness.select
        .mockReset()
        .mockResolvedValue([{ ...before, id: criteria }]);
      harness.mutation.mockImplementation(
        async function (this: UpdateQueryBuilder<ObjectLiteral>) {
          return {
            raw: [makeReturningRow(this, { ...after, id: criteria })],
            generatedMaps: [],
            affected: 1,
          };
        },
      );
      harness.builder.setManyInputs([
        { criteria, partialEntity: { ownerId: NEW_OWNER_ID } },
      ]);
      await expect(harness.builder.execute()).resolves.toMatchObject({
        affected: 1,
        generatedMaps: [{ id: criteria }],
      });
    },
  );

  it.each([false, true])(
    'should retain the common upsert update consumer contract (duplicate=%s)',
    async (duplicate) => {
      const harness = buildHarness();
      const selectQuery = {
        orWhere: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        setFindOptions: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValueOnce([before])
          .mockResolvedValue([{ id: RECORD_ID }]),
      };
      const repository = {
        createQueryBuilder: jest.fn(() => selectQuery),
        updateMany: jest.fn((inputs, _permissions, columns) =>
          harness.builder.setManyInputs(inputs).returning(columns).execute(),
        ),
        insert: jest.fn(),
        objectRecordsPermissions: harness.permissions,
      };
      const runner = new CommonCreateManyQueryRunnerService(
        {} as RecordPositionService,
      );
      Object.assign(runner, {
        processNestedRelationsHelper: {
          processNestedRelations: jest.fn().mockResolvedValue(undefined),
        },
      });
      const data = [{ id: RECORD_ID, ownerId: NEW_OWNER_ID }];
      const execution = runner.run(
        {
          data: duplicate ? [...data, ...data] : data,
          upsert: true,
          selectedFieldsResult: {
            select: { id: true },
            relations: {},
            relationFieldsCount: 0,
          },
        } as unknown as CommonExtendedInput<CreateManyQueryArgs>,
        {
          repository,
          flatObjectMetadata: objectMetadata,
          flatObjectMetadataMaps:
            harness.internalContext.flatObjectMetadataMaps,
          flatFieldMetadataMaps: harness.internalContext.flatFieldMetadataMaps,
          flatIndexMaps: toMaps([]),
          authContext: { workspace: { id: 'workspace' } },
        } as unknown as CommonExtendedQueryRunnerContext,
      );
      if (duplicate) {
        await expect(execution).rejects.toMatchObject({
          code: 'INVALID_INPUT',
        });
        expect(harness.mutation).not.toHaveBeenCalled();
      } else {
        await expect(execution).resolves.toEqual([{ id: RECORD_ID }]);
        expect(repository.updateMany).toHaveBeenCalledWith(
          [
            {
              criteria: RECORD_ID,
              partialEntity: {
                id: RECORD_ID,
                ownerId: NEW_OWNER_ID,
                deletedAt: null,
              },
            },
          ],
          undefined,
          ['id'],
        );
        harness.commit();
        expect(harness.publish).toHaveBeenCalledTimes(2);
      }
      expect(repository.insert).not.toHaveBeenCalled();
    },
  );

  it('should derive executeMany events from the mutation when the actor loses access', async () => {
    const harness = buildHarness();
    harness.builder.setManyInputs([
      { criteria: RECORD_ID, partialEntity: { ownerId: NEW_OWNER_ID } },
    ]);
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: 1,
      raw: [{ id: RECORD_ID }],
    });
    harness.commit();
    expect(harness.select).toHaveBeenCalledTimes(1);
    expect(harness.publish).toHaveBeenCalledTimes(2);
    expect(harness.publish.mock.calls[0][1].events[0].properties).toMatchObject(
      { before, after },
    );
  });

  it('should emit only affected identities in executeMany when another row is no longer in scope', async () => {
    const harness = buildHarness();
    harness.select
      .mockReset()
      .mockResolvedValue([before, { ...before, id: OTHER_RECORD_ID }]);
    harness.builder.setManyInputs(
      [RECORD_ID, OTHER_RECORD_ID].map((criteria) => ({
        criteria,
        partialEntity: { ownerId: NEW_OWNER_ID },
      })),
    );
    harness.mutation.mockResolvedValueOnce({
      raw: [],
      generatedMaps: [],
      affected: 0,
    });
    harness.mutation.mockImplementationOnce(
      async function (this: UpdateQueryBuilder<ObjectLiteral>) {
        return {
          raw: [makeReturningRow(this, { ...after, id: OTHER_RECORD_ID })],
          generatedMaps: [],
          affected: 1,
        };
      },
    );
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: 1,
    });
    harness.commit();
    for (const [, batch] of harness.publish.mock.calls) {
      expect(
        batch.events.map((event: { recordId: string }) => event.recordId),
      ).toEqual([OTHER_RECORD_ID]);
    }
  });

  it('should skip executeMany identities absent from the authorized before snapshot', async () => {
    const harness = buildHarness();
    harness.builder.setManyInputs([
      { criteria: OTHER_RECORD_ID, partialEntity: { ownerId: NEW_OWNER_ID } },
    ]);
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: 0,
      raw: [],
    });
    harness.commit();
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'should discard both actions on caller rollback (executeMany=%s)',
    async (many) => {
      const harness = buildHarness();
      if (many)
        harness.builder.setManyInputs([
          { criteria: RECORD_ID, partialEntity: { ownerId: NEW_OWNER_ID } },
        ]);
      await harness.builder.execute();
      harness.eventEmitterService.discardDatabaseBatchEventsAfterRollback(
        harness.queryRunner,
      );
      harness.commit();
      expect(harness.publish).not.toHaveBeenCalled();
    },
  );

  it('should propagate SQL errors without events and restore the returning projection', async () => {
    const harness = buildHarness();
    harness.mutation.mockRejectedValue(new Error('SQL failed'));
    await expect(harness.builder.execute()).rejects.toThrow('SQL failed');
    expect(harness.builder.expressionMap.returning).toEqual(['id']);
    harness.commit();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it('should leave executeMany rollback to the caller after a later statement fails', async () => {
    const harness = buildHarness();
    harness.select
      .mockReset()
      .mockResolvedValue([before, { ...before, id: OTHER_RECORD_ID }]);
    harness.builder.setManyInputs(
      [RECORD_ID, OTHER_RECORD_ID].map((criteria) => ({
        criteria,
        partialEntity: { ownerId: NEW_OWNER_ID },
      })),
    );
    harness.mutation
      .mockImplementationOnce(
        async function (this: UpdateQueryBuilder<ObjectLiteral>) {
          return {
            raw: [makeReturningRow(this)],
            generatedMaps: [],
            affected: 1,
          };
        },
      )
      .mockRejectedValueOnce(new Error('second SQL failed'));
    await expect(harness.builder.execute()).rejects.toThrow(
      'second SQL failed',
    );
    expect(harness.mutation).toHaveBeenCalledTimes(2);
    expect(harness.builder.expressionMap.returning).toEqual(['id']);
    expect(harness.publish).not.toHaveBeenCalled();
    harness.eventEmitterService.discardDatabaseBatchEventsAfterRollback(
      harness.queryRunner,
    );
  });

  it.each(['object', 'owner-field', 'returned-field'] as const)(
    'should respect standard %s permissions before mutating',
    async (denial) => {
      const harness = buildHarness();
      if (denial === 'object')
        harness.permissions[objectMetadata.id].canUpdateObjectRecords = false;
      if (denial === 'owner-field')
        harness.permissions[objectMetadata.id].restrictedFields = {
          'owner-field': { canUpdate: false },
        };
      if (denial === 'returned-field') {
        harness.permissions[objectMetadata.id].restrictedFields = {
          'name-field': { canRead: false },
        };
        harness.builder.returning(['name']);
      }
      await expect(harness.builder.execute()).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      expect(harness.mutation).not.toHaveBeenCalled();
      harness.commit();
      expect(harness.publish).not.toHaveBeenCalled();
    },
  );

  it.each([null, { id: OLD_OWNER_ID }] as const)(
    'should enforce required Owner and conflicting owner representations (%s)',
    async (owner) => {
      const harness = buildHarness();
      harness.builder.set(
        owner === null ? { ownerId: null } : { ownerId: NEW_OWNER_ID, owner },
      );
      await expect(harness.builder.execute()).rejects.toMatchObject({
        code: 'INCONNECT_RECORD_ACCESS_DENIED',
      });
      expect(harness.mutation).not.toHaveBeenCalled();
    },
  );

  it('should preserve a raw returning expression and keep private snapshots out of caller raw', async () => {
    const harness = buildHarness();
    harness.builder.returning('"id" AS "recordIdentity"');
    await expect(harness.builder.execute()).resolves.toMatchObject({
      raw: [{ recordIdentity: RECORD_ID }],
    });
    expect(harness.builder.expressionMap.returning).toBe(
      '"id" AS "recordIdentity"',
    );
  });

  it('should preserve returning star and the full normalized caller result', async () => {
    const harness = buildHarness();
    harness.builder.returning('*');
    await expect(harness.builder.execute()).resolves.toMatchObject({
      raw: [after],
      generatedMaps: [after],
    });
  });

  it.each([
    'foreign-id',
    'duplicate-id',
    'missing-column',
    'affected-mismatch',
  ] as const)(
    'should fail closed before buffering events for a corrupted %s snapshot',
    async (corruption) => {
      const harness = buildHarness();
      harness.mutation.mockImplementation(
        async function (this: UpdateQueryBuilder<ObjectLiteral>) {
          const row = makeReturningRow(this, {
            ...after,
            id: corruption === 'foreign-id' ? OTHER_RECORD_ID : RECORD_ID,
          });
          if (corruption === 'missing-column')
            delete row.__twenty_update_snapshot_1;
          const raw = corruption === 'duplicate-id' ? [row, row] : [row];
          return {
            raw,
            generatedMaps: [],
            affected: corruption === 'affected-mismatch' ? 0 : raw.length,
          };
        },
      );
      await expect(harness.builder.execute()).rejects.toMatchObject({
        code: 'ORM_EVENT_DATA_CORRUPTED',
      });
      harness.commit();
      expect(harness.publish).not.toHaveBeenCalled();
    },
  );

  it.each(['denied', 'assignableOwners'] as const)(
    'should deny transfers forbidden by the current %s policy',
    async (policy) => {
      const harness = buildHarness(policy);
      await expect(harness.builder.execute()).rejects.toMatchObject({
        code: 'INCONNECT_RECORD_ACCESS_DENIED',
      });
      expect(harness.mutation).not.toHaveBeenCalled();
    },
  );

  it('should deny invalid Record Access authority even when standard UPDATE is allowed', async () => {
    const harness = buildHarness();
    harness.internalContext.inconnectRecordAccessPolicy = {
      status: 'invalid',
      reason: 'unavailable authority',
    };
    await expect(harness.builder.execute()).rejects.toMatchObject({
      code: 'INCONNECT_RECORD_ACCESS_DENIED',
    });
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it('should keep restricted unselected fields internal to the event snapshots', async () => {
    const harness = buildHarness();
    harness.permissions[objectMetadata.id].restrictedFields = {
      'name-field': { canRead: false },
    };
    await expect(harness.builder.execute()).resolves.toMatchObject({
      raw: [{ id: RECORD_ID }],
      generatedMaps: [{ id: RECORD_ID }],
    });
    harness.commit();
    expect(
      harness.publish.mock.calls[0][1].events[0].properties.after.name,
    ).toBe(after.name);
  });

  it('should preserve OR grouping and the original filter for unmanaged objects', async () => {
    const harness = buildHarness();
    harness.internalContext.inconnectRecordAccessPolicy = {
      status: 'unmanaged',
    };
    harness.builder.orWhere('"lead"."name" = :name', { name: 'Original' });
    await harness.builder.execute();
    expect(harness.builder.getQuery()).toMatch(
      /WHERE \("_lead"\."ownerId" = :oldOwner OR "_lead"\."name" = :name\) AND/,
    );
  });

  it('should bound an empty authorized snapshot to no matching mutation identities', async () => {
    const harness = buildHarness();
    harness.select.mockReset().mockResolvedValue([]);
    harness.mutation.mockResolvedValue({
      raw: [],
      generatedMaps: [],
      affected: 0,
    });
    await harness.builder.execute();
    expect(harness.builder.getQuery()).toContain('0=1');
    harness.commit();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it('should accept exactly the maximum records and emit each identity once per action', async () => {
    const harness = buildHarness();
    const records = Array.from({ length: QUERY_MAX_RECORDS }, (_, index) => ({
      ...before,
      id: `record-${index}`,
    }));
    harness.select.mockReset().mockResolvedValue(records);
    harness.mutation.mockImplementation(
      async function (this: UpdateQueryBuilder<ObjectLiteral>) {
        return {
          raw: records.map((record) =>
            makeReturningRow(this, { ...after, id: record.id }),
          ),
          generatedMaps: [],
          affected: records.length,
        };
      },
    );
    await expect(harness.builder.execute()).resolves.toMatchObject({
      affected: QUERY_MAX_RECORDS,
    });
    harness.commit();
    expect(harness.publish).toHaveBeenCalledTimes(2);
    for (const [, batch] of harness.publish.mock.calls) {
      expect(batch.events).toHaveLength(QUERY_MAX_RECORDS);
      expect(
        new Set(
          batch.events.map((event: { recordId: string }) => event.recordId),
        ).size,
      ).toBe(QUERY_MAX_RECORDS);
    }
  });
  it('should emit the canonical Owner diff when only the Owner changes', async () => {
    const harness = buildHarness();
    harness.mutation.mockImplementation(
      async function (this: UpdateQueryBuilder<ObjectLiteral>) {
        return {
          raw: [makeReturningRow(this, { ...after, name: before.name })],
          generatedMaps: [],
          affected: 1,
        };
      },
    );
    await harness.builder.execute();
    harness.commit();
    expect(harness.publish.mock.calls[0][1].events[0].properties.diff).toEqual({
      owner: { before: { id: OLD_OWNER_ID }, after: { id: NEW_OWNER_ID } },
    });
    expect(
      harness.publish.mock.calls[0][1].events[0].properties.updatedFields,
    ).toEqual(['owner', 'ownerId']);
  });

  it('should preserve an empty caller RETURNING while retaining complete event snapshots', async () => {
    const harness = buildHarness();
    harness.builder.returning([]);
    await expect(harness.builder.execute()).resolves.toEqual({
      raw: [],
      generatedMaps: [],
      affected: 1,
    });
    harness.commit();
    expect(harness.publish).toHaveBeenCalledTimes(2);
  });

  it('should run the native TypeORM UPDATE pipeline with only its SQL transport mocked', async () => {
    const harness = buildHarness();
    harness.mutation.mockRestore();
    const query = jest.fn(async (_sql: string) => ({
      records: [makeReturningRow(harness.builder)],
      affected: 1,
    }));
    Object.assign(harness.queryRunner, {
      connection,
      broadcaster: { broadcast: jest.fn().mockResolvedValue(undefined) },
      query,
    });
    await expect(harness.builder.execute()).resolves.toEqual({
      raw: [{ id: RECORD_ID }],
      generatedMaps: [{ id: RECORD_ID }],
      affected: 1,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('RETURNING "id", "_lead"."id" AS');
    harness.commit();
    expect(harness.publish).toHaveBeenCalledTimes(2);
    expect(harness.builder.getQuery()).not.toContain(
      '__twenty_update_snapshot_',
    );
  });
});
