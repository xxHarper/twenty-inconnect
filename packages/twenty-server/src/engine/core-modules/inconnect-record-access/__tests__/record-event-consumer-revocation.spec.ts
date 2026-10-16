import { LogicFunctionTriggerJob } from 'src/engine/core-modules/logic-function/logic-function-trigger/jobs/logic-function-trigger.job';
import { CallWebhookJob } from 'src/engine/metadata-modules/webhook/jobs/call-webhook.job';
import { WorkflowVersionStatus } from 'src/modules/workflow/common/standard-objects/workflow-version.workspace-entity';
import { WorkflowTriggerJob } from 'src/modules/workflow/workflow-trigger/jobs/workflow-trigger.job';

const buildWorkflowHarness = () => {
  const authorization = {
    isGenericRecordEventPublicationAllowed: jest.fn().mockResolvedValue(false),
  };
  const runner = { run: jest.fn() };
  const manager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => Promise<void>) =>
      callback(),
    ),
    getRepository: jest.fn().mockResolvedValue({
      findOneBy: jest
        .fn()
        .mockResolvedValue({ lastPublishedVersionId: 'version' }),
    }),
  };
  const common = {
    getWorkflowVersionOrFail: jest
      .fn()
      .mockResolvedValue({ status: WorkflowVersionStatus.ACTIVE }),
  };
  const job = new WorkflowTriggerJob(
    manager as never,
    common as never,
    runner as never,
    authorization as never,
  );
  const data = {
    workspaceId: 'workspace',
    workflowId: 'workflow',
    recordEventObjectMetadataId: 'object',
    payload: {
      recordId: 'record',
      properties: { after: { id: 'record', label: 'private' } },
    },
  };
  return { authorization, runner, manager, common, job, data };
};

describe('Workflow record-event job current authority', () => {
  it('rejects a queued payload after Record Access revocation before any workflow read', async () => {
    const harness = buildWorkflowHarness();
    await harness.job.handle(harness.data);
    expect(harness.manager.getRepository).not.toHaveBeenCalled();
    expect(harness.runner.run).not.toHaveBeenCalled();
  });

  it('rechecks after workflow/version lookup and before run persistence', async () => {
    const harness = buildWorkflowHarness();
    harness.authorization.isGenericRecordEventPublicationAllowed
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await harness.job.handle(harness.data);
    expect(harness.common.getWorkflowVersionOrFail).toHaveBeenCalledTimes(1);
    expect(harness.runner.run).not.toHaveBeenCalled();
  });

  it('preserves currently unmanaged record-event execution', async () => {
    const harness = buildWorkflowHarness();
    harness.authorization.isGenericRecordEventPublicationAllowed.mockResolvedValue(
      true,
    );
    await harness.job.handle(harness.data);
    expect(harness.runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ payload: harness.data.payload }),
    );
  });

  it('suppresses legacy record-event jobs without object provenance', async () => {
    const harness = buildWorkflowHarness();
    const { recordEventObjectMetadataId: _objectId, ...legacy } = harness.data;
    await harness.job.handle(legacy);
    expect(harness.runner.run).not.toHaveBeenCalled();
  });

  it('preserves non-record cron jobs', async () => {
    const harness = buildWorkflowHarness();
    await harness.job.handle({
      workspaceId: 'workspace',
      workflowId: 'workflow',
      payload: { scheduledAt: 'time' },
    });
    expect(harness.runner.run).toHaveBeenCalledTimes(1);
    expect(
      harness.authorization.isGenericRecordEventPublicationAllowed,
    ).not.toHaveBeenCalled();
  });

  it('suppresses on unavailable authority', async () => {
    const harness = buildWorkflowHarness();
    harness.authorization.isGenericRecordEventPublicationAllowed.mockRejectedValue(
      new Error('unavailable'),
    );
    await harness.job.handle(harness.data);
    expect(harness.runner.run).not.toHaveBeenCalled();
  });
});

describe('Final external record-event consumers', () => {
  it.each([false, true])(
    'checks webhook content immediately before HTTP: allowed=%s',
    async (allowed) => {
      const authorization = {
        isGenericRecordEventPublicationAllowed: jest
          .fn()
          .mockResolvedValue(allowed),
      };
      const post = jest.fn().mockResolvedValue({ status: 200 });
      const emitter = {
        createContext: jest
          .fn()
          .mockReturnValue({ insertWorkspaceEvent: jest.fn() }),
      };
      const metrics = { incrementCounterForEvent: jest.fn() };
      const client = { getHttpClient: jest.fn().mockReturnValue({ post }) };
      const job = new CallWebhookJob(
        emitter as never,
        metrics as never,
        client as never,
        authorization as never,
      );
      await job.handle([
        {
          workspaceId: 'workspace',
          objectMetadata: { id: 'object', nameSingular: 'root' },
          record: { related: { sensitive: 'private' } },
          targetUrl: 'https://example.test',
        } as never,
      ]);
      expect(post).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(
        authorization.isGenericRecordEventPublicationAllowed,
      ).toHaveBeenCalledWith({
        workspaceId: 'workspace',
        objectMetadataId: 'object',
        eventProperties: [{ after: { related: { sensitive: 'private' } } }],
      });
    },
  );

  it.each([false, true])(
    'checks queued logic-function snapshots before execution: allowed=%s',
    async (allowed) => {
      const authorization = {
        isGenericRecordEventPublicationAllowed: jest
          .fn()
          .mockResolvedValue(allowed),
      };
      const executor = { execute: jest.fn() };
      const job = new LogicFunctionTriggerJob(
        executor as never,
        authorization as never,
      );
      await job.handle({
        logicFunctionId: 'function',
        workspaceId: 'workspace',
        payload: {
          objectMetadata: { id: 'object', workspaceId: 'workspace' },
          properties: { after: { relatedId: 'private' } },
        },
      });
      expect(executor.execute).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );

  it('rejects cross-workspace logic payloads before execution', async () => {
    const authorization = {
      isGenericRecordEventPublicationAllowed: jest.fn().mockResolvedValue(true),
    };
    const executor = { execute: jest.fn() };
    const job = new LogicFunctionTriggerJob(
      executor as never,
      authorization as never,
    );
    await job.handle({
      logicFunctionId: 'function',
      workspaceId: 'workspace',
      payload: {
        objectMetadata: { id: 'object', workspaceId: 'other' },
        properties: {},
      },
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('preserves non-database logic-function jobs', async () => {
    const authorization = {
      isGenericRecordEventPublicationAllowed: jest
        .fn()
        .mockResolvedValue(false),
    };
    const executor = { execute: jest.fn() };
    const job = new LogicFunctionTriggerJob(
      executor as never,
      authorization as never,
    );
    await job.handle({
      logicFunctionId: 'function',
      workspaceId: 'workspace',
      payload: {},
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(
      authorization.isGenericRecordEventPublicationAllowed,
    ).not.toHaveBeenCalled();
  });
});
