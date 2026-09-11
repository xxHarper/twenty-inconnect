import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

export const INCONNECT_MESSAGING_WEBHOOK_RECOVERY_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class InconnectMessagingWebhookRecoveryCronJob {
  public constructor(
    private readonly webhookReceiptService: InconnectMessagingWebhookReceiptService,
  ) {}

  @Process(InconnectMessagingWebhookRecoveryCronJob.name)
  public async handle(): Promise<void> {
    await this.webhookReceiptService.recoverPendingReceipts();
  }
}
