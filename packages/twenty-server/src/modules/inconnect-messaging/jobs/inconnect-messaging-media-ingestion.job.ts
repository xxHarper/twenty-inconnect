import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingMediaIngestionService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service';

export type InconnectMessagingMediaIngestionJobData = {
  attachmentId: string;
};

@Processor(MessageQueue.webhookQueue)
export class InconnectMessagingMediaIngestionJob {
  constructor(
    private readonly mediaIngestionService: InconnectMessagingMediaIngestionService,
  ) {}

  @Process(InconnectMessagingMediaIngestionJob.name)
  async handle(data: InconnectMessagingMediaIngestionJobData): Promise<void> {
    await this.mediaIngestionService.processAttachment(data.attachmentId);
  }
}
