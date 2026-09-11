import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingWebhookProcessingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';

export type InconnectMessagingWebhookProcessingJobData = {
  receiptId: string;
};

@Processor(MessageQueue.webhookQueue)
export class InconnectMessagingWebhookProcessingJob {
  public constructor(
    private readonly webhookProcessingService: InconnectMessagingWebhookProcessingService,
  ) {}

  @Process(InconnectMessagingWebhookProcessingJob.name)
  public async handle(
    data: InconnectMessagingWebhookProcessingJobData,
  ): Promise<void> {
    await this.webhookProcessingService.processReceipt(data.receiptId);
  }
}
