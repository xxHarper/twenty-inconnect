import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1789040000000)
export class AddInconnectMessagingWebhookProjectionFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConversation" ADD "lastInboundAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_CONVERSATION_CONNECTION_ADDRESS_UNIQUE" ON "core"."inconnectMessagingConversation" ("providerConnectionId", "externalAddressNormalized")',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "serverReceivedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "providerOccurredAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "effectiveInboundAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "timestampSource" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE" CHECK ("type" IN (\'TEXT\', \'IMAGE\', \'AUDIO\', \'VIDEO\', \'DOCUMENT\', \'LOCATION\'))',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS" CHECK (("direction" = \'INBOUND\' AND "serverReceivedAt" IS NOT NULL AND "effectiveInboundAt" IS NOT NULL AND "timestampSource" IN (\'PROVIDER\', \'SERVER\')) OR ("direction" = \'OUTBOUND\' AND "serverReceivedAt" IS NULL AND "providerOccurredAt" IS NULL AND "effectiveInboundAt" IS NULL AND "timestampSource" IS NULL)) NOT VALID',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_MSG_STATUS_RECEIPT"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_STATUS_RECEIPT_UNIQUE" ON "core"."inconnectMessagingProviderStatusEvent" ("webhookReceiptId") WHERE "webhookReceiptId" IS NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_MSG_STATUS_RECEIPT_UNIQUE"',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_INCONNECT_MSG_STATUS_RECEIPT" ON "core"."inconnectMessagingProviderStatusEvent" ("webhookReceiptId")',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE"',
    );
    await queryRunner.query(
      'UPDATE "core"."inconnectMessagingMessage" SET "type" = \'TEXT\' WHERE "type" <> \'TEXT\'',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TYPE" CHECK ("type" = \'TEXT\')',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "timestampSource"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "effectiveInboundAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "providerOccurredAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "serverReceivedAt"',
    );
    await queryRunner.query(
      'DROP INDEX "core"."IDX_INCONNECT_MSG_CONVERSATION_CONNECTION_ADDRESS_UNIQUE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConversation" DROP COLUMN "lastInboundAt"',
    );
  }
}
