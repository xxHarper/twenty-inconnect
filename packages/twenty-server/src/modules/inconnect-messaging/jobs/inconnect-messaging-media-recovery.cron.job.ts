import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InconnectMessagingMediaIngestionService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service';

export const INCONNECT_MESSAGING_MEDIA_RECOVERY_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class InconnectMessagingMediaRecoveryCronJob {
  constructor(
    private readonly mediaIngestionService: InconnectMessagingMediaIngestionService,
  ) {}

  @Process(InconnectMessagingMediaRecoveryCronJob.name)
  async handle(): Promise<void> {
    await this.mediaIngestionService.recoverPendingAttachments();
  }
}
