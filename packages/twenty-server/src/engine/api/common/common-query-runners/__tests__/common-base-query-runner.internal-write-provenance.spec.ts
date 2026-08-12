import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { CommonUpdateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-one-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import {
  CommonQueryNames,
  type CommonInput,
  type UpdateOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';

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
});
