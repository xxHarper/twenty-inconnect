import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  INCONNECT_MESSAGING_MEDIA_RECOVERY_CRON_PATTERN,
  InconnectMessagingMediaRecoveryCronJob,
} from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-media-recovery.cron.job';

@Command({
  name: 'cron:inconnect-messaging:media-recovery',
  description: 'Re-enqueues durable INCONNECT Messaging media ingestion',
})
export class InconnectMessagingMediaRecoveryCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: InconnectMessagingMediaRecoveryCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: INCONNECT_MESSAGING_MEDIA_RECOVERY_CRON_PATTERN },
      },
    });
  }
}
