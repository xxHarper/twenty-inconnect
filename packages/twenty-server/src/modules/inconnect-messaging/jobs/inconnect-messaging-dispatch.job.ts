import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { INCONNECT_MESSAGING_DISPATCH_JOB_NAME } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-dispatch-job-name.constant';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';

@Processor(MessageQueue.webhookQueue)
export class InconnectMessagingDispatchJob {
  constructor(
    private readonly dispatchService: InconnectMessagingDispatchService,
  ) {}

  @Process(INCONNECT_MESSAGING_DISPATCH_JOB_NAME)
  async handle(data: { messageId: string }): Promise<void> {
    await this.dispatchService.dispatchMessage(data.messageId);
  }
}
