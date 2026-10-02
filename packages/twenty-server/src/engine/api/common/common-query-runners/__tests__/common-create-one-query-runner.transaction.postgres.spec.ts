import { EventEmitter2 } from '@nestjs/event-emitter';

import { FieldMetadataType, ObjectOpenRecordIn } from 'twenty-shared/types';
import { DataSource, EntitySchema } from 'typeorm';

import { DataArgProcessorService } from 'src/engine/api/common/common-args-processors/data-arg-processor/data-arg-processor.service';
import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import { CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { withWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const USER_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const ROLE_ID = '55555555-5555-4555-8555-555555555555';
const OBJECT_ID = '66666666-6666-4666-8666-666666666666';
const ID_FIELD_ID = '77777777-7777-4777-8777-777777777777';
const NAME_FIELD_ID = '88888888-8888-4888-8888-888888888888';
const HOOK_INJECTED_FIELD_ID = '99999999-9999-4999-8999-999999999999';
const WORKSPACE_SCHEMA = 'workspace_transactional_create';
const OBJECT_NAME = 'transactionalContact';
const TABLE_NAME = '_transactionalContact';

const disposableDatabaseName =
  process.env.TWENTY_TRANSACTIONAL_CREATE_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres = disposableDatabaseName
  ? describe
  : describe.skip;

jest.useRealTimers();
jest.setTimeout(30_000);

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith(
      'twenty_transactional_create_validation_',
    )
  ) {
    throw new Error(
      'A named transactional-create disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

const transactionalContactSchema = new EntitySchema<{
  id: string;
  name: string;
  hookInjected: string;
}>({
  name: OBJECT_NAME,
  tableName: TABLE_NAME,
  schema: WORKSPACE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    hookInjected: { type: String },
  },
});

const buildFlatFieldMetadata = ({
  id,
  name,
  type,
}: {
  id: string;
  name: string;
  type: FieldMetadataType;
}): FlatFieldMetadata =>
  ({
    id,
    universalIdentifier: id,
    workspaceId: WORKSPACE_ID,
    objectMetadataId: OBJECT_ID,
    objectMetadataUniversalIdentifier: OBJECT_ID,
    applicationId: 'transactional-create-test-application',
    applicationUniversalIdentifier: 'transactional-create-test-application',
    name,
    label: name,
    type,
    isNullable: false,
    isSystem: name === 'id',
    isSystemSideEffect: false,
    isActive: true,
    isUnique: name === 'id',
    isUIEditable: name !== 'id',
    isLabelSyncedWithName: false,
    defaultValue: null,
    description: null,
    icon: null,
    options: null,
    settings: null,
    overrides: null,
    universalSettings: null,
    relationTargetFieldMetadataId: null,
    relationTargetObjectMetadataId: null,
    relationTargetFieldMetadataUniversalIdentifier: null,
    relationTargetObjectMetadataUniversalIdentifier: null,
    morphId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    viewFieldIds: [],
    viewFilterIds: [],
    fieldPermissionIds: [],
    kanbanAggregateOperationViewIds: [],
    calendarViewIds: [],
    calendarEndViewIds: [],
    mainGroupByFieldMetadataViewIds: [],
    viewSortIds: [],
    searchFieldMetadataIds: [],
    viewFieldUniversalIdentifiers: [],
    viewFilterUniversalIdentifiers: [],
    fieldPermissionUniversalIdentifiers: [],
    kanbanAggregateOperationViewUniversalIdentifiers: [],
    calendarViewUniversalIdentifiers: [],
    calendarEndViewUniversalIdentifiers: [],
    mainGroupByFieldMetadataViewUniversalIdentifiers: [],
    viewSortUniversalIdentifiers: [],
    searchFieldMetadataUniversalIdentifiers: [],
  }) as FlatFieldMetadata;

const idFieldMetadata = buildFlatFieldMetadata({
  id: ID_FIELD_ID,
  name: 'id',
  type: FieldMetadataType.UUID,
});
const nameFieldMetadata = buildFlatFieldMetadata({
  id: NAME_FIELD_ID,
  name: 'name',
  type: FieldMetadataType.TEXT,
});
const hookInjectedFieldMetadata = buildFlatFieldMetadata({
  id: HOOK_INJECTED_FIELD_ID,
  name: 'hookInjected',
  type: FieldMetadataType.TEXT,
});

const flatObjectMetadata = {
  id: OBJECT_ID,
  universalIdentifier: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  applicationId: 'transactional-create-test-application',
  applicationUniversalIdentifier: 'transactional-create-test-application',
  nameSingular: OBJECT_NAME,
  namePlural: `${OBJECT_NAME}s`,
  labelSingular: 'Transactional contact',
  labelPlural: 'Transactional contacts',
  targetTableName: TABLE_NAME,
  isSystem: false,
  isActive: true,
  isRemote: false,
  isAuditLogged: false,
  isSearchable: false,
  isLabelSyncedWithName: false,
  isUIEditable: true,
  isUICreatable: true,
  openRecordIn: ObjectOpenRecordIn.USER_CHOICE,
  fieldIds: [ID_FIELD_ID, NAME_FIELD_ID, HOOK_INJECTED_FIELD_ID],
  fieldUniversalIdentifiers: [
    ID_FIELD_ID,
    NAME_FIELD_ID,
    HOOK_INJECTED_FIELD_ID,
  ],
  indexMetadataIds: [],
  indexMetadataUniversalIdentifiers: [],
  searchFieldMetadataIds: [],
  searchFieldMetadataUniversalIdentifiers: [],
  objectPermissionIds: [],
  objectPermissionUniversalIdentifiers: [],
  fieldPermissionIds: [],
  fieldPermissionUniversalIdentifiers: [],
  viewIds: [],
  viewUniversalIdentifiers: [],
  color: null,
  icon: null,
  description: null,
  shortcut: null,
  overrides: null,
  duplicateCriteria: null,
  labelIdentifierFieldMetadataId: NAME_FIELD_ID,
  labelIdentifierFieldMetadataUniversalIdentifier: NAME_FIELD_ID,
  imageIdentifierFieldMetadataId: null,
  imageIdentifierFieldMetadataUniversalIdentifier: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
} as FlatObjectMetadata;

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: { [OBJECT_ID]: flatObjectMetadata },
  universalIdentifierById: { [OBJECT_ID]: OBJECT_ID },
  universalIdentifiersByApplicationId: {},
};
const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: {
    [ID_FIELD_ID]: idFieldMetadata,
    [NAME_FIELD_ID]: nameFieldMetadata,
    [HOOK_INJECTED_FIELD_ID]: hookInjectedFieldMetadata,
  },
  universalIdentifierById: {
    [ID_FIELD_ID]: ID_FIELD_ID,
    [NAME_FIELD_ID]: NAME_FIELD_ID,
    [HOOK_INJECTED_FIELD_ID]: HOOK_INJECTED_FIELD_ID,
  },
  universalIdentifiersByApplicationId: {},
};
const emptyFlatEntityMaps = () => ({
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
});

describeWithDisposablePostgres(
  'CommonCreateOneQueryRunner caller-owned PostgreSQL transaction',
  () => {
    let coreDataSource: DataSource;
    let workspaceDataSource: GlobalWorkspaceDataSource;
    let eventEmitter: EventEmitter2;
    let eventEmitterSpy: jest.SpyInstance;
    let createOneRunner: CommonCreateOneQueryRunnerService;
    let createManyRunner: CommonCreateManyQueryRunnerService;
    let queryRunnerContext: CommonBaseQueryRunnerContext;
    let canReadObjectRecords = true;
    let fetchUpsertedRecordsSpy: jest.SpyInstance;
    let processNestedRelationsIfNeededSpy: jest.SpyInstance;
    let processRecordSpy: jest.Mock;
    let executePreQueryHooksSpy: jest.Mock;
    let executePostQueryHooksSpy: jest.Mock;

    const authContext = {
      type: 'user',
      user: { id: USER_ID },
      workspace: { id: WORKSPACE_ID },
      workspaceMemberId: WORKSPACE_MEMBER_ID,
      workspaceMember: {
        id: WORKSPACE_MEMBER_ID,
        name: { firstName: 'Transaction', lastName: 'Tester' },
      },
      userWorkspaceId: USER_WORKSPACE_ID,
    } as unknown as WorkspaceAuthContext;

    const buildObjectPermissions = () => ({
      [OBJECT_ID]: {
        canReadObjectRecords,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: true,
        canDestroyObjectRecords: true,
        restrictedFields: {},
        rowLevelPermissionPredicates: [],
        rowLevelPermissionPredicateGroups: [],
      },
    });

    const buildWorkspaceContext = () => ({
      authContext,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps: emptyFlatEntityMaps(),
      flatRowLevelPermissionPredicateMaps: emptyFlatEntityMaps(),
      flatRowLevelPermissionPredicateGroupMaps: emptyFlatEntityMaps(),
      inconnectRecordAccessPolicy: { status: 'not-configured' },
      inconnectTeamAccessMaps: {
        version: 1,
        status: 'valid',
        membershipByWorkspaceMemberId: {},
        memberWorkspaceMemberIdsByTeamId: {},
        assignableMemberWorkspaceMemberIdsByTeamId: {},
      },
      objectIdByNameSingular: { [OBJECT_NAME]: OBJECT_ID },
      featureFlagsMap: { IS_ORM_V2_READ_PATH_ENABLED: false },
      permissionsPerRoleId: { [ROLE_ID]: buildObjectPermissions() },
      entityMetadatas: workspaceDataSource.entityMetadatas,
      userWorkspaceRoleMap: { [USER_WORKSPACE_ID]: ROLE_ID },
      apiKeyRoleMap: {},
    });

    const runCreate = (
      queryRunner: WorkspaceQueryRunner,
      id: string,
      name: string,
    ) =>
      createOneRunner.executeWithQueryRunner(
        {
          data: { id, name },
          selectedFields: { id: true, name: true },
        },
        queryRunnerContext,
        queryRunner,
      );

    const runReceiptCreate = (
      queryRunner: WorkspaceQueryRunner,
      name: string,
    ) =>
      createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
        {
          data: { name },
        },
        queryRunnerContext,
        queryRunner,
      );

    const getConnectionIdentity = async (queryRunner: WorkspaceQueryRunner) => {
      const [identity] = (await queryRunner.query(
        `SELECT pg_backend_pid() AS "backendPid", txid_current()::text AS "transactionId"`,
      )) as Array<{ backendPid: number; transactionId: string }>;

      return identity;
    };

    beforeAll(async () => {
      const url = getDisposableDatabaseUrl();

      coreDataSource = new DataSource({ type: 'postgres', url });
      await coreDataSource.initialize();

      const [{ currentDatabase }] = await coreDataSource.query<
        Array<{ currentDatabase: string }>
      >('SELECT current_database() AS "currentDatabase"');

      expect(currentDatabase).toBe(disposableDatabaseName);
      expect(currentDatabase).not.toBe('default');

      await coreDataSource.query(`CREATE SCHEMA "${WORKSPACE_SCHEMA}"`);
      await coreDataSource.query('CREATE SCHEMA "core"');
      await coreDataSource.query(`
        CREATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "name" text NOT NULL,
          "hookInjected" text NOT NULL,
          "status" text NOT NULL DEFAULT 'NEW',
          "position" bigint NOT NULL DEFAULT 0,
          "createdAt" timestamptz NOT NULL DEFAULT now()
        )
      `);
      await coreDataSource.query(`
        CREATE TABLE "core"."transactionalCreateProbe" (
          "id" uuid PRIMARY KEY,
          "label" text NOT NULL
        )
      `);

      eventEmitter = new EventEmitter2();
      eventEmitterSpy = jest.spyOn(eventEmitter, 'emit');
      workspaceDataSource = new GlobalWorkspaceDataSource(
        {
          type: 'postgres',
          url,
          entities: [transactionalContactSchema],
        },
        new WorkspaceEventEmitter(eventEmitter),
        coreDataSource,
      );
      await workspaceDataSource.initialize();

      const recordPositionService = {
        overridePositionOnRecords: jest
          .fn()
          .mockImplementation(({ partialRecordInputs }) =>
            Promise.resolve(partialRecordInputs),
          ),
      } as unknown as RecordPositionService;
      const dataArgProcessor = new DataArgProcessorService(
        recordPositionService,
      );
      createManyRunner = new CommonCreateManyQueryRunnerService(
        recordPositionService,
      );
      const globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(workspaceDataSource),
        executeInWorkspaceContext: jest
          .fn()
          .mockImplementation((callback) =>
            withWorkspaceContext(buildWorkspaceContext() as never, callback),
          ),
      };
      executePreQueryHooksSpy = jest
        .fn()
        .mockImplementation((_auth, _object, _operation, args) => ({
          ...args,
          data: {
            ...args.data,
            hookInjected: 'HOOKED',
          },
        }));
      executePostQueryHooksSpy = jest.fn();
      const workspaceQueryHookService = {
        executePreQueryHooks: executePreQueryHooksSpy,
        executePostQueryHooks: executePostQueryHooksSpy,
      };

      fetchUpsertedRecordsSpy = jest.spyOn(
        createManyRunner as unknown as {
          fetchUpsertedRecords: (...parameters: unknown[]) => Promise<unknown>;
        },
        'fetchUpsertedRecords',
      );
      processNestedRelationsIfNeededSpy = jest.spyOn(
        createManyRunner as unknown as {
          processNestedRelationsIfNeeded: (
            ...parameters: unknown[]
          ) => Promise<unknown>;
        },
        'processNestedRelationsIfNeeded',
      );

      Object.assign(createManyRunner, {
        processNestedRelationsHelper: {
          processNestedRelations: jest.fn(),
        },
      });

      createOneRunner = new CommonCreateOneQueryRunnerService(createManyRunner);
      processRecordSpy = jest.fn().mockImplementation((record) => record);
      Object.assign(createOneRunner, {
        dataArgProcessor,
        workspaceQueryHookService,
        globalWorkspaceOrmManager,
        commonResultGettersService: {
          processRecord: processRecordSpy,
        },
        throttlerService: {
          tokenBucketThrottleOrThrow: jest.fn(),
        },
        twentyConfigService: {
          get: jest.fn((key: string) =>
            key === 'COMMON_QUERY_COMPLEXITY_LIMIT' ? 100 : 1,
          ),
        },
        metricsService: { incrementCounterForEvent: jest.fn() },
        permissionsService: { userHasWorkspaceSettingPermission: jest.fn() },
        featureFlagService: {},
        workspaceDataSourceV2Service: {},
      });

      queryRunnerContext = {
        authContext,
        flatObjectMetadata,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        flatIndexMaps: emptyFlatEntityMaps(),
        objectIdByNameSingular: { [OBJECT_NAME]: OBJECT_ID },
        rolePermissionConfig: { unionOf: [ROLE_ID] },
      };
    });

    beforeEach(async () => {
      canReadObjectRecords = true;
      eventEmitterSpy.mockClear();
      fetchUpsertedRecordsSpy.mockClear();
      processNestedRelationsIfNeededSpy.mockClear();
      processRecordSpy.mockClear();
      executePreQueryHooksSpy.mockClear();
      executePostQueryHooksSpy.mockClear();
      await coreDataSource.query(
        `TRUNCATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}", "core"."transactionalCreateProbe"`,
      );
    });

    afterAll(async () => {
      if (workspaceDataSource.isInitialized) {
        await workspaceDataSource.destroy();
      }
      if (coreDataSource.isInitialized) {
        await coreDataSource.destroy();
      }
    });

    it('rolls back workspace create and core SQL on the same connection without publishing events', async () => {
      const recordId = '99999999-9999-4999-8999-999999999999';
      const probeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const createQueryRunnerSpy = jest.spyOn(
        workspaceDataSource,
        'createQueryRunner',
      );

      createQueryRunnerSpy.mockClear();
      const startSpy = jest.spyOn(queryRunner, 'startTransaction');
      const commitSpy = jest.spyOn(queryRunner, 'commitTransaction');
      const rollbackSpy = jest.spyOn(queryRunner, 'rollbackTransaction');
      const releaseSpy = jest.spyOn(queryRunner, 'release');
      const identityBefore = await getConnectionIdentity(queryRunner);

      const { results } = await runCreate(
        queryRunner,
        recordId,
        'Rollback contact',
      );
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'rollback'],
      );
      const identityAfter = await getConnectionIdentity(queryRunner);

      expect(results).toMatchObject({ id: recordId, name: 'Rollback contact' });
      expect(identityAfter).toEqual(identityBefore);
      expect(createQueryRunnerSpy).not.toHaveBeenCalled();
      expect(startSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(releaseSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();
      expect(fetchUpsertedRecordsSpy).toHaveBeenCalledTimes(1);
      expect(processNestedRelationsIfNeededSpy).toHaveBeenCalledTimes(1);

      const [insideWorkspaceCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      )) as Array<{ count: string }>;
      const [insideCoreCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      )) as Array<{ count: string }>;
      const [outsideWorkspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [outsideCoreCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(insideWorkspaceCount.count).toBe('1');
      expect(insideCoreCount.count).toBe('1');
      expect(outsideWorkspaceCount.count).toBe('0');
      expect(outsideCoreCount.count).toBe('0');

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('0');
      expect(coreCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('commits workspace create and core SQL atomically and publishes buffered events after commit', async () => {
      const recordId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const probeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const createQueryRunnerSpy = jest.spyOn(
        workspaceDataSource,
        'createQueryRunner',
      );

      createQueryRunnerSpy.mockClear();
      const identityBefore = await getConnectionIdentity(queryRunner);

      await runCreate(queryRunner, recordId, 'Commit contact');
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'commit'],
      );
      const identityAfter = await getConnectionIdentity(queryRunner);

      expect(identityAfter).toEqual(identityBefore);
      expect(createQueryRunnerSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.commitTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('1');
      expect(coreCount.count).toBe('1');
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
    });

    it('commits a generated-ID write receipt without ordinary result refetch or read permission', async () => {
      canReadObjectRecords = false;
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const receipt = await runReceiptCreate(
        queryRunner,
        'Generated receipt contact',
      );

      expect(receipt).toEqual({
        objectMetadataId: OBJECT_ID,
        recordId: expect.any(String),
      });
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(fetchUpsertedRecordsSpy).not.toHaveBeenCalled();
      expect(processNestedRelationsIfNeededSpy).not.toHaveBeenCalled();
      expect(processRecordSpy).toHaveBeenCalledWith(
        { id: receipt.recordId },
        flatObjectMetadata,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        WORKSPACE_ID,
      );
      expect(executePreQueryHooksSpy).toHaveBeenCalledTimes(1);
      expect(executePostQueryHooksSpy).toHaveBeenCalledTimes(1);
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      const [insideRecord] = (await queryRunner.query(
        `SELECT "id", "name", "hookInjected", "status", "position"::text AS "position", "createdAt" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      )) as Array<{
        id: string;
        name: string;
        hookInjected: string;
        status: string;
        position: string;
        createdAt: Date;
      }>;

      expect(insideRecord).toMatchObject({
        id: receipt.recordId,
        name: 'Generated receipt contact',
        hookInjected: 'HOOKED',
        status: 'NEW',
        position: '0',
      });
      expect(insideRecord.createdAt).toBeInstanceOf(Date);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      const [persistedRecord] = await coreDataSource.query<
        Array<{ id: string }>
      >(
        `SELECT "id" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      );

      expect(persistedRecord.id).toBe(receipt.recordId);
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
    });

    it('rolls back a generated-ID write receipt and discards its buffered events', async () => {
      canReadObjectRecords = false;
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const receipt = await runReceiptCreate(
        queryRunner,
        'Rolled back receipt contact',
      );
      const [insideRecordCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      )) as Array<{ count: string }>;

      expect(insideRecordCount.count).toBe('1');
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [persistedRecordCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      );

      expect(persistedRecordCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('rejects upsert and multi-record receipt attempts', async () => {
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      await expect(
        createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
          {
            data: { name: 'Upsert receipt' },
            upsert: true,
          },
          queryRunnerContext,
          queryRunner,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
          {
            data: [{ name: 'First receipt' }, { name: 'Second receipt' }],
          } as unknown as Parameters<
            CommonCreateOneQueryRunnerService['executeCreateOnlyForWriteReceiptWithQueryRunner']
          >[0],
          queryRunnerContext,
          queryRunner,
        ),
      ).rejects.toBeInstanceOf(Error);

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      expect(fetchUpsertedRecordsSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('propagates create failure so the caller can roll back every prior write', async () => {
      const recordId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const probeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'error'],
      );
      await runCreate(queryRunner, recordId, 'First create');

      await expect(
        runCreate(queryRunner, recordId, 'Duplicate create'),
      ).rejects.toBeDefined();
      expect(queryRunner.isTransactionActive).toBe(true);
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('0');
      expect(coreCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });
  },
);
