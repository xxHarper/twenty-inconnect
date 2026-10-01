import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { CommonUpdateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-one-query-runner.service';
import { CommonQueryRunnerExceptionCode } from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import {
  CommonQueryNames,
  type CommonInput,
  type UpdateOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { withWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';

describe('CommonBaseQueryRunner internal write provenance', () => {
  it('captures the pre-hook payload before a hook mutates it', async () => {
    const runner = new CommonUpdateOneQueryRunnerService(
      {} as CommonUpdateManyQueryRunnerService,
    );
    const dataArgProcessor = {
      process: jest
        .fn()
        .mockImplementation(({ partialRecordInputs }) =>
          Promise.resolve(partialRecordInputs),
        ),
    };
    const workspaceQueryHookService = {
      executePreQueryHooks: jest
        .fn()
        .mockImplementation((_auth, _object, _operation, payload) => {
          payload.data.updatedBy = {
            source: 'MANUAL',
            name: 'Scott Forstall',
          };

          return payload;
        }),
    };
    const runnerWithInternals = runner as unknown as {
      dataArgProcessor: typeof dataArgProcessor;
      workspaceQueryHookService: typeof workspaceQueryHookService;
      processArgs: (
        args: CommonInput<UpdateOneQueryArgs>,
        context: CommonBaseQueryRunnerContext,
        operationName: CommonQueryNames,
      ) => Promise<{
        args: CommonInput<UpdateOneQueryArgs>;
        internallyInjectedFieldNames: string[];
      }>;
    };

    runnerWithInternals.dataArgProcessor = dataArgProcessor;
    runnerWithInternals.workspaceQueryHookService = workspaceQueryHookService;

    const result = await runnerWithInternals.processArgs(
      {
        id: 'lead-id',
        data: { etapa: 'CONTACTADO' },
        selectedFields: {},
      },
      {
        authContext: {
          type: 'user',
          workspace: { id: 'workspace-id' },
        },
        flatObjectMetadata: { nameSingular: 'lead' },
        flatObjectMetadataMaps: {},
        flatFieldMetadataMaps: {},
      } as unknown as CommonBaseQueryRunnerContext,
      CommonQueryNames.UPDATE_ONE,
    );

    expect(result.internallyInjectedFieldNames).toEqual(['updatedBy']);
    expect(result.args.data).toMatchObject({
      etapa: 'CONTACTADO',
      updatedBy: { name: 'Scott Forstall' },
    });
  });

  it('binds the extended repository to an active caller-owned QueryRunner', async () => {
    const runner = new CommonUpdateOneQueryRunnerService(
      {} as CommonUpdateManyQueryRunnerService,
    );
    const repository = { marker: 'transaction-bound' };
    const workspaceDataSource = {};
    const queryRunner = {
      connection: workspaceDataSource,
      isReleased: false,
      isTransactionActive: true,
      manager: {
        getRepository: jest.fn().mockReturnValue(repository),
      },
    } as unknown as WorkspaceQueryRunner;
    const globalWorkspaceOrmManager = {
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue(workspaceDataSource),
    };
    const runnerWithInternals = runner as unknown as {
      globalWorkspaceOrmManager: typeof globalWorkspaceOrmManager;
      prepareExtendedQueryRunnerContextWithGlobalDatasource: (
        context: CommonBaseQueryRunnerContext,
        boundQueryRunner: WorkspaceQueryRunner,
      ) => Promise<{ repository: unknown; queryRunner?: WorkspaceQueryRunner }>;
    };

    runnerWithInternals.globalWorkspaceOrmManager = globalWorkspaceOrmManager;

    const authContext = {
      type: 'user',
      workspace: { id: 'workspace-id' },
    } as never;
    const queryRunnerContext = {
      authContext,
      flatObjectMetadata: { nameSingular: 'lead' },
      flatObjectMetadataMaps: {},
      flatFieldMetadataMaps: {},
      objectIdByNameSingular: { lead: 'lead-id' },
      rolePermissionConfig: { unionOf: ['role-id'] },
    } as unknown as CommonBaseQueryRunnerContext;

    const result = await withWorkspaceContext(
      {
        authContext,
        featureFlagsMap: {},
      } as never,
      () =>
        runnerWithInternals.prepareExtendedQueryRunnerContextWithGlobalDatasource(
          queryRunnerContext,
          queryRunner,
        ),
    );

    expect(result.repository).toBe(repository);
    expect(result.queryRunner).toBe(queryRunner);
    expect(queryRunner.manager.getRepository).toHaveBeenCalledWith(
      'lead',
      { unionOf: ['role-id'] },
      authContext,
    );
  });

  it.each([
    ['inactive', false, false, true],
    ['released', true, true, true],
    ['foreign', false, true, false],
  ])(
    'rejects a %s QueryRunner before executing the pipeline',
    async (_label, isReleased, isTransactionActive, usesPrimaryDataSource) => {
      const runner = new CommonUpdateOneQueryRunnerService(
        {} as CommonUpdateManyQueryRunnerService,
      );
      const workspaceDataSource = {};
      const queryRunner = {
        connection: usesPrimaryDataSource ? workspaceDataSource : {},
        isReleased,
        isTransactionActive,
      } as unknown as WorkspaceQueryRunner;
      const runnerWithInternals = runner as unknown as {
        globalWorkspaceOrmManager: {
          getGlobalWorkspaceDataSource: () => Promise<unknown>;
        };
        assertCallerOwnedQueryRunner: (
          boundQueryRunner: WorkspaceQueryRunner,
        ) => Promise<void>;
      };

      runnerWithInternals.globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(workspaceDataSource),
      };

      await expect(
        runnerWithInternals.assertCallerOwnedQueryRunner(queryRunner),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.INVALID_QUERY_RUNNER,
      });
    },
  );
});
