import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1789473600000)
export class AddInconnectMessagingTemplateIntentFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_SEND_MODE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateProviderReference" text',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateDisplayName" text',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateLanguage" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateVariables" jsonb',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD "templateDefinitionFingerprint" text',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_SEND_MODE" CHECK ("sendMode" IS NULL OR "sendMode" IN (\'FREEFORM\', \'TEMPLATE\'))',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TEMPLATE" CHECK (("sendMode" = \'TEMPLATE\' AND "templateId" IS NOT NULL AND "templateProviderReference" IS NOT NULL AND "templateDisplayName" IS NOT NULL AND "templateLanguage" IS NOT NULL AND "templateVariables" IS NOT NULL AND "templateDefinitionFingerprint" IS NOT NULL) OR ("sendMode" IS DISTINCT FROM \'TEMPLATE\' AND "templateId" IS NULL AND "templateProviderReference" IS NULL AND "templateDisplayName" IS NULL AND "templateLanguage" IS NULL AND "templateVariables" IS NULL AND "templateDefinitionFingerprint" IS NULL))',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_TEMPLATE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_SEND_MODE"',
    );
    await queryRunner.query(
      'UPDATE "core"."inconnectMessagingMessage" SET "sendMode" = \'FREEFORM\' WHERE "sendMode" = \'TEMPLATE\'',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" ADD CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_SEND_MODE" CHECK ("sendMode" IS NULL OR "sendMode" = \'FREEFORM\')',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateDefinitionFingerprint"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateVariables"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateLanguage"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateDisplayName"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateProviderReference"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingMessage" DROP COLUMN "templateId"',
    );
  }
}
