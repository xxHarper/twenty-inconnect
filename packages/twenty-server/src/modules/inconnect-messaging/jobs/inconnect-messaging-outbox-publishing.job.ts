import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { INCONNECT_MESSAGING_OUTBOX_PUBLISHING_JOB_NAME } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-outbox-publishing-job-name.constant';
import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

export type InconnectMessagingOutboxPublishingJobData = {
  outboxEventId: string;
};

@Processor(MessageQueue.webhookQueue)
export class InconnectMessagingOutboxPublishingJob {
  constructor(
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  @Process(INCONNECT_MESSAGING_OUTBOX_PUBLISHING_JOB_NAME)
  async handle(data: InconnectMessagingOutboxPublishingJobData): Promise<void> {
    await this.outboxService.publishEvent(data.outboxEventId);
  }
}
