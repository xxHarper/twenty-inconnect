import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

export const INCONNECT_MESSAGING_OUTBOX_RECOVERY_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class InconnectMessagingOutboxRecoveryCronJob {
  constructor(
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  @Process(InconnectMessagingOutboxRecoveryCronJob.name)
  async handle(): Promise<void> {
    await this.outboxService.recoverPublishableEvents();
  }
}
