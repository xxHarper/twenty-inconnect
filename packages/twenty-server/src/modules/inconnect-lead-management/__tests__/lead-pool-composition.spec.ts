import { type INestApplicationContext } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { caching } from 'cache-manager';
import { Server, Socket } from 'node:net';
import { DataSource } from 'typeorm';

import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { CoreCommonApiModule } from 'src/engine/api/common/core-common-api.module';
import { WorkspaceQueryHookExplorer } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.explorer';
import { ActorModule } from 'src/engine/core-modules/actor/actor.module';
import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { CaptchaModule } from 'src/engine/core-modules/captcha/captcha.module';
import { CodeInterpreterModule } from 'src/engine/core-modules/code-interpreter/code-interpreter.module';
import { EmailModule } from 'src/engine/core-modules/email/email.module';
import { EnvironmentModule } from 'src/engine/core-modules/environment/environment.module';
import { ExceptionHandlerModule } from 'src/engine/core-modules/exception-handler/exception-handler.module';
import { ExceptionHandlerDriver } from 'src/engine/core-modules/exception-handler/interfaces';
import { FileStorageModule } from 'src/engine/core-modules/file-storage/file-storage.module';
import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { LoggerModule } from 'src/engine/core-modules/logger/logger.module';
import { loggerModuleFactory } from 'src/engine/core-modules/logger/logger.module-factory';
import { LogicFunctionModule } from 'src/engine/core-modules/logic-function/logic-function.module';
import { MessageQueueDriverType } from 'src/engine/core-modules/message-queue/interfaces';
import { MessageQueueModule } from 'src/engine/core-modules/message-queue/message-queue.module';
import { RedisClientModule } from 'src/engine/core-modules/redis-client/redis-client.module';
import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { MetadataEngineModule } from 'src/engine/metadata-modules/metadata-engine.module';
import { GlobalWorkspaceDataSourceModule } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.module';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  type WorkspaceCacheDataMap,
  type WorkspaceCacheKeyName,
  type WorkspaceCacheResultWithHashes,
} from 'src/engine/workspace-cache/types/workspace-cache-key.type';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { LeadManagementModule } from 'src/modules/inconnect-lead-management/lead-management.module';
import { LeadManagementResolver } from 'src/modules/inconnect-lead-management/lead-management.resolver';
import { LeadPoolAuthorityService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import { LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';

import { roleId } from './lead-pool-composition-metadata.fixture';
import { makeCompositionTransport } from './lead-pool-composition-transport.fixture';
import {
  actor as poolActor,
  originId,
  poolId,
  poolInput,
  recipientId,
} from './lead-pool.fixtures';

jest.mock('src/engine/core-modules/dpa/pdf/render-dpa-to-pdf.util', () => ({
  renderDpaToPdfBuffer: () => {
    throw new Error('Unexpected PDF rendering');
  },
}));

const actor = {
  ...poolActor,
  workspaceMember: {
    ...poolActor.workspaceMember,
    name: { firstName: 'Ana', lastName: 'Operadora' },
  },
};
const core = new DataSource({ type: 'postgres' });
let testingModule: TestingModule;
let distributor: INestApplicationContext;
let resolver: LeadManagementResolver;
let commonUpdate: CommonUpdateManyQueryRunnerService;
let fixture: Awaited<ReturnType<typeof makeCompositionTransport>>;

const infrastructureAttempts: string[] = [];

beforeAll(async () => {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    IS_CONFIG_VARIABLES_IN_DB_ENABLED: 'false',
  });
  const refuseIo = (operation: string) => () => {
    infrastructureAttempts.push(operation);
    throw new Error(`Unexpected ${operation} in offline composition`);
  };
  jest
    .spyOn(Socket.prototype, 'connect')
    .mockImplementation(refuseIo('socket connection'));
  jest
    .spyOn(Server.prototype, 'listen')
    .mockImplementation(refuseIo('server listen'));
  jest
    .spyOn(DataSource.prototype, 'initialize')
    .mockImplementation(refuseIo('datasource initialization'));
  testingModule = await Test.createTestingModule({
    imports: [
      EnvironmentModule,
      ActorModule,
      TwentyConfigModule.forRoot(),
      RedisClientModule,
      CodeInterpreterModule.forRoot(),
      CaptchaModule.forRoot(),
      EmailModule.forRoot(),
      ExceptionHandlerModule.forRoot({ type: ExceptionHandlerDriver.CONSOLE }),
      LogicFunctionModule.forRoot(),
      LoggerModule.forRootAsync({
        useFactory: loggerModuleFactory,
        inject: [TwentyConfigService],
      }),
      FileStorageModule.forRoot(),
      MessageQueueModule.register({
        type: MessageQueueDriverType.Sync,
        options: {},
      }),
      EventEmitterModule.forRoot({ wildcard: true }),
      GlobalWorkspaceDataSourceModule,
      MetadataEngineModule,
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        APP_SECRET: 'offline-composition-fixture',
        IS_BILLING_ENABLED: false,
        REDIS_URL: 'redis://offline.invalid',
        IS_CONFIG_VARIABLES_IN_DB_ENABLED: false,
        INCONNECT_RECORD_ACCESS_SOURCE_MODE: 'database',
      }),
    )
    .overrideProvider(DataSource)
    .useValue(core)
    .overrideProvider(CACHE_MANAGER)
    .useValue(await caching('memory'))
    .compile();
  // Hook discovery only registers providers in memory.
  await testingModule.get(WorkspaceQueryHookExplorer).explore();
  distributor = testingModule
    .select(MetadataEngineModule)
    .select(LeadManagementModule);
  resolver = distributor.get(LeadManagementResolver, { strict: true });
  commonUpdate = distributor
    .select(CoreCommonApiModule)
    .get(CommonUpdateManyQueryRunnerService, { strict: true });
}, 30_000);

afterAll(async () => {
  try {
    await testingModule?.close();
    expect(infrastructureAttempts).toEqual([]);
  } finally {
    jest.restoreAllMocks();
  }
});

it('resolves the real distributor providers through the metadata engine', () => {
  expect(resolver).toBeInstanceOf(LeadManagementResolver);
  expect(commonUpdate).toBeInstanceOf(CommonUpdateManyQueryRunnerService);
  expect(distributor.get(LeadPoolService, { strict: true })).toBeInstanceOf(
    LeadPoolService,
  );
  expect(
    distributor.get(LeadPoolAuthorityService, { strict: true }),
  ).toBeInstanceOf(LeadPoolAuthorityService);
  expect(
    distributor.get(LeadPoolQueryService, { strict: true }),
  ).toBeInstanceOf(LeadPoolQueryService);
  expect(
    distributor.get(LeadPoolStoreService, { strict: true }),
  ).toBeInstanceOf(LeadPoolStoreService);
  expect(
    distributor
      .select(InconnectRecordAccessModule)
      .get(InconnectRecordAccessAuthorizationService, { strict: true }),
  ).toBeInstanceOf(InconnectRecordAccessAuthorizationService);
});

describe('Common Update with the caller transaction', () => {
  let update: jest.SpiedFunction<
    CommonUpdateManyQueryRunnerService['executeWithQueryRunner']
  >;
  const emitterListener = jest.fn();

  beforeEach(async () => {
    fixture = await makeCompositionTransport(
      core,
      testingModule.get(WorkspaceEventEmitter),
    );
    jest
      .spyOn(
        testingModule.get(GlobalWorkspaceDataSourceService),
        'getGlobalWorkspaceDataSource',
      )
      .mockReturnValue(fixture.primary);
    // Supply cache data at the I/O boundary before workspace cache discovery runs.
    const cacheData: Partial<WorkspaceCacheDataMap> = fixture.metadata.maps;
    jest
      .spyOn(
        testingModule.get(WorkspaceCacheService),
        'getOrRecomputeWithHashes',
      )
      .mockImplementation(
        async <Keys extends WorkspaceCacheKeyName[]>(
          workspaceId: string,
          keys: Keys,
        ): Promise<WorkspaceCacheResultWithHashes<Keys>> => {
          expect(workspaceId).toBe(actor.workspace.id);
          const entries = keys.map((key) => {
            if (!(key in cacheData))
              throw new Error(`Unexpected cache read ${key}`);
            return [key, cacheData[key]];
          });

          return {
            data: Object.fromEntries(entries) as Pick<
              WorkspaceCacheDataMap,
              Keys[number]
            >,
            hashes: Object.fromEntries(
              keys.map((key) => [key, 'fixture']),
            ) as Record<Keys[number], string>,
          };
        },
      );
    update = jest.spyOn(commonUpdate, 'executeWithQueryRunner');
    testingModule
      .get(EventEmitter2)
      .on(`${fixture.metadata.lead.nameSingular}.updated`, emitterListener);
  });

  afterEach(() => {
    if (!fixture) return;
    testingModule
      .get(EventEmitter2)
      .off(`${fixture.metadata.lead.nameSingular}.updated`, emitterListener);
    expect(fixture.transport.unexpected).toEqual([]);
  });

  const prepare = () =>
    withWorkspaceAuthContext(actor, () =>
      resolver.previewInconnectLeadPool(poolInput(1)),
    );
  const execute = (operationId: string, expectedVersion: number) =>
    withWorkspaceAuthContext(actor, () =>
      resolver.executeInconnectLeadPool({ operationId, expectedVersion }),
    );
  const crmWrites = () =>
    fixture.transport.queries.filter(({ statement }) =>
      statement.startsWith(`UPDATE ${fixture.table}`),
    );

  it('keeps the same runner, original manager and human authority through CRM and Store commit', async () => {
    const preview = await prepare();
    const repeated = await prepare();

    expect(repeated).toEqual(preview);
    expect(preview).toMatchObject({
      status: 'PREVIEW',
      version: 0,
      processed: 0,
    });
    expect(crmWrites()).toHaveLength(0);

    fixture.transport.queries.length = 0;
    const run = jest.spyOn(commonUpdate, 'run');
    const createRunner = jest.spyOn(fixture.primary, 'createQueryRunner');
    const createManager = jest.spyOn(fixture.primary, 'createEntityManager');
    fixture.transport.deferCommit = true;
    const response = Promise.resolve(execute(preview.id, preview.version));
    const responseObserved = jest.fn();
    const observed = response.then(responseObserved, responseObserved);

    try {
      await Promise.race([
        fixture.transport.commitStarted.promise,
        response.then(() => {
          throw new Error('Execution resolved before commit');
        }),
      ]);

      expect(responseObserved).not.toHaveBeenCalled();
      expect(emitterListener).not.toHaveBeenCalled();
      expect(fixture.durable.operation?.state).toMatchObject({
        status: 'PREVIEW',
        version: 0,
        batches: [],
      });
      expect(fixture.durable.record.commercialOwnerId).toBe(
        actor.workspaceMemberId,
      );
      expect(createRunner.mock.calls).toEqual([['master']]);
      expect(update).toHaveBeenCalledTimes(1);

      const [args, context, runner] = update.mock.calls[0];
      const originalManager = createManager.mock.results[0].value;
      const recordId = fixture.durable.record.id;

      expect(runner).toBe(createRunner.mock.results[0].value);
      expect(runner.connection).toBe(fixture.primary);
      expect(runner.isTransactionActive).toBe(true);
      expect(runner.manager).toBe(originalManager);
      expect(originalManager.queryRunner).toBe(runner);
      expect(
        createManager.mock.calls.filter(([candidate]) => candidate === runner),
      ).toHaveLength(1);
      expect(context.authContext).toBe(actor);
      expect(context.rolePermissionConfig).toEqual({
        intersectionOf: [roleId],
      });
      expect(run).toHaveBeenCalledTimes(1);
      const [processed, ordinaryContext] = run.mock.calls[0];
      expect(processed.data.updatedBy).toMatchObject({
        workspaceMemberId: actor.workspaceMemberId,
        name: 'Ana Operadora',
      });
      expect(processed.internallyInjectedFieldNames).toEqual(['updatedBy']);
      expect(ordinaryContext.authContext).toBe(actor);
      expect(ordinaryContext.queryRunner).toBe(runner);
      expect(ordinaryContext.workspaceDataSource).toBe(fixture.primary);
      expect(ordinaryContext.repository.manager).toBe(originalManager);
      expect(args).toEqual({
        filter: {
          id: { eq: recordId },
          commercialOwnerId: { eq: actor.workspaceMemberId },
        },
        data: { commercialOwner: { connect: { where: { id: recipientId } } } },
        selectedFields: { id: true },
      });

      expect(crmWrites()).toHaveLength(1);
      const [write] = crmWrites();
      expect(write.inTransaction).toBe(true);
      expect(write.statement).toContain('"updatedAt" = CURRENT_TIMESTAMP');
      const where = write.statement.split(' WHERE ')[1];
      const [, idParameter] = where.match(/"id" = \$(\d+)/) ?? [];
      const [, expectedOwner] =
        where.match(/"commercialOwnerId"\s*=\s*\$(\d+)/) ?? [];
      const [, ...scope] =
        where.match(/"commercialOwnerId"\s+IN\s*\(\$(\d+),\s*\$(\d+)\)/) ?? [];
      const parameter = (position: string) =>
        write.parameters[Number(position) - 1];
      expect(parameter(idParameter)).toBe(recordId);
      expect(parameter(expectedOwner)).toBe(actor.workspaceMemberId);
      expect(scope.map(parameter).sort()).toEqual(
        [actor.workspaceMemberId, recipientId].sort(),
      );
      const assignments = [
        ...write.statement.split(' WHERE ')[0].matchAll(/"([^"]+)" = \$(\d+)/g),
      ];
      expect(
        Object.fromEntries(
          assignments.map(([, column, position]) => [
            column,
            parameter(position),
          ]),
        ),
      ).toEqual({
        commercialOwnerId: recipientId,
        updatedByWorkspaceMemberId: actor.workspaceMemberId,
        updatedByName: 'Ana Operadora',
        updatedBySource: 'MANUAL',
        updatedByContext: '{}',
      });

      const statements = fixture.transport.queries
        .filter(({ connection }) => connection === write.connection)
        .map(({ statement }) => statement);
      const indexes = [
        statements.indexOf('START TRANSACTION'),
        statements.indexOf('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'),
        statements.findIndex((statement) =>
          statement.includes('pg_advisory_xact_lock'),
        ),
        statements.findIndex(
          (statement) =>
            statement.includes('"requestHash"') &&
            statement.trimEnd().endsWith('FOR UPDATE'),
        ),
        statements.findIndex(
          (statement) =>
            statement.includes('"pool"."commercialOwnerId" IN (') &&
            statement.endsWith('FOR UPDATE'),
        ),
        statements.findIndex((statement) =>
          statement.includes('"workspaceMember" "workspaceMember"'),
        ),
        statements.indexOf(write.statement),
        statements.findIndex((statement) =>
          statement.includes('FOR SHARE OF member, membership, workspace_user'),
        ),
        statements.findIndex((statement) =>
          statement.startsWith('UPDATE "core"."inconnectLeadPoolOperation"'),
        ),
        statements.indexOf('COMMIT'),
      ];
      expect(indexes[0]).toBe(0);
      indexes
        .slice(1)
        .forEach((index, position) =>
          expect(index).toBeGreaterThan(indexes[position]),
        );
    } finally {
      fixture.transport.commitResponse.resolve();
      await observed;
    }

    const result = await response;
    expect(result).toMatchObject({
      status: 'COMPLETED',
      version: 1,
      counts: { CHANGED: 1 },
    });
    expect(fixture.durable.operation?.state.batches).toEqual([
      { version: 0, attempted: 1, outcome: 'COMMITTED' },
    ]);
    expect(fixture.durable.record).toMatchObject({
      commercialOwnerId: recipientId,
      updatedByWorkspaceMemberId: actor.workspaceMemberId,
    });
    expect(emitterListener).toHaveBeenCalledTimes(1);
    expect(emitterListener.mock.calls[0][0]).toMatchObject({
      workspaceId: actor.workspace.id,
      events: [
        {
          recordId: fixture.durable.record.id,
          userId: actor.user.id,
          userWorkspaceId: actor.userWorkspaceId,
          workspaceMemberId: actor.workspaceMemberId,
        },
      ],
    });

    const updateResult = await update.mock.results[0].value;
    expect(updateResult.results).toEqual([{ id: fixture.durable.record.id }]);
    expect(await execute(preview.id, preview.version)).toEqual(result);
    expect(crmWrites()).toHaveLength(1);
  });

  it('rejects a record whose current owner is outside the human scope', async () => {
    const preview = await prepare();
    fixture.durable.record.commercialOwnerId = poolId(90);

    const result = await execute(preview.id, preview.version);

    expect(result.counts.REJECTED).toBe(1);
    expect(result.items).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(crmWrites()).toHaveLength(0);
  });

  it.each([
    ['owner', { commercialOwnerId: recipientId }],
    ['record version', { updatedAt: '2026-10-26 12:00:00.123457+00' }],
  ])(
    'preserves the record if its expected %s changed',
    async (_condition, change) => {
      const preview = await prepare();
      Object.assign(fixture.durable.record, change);

      const result = await execute(preview.id, preview.version);

      expect(result.counts.CONFLICT).toBe(1);
      expect(fixture.durable.record).toMatchObject(change);
      expect(update).not.toHaveBeenCalled();
      expect(crmWrites()).toHaveLength(0);
    },
  );

  it('rejects an unexpected future operation version before attempting a write', async () => {
    const preview = await prepare();

    await expect(execute(preview.id, preview.version + 1)).rejects.toThrow(
      'Invalid operation version',
    );
    expect(update).not.toHaveBeenCalled();
    expect(fixture.durable.operation?.state.version).toBe(preview.version);
  });

  it('rejects an inactive recipient during confirmation', async () => {
    const preview = await prepare();
    fixture.transport.recipientActive = false;

    await expect(execute(preview.id, preview.version)).rejects.toThrow(
      'current authority',
    );
    expect(update).not.toHaveBeenCalled();
    expect(crmWrites()).toHaveLength(0);
    expect(fixture.durable.operation?.state.version).toBe(preview.version);
  });

  it('rejects revoked standard Owner permissions inside the ordinary ORM', async () => {
    const preview = await prepare();
    fixture.transport.afterLockedSelection = () => {
      fixture.metadata.maps.rolesPermissions[roleId][originId].restrictedFields[
        fixture.metadata.owner.id
      ] = { canUpdate: false };
    };

    await expect(execute(preview.id, preview.version)).rejects.toThrow(
      'No se pudo reconciliar el lote',
    );
    expect(update).toHaveBeenCalledTimes(1);
    await expect(update.mock.results[0].value).rejects.toThrow(/permission/i);
    expect(crmWrites()).toHaveLength(0);
    expect(fixture.durable.operation?.state.version).toBe(preview.version);
  });

  it('enforces Owner Integrity inside Common Update when a destination loses assignability after selection', async () => {
    const preview = await prepare();
    fixture.transport.afterLockedSelection = () => {
      const { team } = fixture.metadata;
      const membership = team.membershipByWorkspaceMemberId[recipientId];

      membership.isWorkspaceMemberAssignable = false;
      team.assignableMemberWorkspaceMemberIdsByTeamId[membership.teamId] = [
        actor.workspaceMemberId,
      ];
    };

    const result = await execute(preview.id, preview.version);

    expect(update).toHaveBeenCalledTimes(1);
    await expect(update.mock.results[0].value).rejects.toThrow(/assignable/i);
    expect(result).toMatchObject({
      counts: { CHANGED: 0, PENDING: 1 },
      batchFailures: 1,
      canExecute: false,
    });
    expect(crmWrites()).toHaveLength(0);
  });

  it.each(['failUpdate', 'failSave'] as const)(
    'rolls back CRM and Store on %s',
    async (failure) => {
      const preview = await prepare();
      fixture.transport[failure] = true;

      const result = await execute(preview.id, preview.version);

      expect(update).toHaveBeenCalledTimes(1);
      expect(crmWrites()).toHaveLength(1);
      const [write] = crmWrites();
      const statements = fixture.transport.queries
        .filter(({ connection }) => connection === write.connection)
        .map(({ statement }) => statement);
      expect(statements[statements.length - 1]).toBe('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(emitterListener).not.toHaveBeenCalled();
      expect(fixture.durable.record.commercialOwnerId).toBe(
        actor.workspaceMemberId,
      );
      expect(fixture.durable.operation?.state.batches).toEqual([
        { version: 0, attempted: 1, outcome: 'ROLLED_BACK' },
      ]);
      expect(result).toMatchObject({
        version: 1,
        counts: { CHANGED: 0, PENDING: 1 },
        batchFailures: 1,
      });
    },
  );

  it.each([false, true])(
    'rereads primary after losing commit acknowledgement (unavailable: %s)',
    async (unavailable) => {
      const preview = await prepare();
      fixture.transport.loseCommitResponse = true;
      fixture.transport.failReconciliation = unavailable;

      const response = execute(preview.id, preview.version);
      if (unavailable) {
        await expect(response).rejects.toThrow(
          'No se pudo reconciliar el lote',
        );
      } else {
        await expect(response).resolves.toMatchObject({
          version: 1,
          counts: { CHANGED: 1 },
        });
        const [write] = crmWrites();
        const commitIndex = fixture.transport.queries.findIndex(
          ({ statement, connection }) =>
            statement === 'COMMIT' && connection === write.connection,
        );
        expect(commitIndex).toBeGreaterThan(0);
        const reread = fixture.transport.queries
          .slice(commitIndex + 1)
          .find(
            ({ statement }) =>
              statement.includes('"requestHash"') &&
              statement.trimEnd().endsWith('FOR UPDATE'),
          );
        expect(reread).toBeDefined();
        expect(reread?.connection).not.toBe(write.connection);
        expect(reread?.inTransaction).toBe(true);
      }

      expect(crmWrites()).toHaveLength(1);
      expect(fixture.transport.releasedWithError).toHaveBeenCalledWith(
        expect.any(Error),
      );
      expect(fixture.durable.record.commercialOwnerId).toBe(recipientId);
      expect(fixture.durable.operation?.state.batches).toEqual([
        { version: 0, attempted: 1, outcome: 'COMMITTED' },
      ]);
      expect(emitterListener).not.toHaveBeenCalled();
    },
  );

  it('rejects SYSTEM at the resolver entry before acquiring a write transaction', async () => {
    const preview = await prepare();
    fixture.transport.queries.length = 0;

    await expect(
      withWorkspaceAuthContext(
        { type: 'system', workspace: actor.workspace },
        () =>
          resolver.executeInconnectLeadPool({
            operationId: preview.id,
            expectedVersion: preview.version,
          }),
      ),
    ).rejects.toThrow('current authority');
    expect(update).not.toHaveBeenCalled();
    expect(fixture.transport.queries).toEqual([]);
  });
});
