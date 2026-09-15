import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  INCONNECT_MESSAGING_DISPATCH_RECOVERY_CRON_PATTERN,
  InconnectMessagingDispatchRecoveryCronJob,
} from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-dispatch-recovery.cron.job';

@Command({
  name: 'cron:inconnect-messaging:dispatch-recovery',
  description:
    'Recovers durable INCONNECT Messaging outbound dispatch attempts',
})
export class InconnectMessagingDispatchRecoveryCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: InconnectMessagingDispatchRecoveryCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: INCONNECT_MESSAGING_DISPATCH_RECOVERY_CRON_PATTERN },
      },
    });
  }
}
