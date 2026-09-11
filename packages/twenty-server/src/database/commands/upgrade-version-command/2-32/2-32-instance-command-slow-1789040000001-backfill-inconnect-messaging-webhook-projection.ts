import { type DataSource, type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1789040000001, { type: 'slow' })
export class BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand implements SlowInstanceCommand {
  public async runDataMigration(dataSource: DataSource): Promise<void> {
    await dataSource.query(
      'UPDATE "core"."inconnectMessagingMessage" SET "serverReceivedAt" = "createdAt", "effectiveInboundAt" = "createdAt", "timestampSource" = \'SERVER\' WHERE "direction" = \'INBOUND\' AND "serverReceivedAt" IS NULL',
    );
    await dataSource.query(
      'UPDATE "core"."inconnectMessagingConversation" AS conversation SET "lastInboundAt" = inbound."lastInboundAt" FROM (SELECT "conversationId", MAX("effectiveInboundAt") AS "lastInboundAt" FROM "core"."inconnectMessagingMessage" WHERE "direction" = \'INBOUND\' GROUP BY "conversationId") AS inbound WHERE conversation."id" = inbound."conversationId" AND (conversation."lastInboundAt" IS NULL OR conversation."lastInboundAt" < inbound."lastInboundAt")',
    );
    await dataSource.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" VALIDATE CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS"',
    );
  }

  public async up(_queryRunner: QueryRunner): Promise<void> {
    return;
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
