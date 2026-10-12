import { DataSource, EntitySchema } from 'typeorm';

import { WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { type GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { withWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';

const CORE_SCHEMA = 'core_query_builder_gateway';
const WORKSPACE_SCHEMA = 'workspace_query_builder_gateway';
const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const INSERTED_ID = '33333333-3333-4333-8333-333333333333';
const WORKSPACE_ROW_ID = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';

const disposableDatabaseName =
  process.env.WORKSPACE_QUERY_RUNNER_CORE_QUERY_BUILDER_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres =
  disposableDatabaseName === undefined ? describe.skip : describe;

jest.useRealTimers();
jest.setTimeout(30_000);

type CoreParent = {
  id: string;
  value: string;
  children: CoreChild[];
};

type CoreChild = {
  id: string;
  value: string;
  parentId: string;
  parent: CoreParent;
};

const coreParentSchema = new EntitySchema<CoreParent>({
  name: 'CoreQueryBuilderGatewayParent',
  tableName: 'parent',
  schema: CORE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true },
    value: { type: String },
  },
  relations: {
    children: {
      type: 'one-to-many',
      target: 'CoreQueryBuilderGatewayChild',
      inverseSide: 'parent',
    },
  },
});

const coreChildSchema = new EntitySchema<CoreChild>({
  name: 'CoreQueryBuilderGatewayChild',
  tableName: 'child',
  schema: CORE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true },
    value: { type: String },
    parentId: { type: 'uuid' },
  },
  relations: {
    parent: {
      type: 'many-to-one',
      target: 'CoreQueryBuilderGatewayParent',
      inverseSide: 'children',
      joinColumn: { name: 'parentId' },
    },
  },
});

const workspaceFixtureSchema = new EntitySchema<{
  id: string;
  value: string;
}>({
  name: 'coreGatewayWorkspaceFixture',
  tableName: 'fixture',
  schema: WORKSPACE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true },
    value: { type: String },
  },
});

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith(
      'workspace_core_query_builder_validation_',
    )
  ) {
    throw new Error(
      'A named disposable Core QueryBuilder database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

describeWithDisposablePostgres(
  'WorkspaceQueryRunner Core QueryBuilder PostgreSQL boundary',
  () => {
    let coreDataSource: DataSource;
    let workspaceDataSource: GlobalWorkspaceDataSource;
    let service: WorkspaceQueryRunnerCoreQueryBuilderService;

    beforeAll(async () => {
      const url = getDisposableDatabaseUrl();

      coreDataSource = new DataSource({
        type: 'postgres',
        url,
        entities: [coreParentSchema, coreChildSchema],
      });
      await coreDataSource.initialize();
      await coreDataSource.query(`CREATE SCHEMA "${CORE_SCHEMA}"`);
      await coreDataSource.query(`CREATE SCHEMA "${WORKSPACE_SCHEMA}"`);
      await coreDataSource.synchronize();
      await coreDataSource.query(
        `CREATE TABLE "${WORKSPACE_SCHEMA}"."fixture" ("id" uuid PRIMARY KEY, "value" varchar NOT NULL)`,
      );
      await coreDataSource.query(
        `INSERT INTO "${CORE_SCHEMA}"."parent" ("id", "value") VALUES ($1, 'initial')`,
        [PARENT_ID],
      );
      await coreDataSource.query(
        `INSERT INTO "${CORE_SCHEMA}"."child" ("id", "value", "parentId") VALUES ($1, 'child', $2)`,
        [CHILD_ID, PARENT_ID],
      );
      await coreDataSource.query(
        `INSERT INTO "${WORKSPACE_SCHEMA}"."fixture" ("id", "value") VALUES ($1, 'workspace')`,
        [WORKSPACE_ROW_ID],
      );

      const eventEmitter = {
        markTransactionStarted: jest.fn(),
        flushDatabaseBatchEventsAfterCommit: jest.fn(),
        discardDatabaseBatchEventsAfterRollback: jest.fn(),
        clearPendingDatabaseBatchEvents: jest.fn(),
      };

      workspaceDataSource = new GlobalWorkspaceDataSource(
        {
          type: 'postgres',
          url,
          entities: [workspaceFixtureSchema],
        },
        eventEmitter as never,
        coreDataSource,
      );
      await workspaceDataSource.initialize();

      const globalWorkspaceDataSourceService = {
        getGlobalWorkspaceDataSource: () => workspaceDataSource,
      } as GlobalWorkspaceDataSourceService;

      service = new WorkspaceQueryRunnerCoreQueryBuilderService(
        coreDataSource,
        globalWorkspaceDataSourceService,
      );
    });

    afterAll(async () => {
      if (workspaceDataSource?.isInitialized) {
        await workspaceDataSource.destroy();
      }
      if (coreDataSource?.isInitialized) {
        await coreDataSource.destroy();
      }
    });

    it('keeps Core selects, locks, writes, and WorkspaceRepository on one exact transaction', async () => {
      const queryRunner = workspaceDataSource.createQueryRunner();
      const originalManager = queryRunner.manager;

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const [runnerIdentity] = (await queryRunner.query(
        'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
      )) as Array<{ pid: number; txid: string }>;
      const selected = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .leftJoinAndSelect('parent.children', 'child')
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getOne();
      const count = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getCount();
      const selectIdentity = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .select('pg_backend_pid()', 'pid')
        .addSelect('txid_current()::text', 'txid')
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getRawOne<{ pid: number; txid: string }>();
      const pessimisticReadIdentity = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .setLock('pessimistic_read')
        .select('pg_backend_pid()', 'pid')
        .addSelect('txid_current()::text', 'txid')
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getRawOne<{ pid: number; txid: string }>();
      const pessimisticWriteIdentity = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .setLock('pessimistic_write')
        .select('pg_backend_pid()', 'pid')
        .addSelect('txid_current()::text', 'txid')
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getRawOne<{ pid: number; txid: string }>();

      await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .insert()
        .into(coreParentSchema)
        .values({ id: INSERTED_ID, value: 'inserted' })
        .updateEntity(false)
        .execute();
      await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .update()
        .set({ value: 'updated' })
        .where('id = :parentId', { parentId: PARENT_ID })
        .updateEntity(false)
        .execute();

      const afterWriteIdentity = await service
        .createCoreQueryBuilder({
          queryRunner,
          target: coreParentSchema,
          alias: 'parent',
        })
        .select('pg_backend_pid()', 'pid')
        .addSelect('txid_current()::text', 'txid')
        .where('parent.id = :parentId', { parentId: PARENT_ID })
        .getRawOne<{ pid: number; txid: string }>();

      const authContext = {
        type: 'system',
        workspace: { id: WORKSPACE_ID },
      };
      const workspaceRepository = withWorkspaceContext(
        {
          authContext,
          entityMetadatas: workspaceDataSource.entityMetadatas,
          featureFlagsMap: {},
          permissionsPerRoleId: {},
        } as never,
        () =>
          queryRunner.manager.getRepository(
            workspaceFixtureSchema,
            { shouldBypassPermissionChecks: true },
            authContext as never,
          ),
      );

      expect(queryRunner.manager).toBe(originalManager);
      expect(originalManager).toBeInstanceOf(WorkspaceEntityManager);
      expect(originalManager.queryRunner).toBe(queryRunner);
      expect(queryRunner.connection).toBe(workspaceDataSource);
      expect(selected).toMatchObject({
        id: PARENT_ID,
        value: 'initial',
        children: [{ id: CHILD_ID, value: 'child' }],
      });
      expect(count).toBe(1);
      expect(workspaceRepository).toBeInstanceOf(WorkspaceRepository);
      expect(selectIdentity).toEqual(runnerIdentity);
      expect(pessimisticReadIdentity).toEqual(runnerIdentity);
      expect(pessimisticWriteIdentity).toEqual(runnerIdentity);
      expect(afterWriteIdentity).toEqual(runnerIdentity);

      let competingUpdateCompleted = false;
      const competingUpdate = coreDataSource
        .query(
          `UPDATE "${CORE_SCHEMA}"."parent" SET "value" = 'initial' WHERE "id" = $1`,
          [PARENT_ID],
        )
        .then(() => {
          competingUpdateCompleted = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(competingUpdateCompleted).toBe(false);

      await queryRunner.rollbackTransaction();
      await competingUpdate;

      expect(queryRunner.manager).toBe(originalManager);
      expect(
        await coreDataSource
          .getRepository(coreParentSchema)
          .findOneBy({ id: INSERTED_ID }),
      ).toBeNull();
      expect(
        await coreDataSource
          .getRepository(coreParentSchema)
          .findOneByOrFail({ id: PARENT_ID }),
      ).toMatchObject({ value: 'initial' });

      await queryRunner.release();
    });
  },
);
