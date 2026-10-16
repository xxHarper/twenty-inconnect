import { Logger, Scope } from '@nestjs/common';

import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import {
  LogicFunctionException,
  LogicFunctionExceptionCode,
} from 'src/engine/metadata-modules/logic-function/logic-function.exception';

export type LogicFunctionTriggerJobData = {
  logicFunctionId: string;
  workspaceId: string;
  payload?: object;
  userId?: string;
  userWorkspaceId?: string;
};

@Processor({
  queueName: MessageQueue.logicFunctionQueue,
  scope: Scope.REQUEST,
})
export class LogicFunctionTriggerJob {
  private readonly logger = new Logger(LogicFunctionTriggerJob.name);

  constructor(
    private readonly logicFunctionExecutorService: LogicFunctionExecutorService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
  ) {}

  @Process(LogicFunctionTriggerJob.name)
  async handle(
    jobData: LogicFunctionTriggerJobData | LogicFunctionTriggerJobData[],
  ) {
    // Jobs enqueued in version <=2.24.x carry arrays, remove this case once those jobs are drained
    const logicFunctionPayloads = Array.isArray(jobData) ? jobData : [jobData];

    for (const logicFunctionPayload of logicFunctionPayloads) {
      try {
        const payload = logicFunctionPayload.payload;

        if (payload && 'objectMetadata' in payload && 'properties' in payload) {
          const objectMetadata = payload.objectMetadata as {
            id?: string;
            workspaceId?: string;
          } | null;

          if (
            !objectMetadata?.id ||
            objectMetadata.workspaceId !== logicFunctionPayload.workspaceId ||
            !(await this.recordAccessAuthorizationService.isGenericRecordEventPublicationAllowed(
              {
                workspaceId: logicFunctionPayload.workspaceId,
                objectMetadataId: objectMetadata.id,
                eventProperties: [payload.properties],
              },
            ))
          )
            continue;
        }

        await this.logicFunctionExecutorService.execute({
          logicFunctionId: logicFunctionPayload.logicFunctionId,
          workspaceId: logicFunctionPayload.workspaceId,
          payload: logicFunctionPayload.payload ?? {},
          userId: logicFunctionPayload.userId,
          userWorkspaceId: logicFunctionPayload.userWorkspaceId,
        });
      } catch (error) {
        // A stopped application must not fail the job: failing would make
        // the queue retry an execution that is intentionally blocked.
        if (
          error instanceof LogicFunctionException &&
          error.code === LogicFunctionExceptionCode.LOGIC_FUNCTION_DISABLED
        ) {
          continue;
        }

        if (
          error instanceof LogicFunctionException &&
          error.code ===
            LogicFunctionExceptionCode.LOGIC_FUNCTION_DEPENDENCIES_SIZE_EXCEEDED
        ) {
          this.logger.warn(
            `Skipping function ${logicFunctionPayload.logicFunctionId} (workspace ${logicFunctionPayload.workspaceId}): ${error.message}`,
          );
          continue;
        }

        throw error;
      }
    }
  }
}
