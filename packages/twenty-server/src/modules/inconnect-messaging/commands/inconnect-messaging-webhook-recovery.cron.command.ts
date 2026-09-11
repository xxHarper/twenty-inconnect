import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  INCONNECT_MESSAGING_WEBHOOK_RECOVERY_CRON_PATTERN,
  InconnectMessagingWebhookRecoveryCronJob,
} from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-webhook-recovery.cron.job';

@Command({
  name: 'cron:inconnect-messaging:webhook-recovery',
  description: 'Re-enqueues durable INCONNECT Messaging webhook receipts',
})
export class InconnectMessagingWebhookRecoveryCronCommand extends CommandRunner {
  public constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  public async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: InconnectMessagingWebhookRecoveryCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: INCONNECT_MESSAGING_WEBHOOK_RECOVERY_CRON_PATTERN,
        },
      },
    });
  }
}
