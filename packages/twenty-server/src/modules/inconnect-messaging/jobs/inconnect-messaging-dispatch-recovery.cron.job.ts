import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';

export const INCONNECT_MESSAGING_DISPATCH_RECOVERY_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class InconnectMessagingDispatchRecoveryCronJob {
  constructor(
    private readonly dispatchService: InconnectMessagingDispatchService,
  ) {}

  @Process(InconnectMessagingDispatchRecoveryCronJob.name)
  async handle(): Promise<void> {
    await this.dispatchService.recoverDispatchableAttempts();
  }
}
