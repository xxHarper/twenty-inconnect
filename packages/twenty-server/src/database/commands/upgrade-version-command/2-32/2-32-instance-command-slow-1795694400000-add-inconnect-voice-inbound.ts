import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1795694400000, { type: 'slow' })
export class AddInconnectVoiceInboundSlowInstanceCommand implements SlowInstanceCommand {
  async runDataMigration(): Promise<void> {}

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      DROP CONSTRAINT "inconnectVoiceCall_direction_check",
      DROP CONSTRAINT "inconnectVoiceCall_result_check",
      ALTER COLUMN "actorMemberId" DROP NOT NULL,
      ADD COLUMN "inboundSessionId" uuid,
      ADD COLUMN "inboundDecision" text CHECK ("inboundDecision" IN ('accept', 'decline')),
      ADD COLUMN "inboundScreenedAt" timestamptz,
      ADD COLUMN "inboundDialSettled" boolean NOT NULL DEFAULT false,
      ADD COLUMN "answeredMemberId" uuid,
      ADD CONSTRAINT "inconnectVoiceCall_direction_check" CHECK (direction IN ('outbound', 'inbound')),
      ADD CONSTRAINT "inconnectVoiceCall_result_check"
        CHECK (result IN ('answered', 'no-answer', 'busy', 'canceled', 'failed', 'declined')),
      ADD CONSTRAINT "CHK_inconnectVoiceCall_actor"
        CHECK ("actorMemberId" IS NOT NULL OR (direction = 'inbound' AND status = 'finished')),
      ADD CONSTRAINT "CHK_inconnectVoiceCall_inboundSession"
        CHECK ("inboundSessionId" IS NULL OR (direction = 'inbound' AND "actorMemberId" IS NOT NULL AND "recordId" IS NOT NULL)),
      ADD CONSTRAINT "CHK_inconnectVoiceCall_inboundAnswer"
        CHECK ("answeredMemberId" IS NULL OR (
          direction = 'inbound' AND result IS NOT DISTINCT FROM 'answered'
          AND "answeredMemberId" IS NOT DISTINCT FROM "actorMemberId" AND "inboundScreenedAt" IS NOT NULL
        ))`);
    await queryRunner.query(`DO $migration$
      DECLARE old_check text;
      BEGIN
        SELECT conname INTO STRICT old_check FROM pg_constraint
        WHERE conrelid = 'core."inconnectVoiceCallLeg"'::regclass AND contype = 'c'
          AND conkey @> ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = conrelid AND attname = 'kind'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = conrelid AND attname = 'parentCallSid')
          ]::smallint[] AND cardinality(conkey) = 2;
        EXECUTE format('ALTER TABLE core."inconnectVoiceCallLeg" DROP CONSTRAINT %I', old_check);
      END $migration$`);
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCallLeg"
      DROP CONSTRAINT "inconnectVoiceCallLeg_kind_check",
      ADD CONSTRAINT "inconnectVoiceCallLeg_kind_check"
        CHECK (kind IN ('browser', 'destination', 'caller', 'browser-inbound')),
      ADD CONSTRAINT "CHK_inconnectVoiceCallLeg_topology"
        CHECK ((kind IN ('browser', 'caller')) = ("parentCallSid" IS NULL))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The restored direction constraint refuses reversal while inbound history exists.
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      DROP CONSTRAINT "CHK_inconnectVoiceCall_actor",
      DROP CONSTRAINT "CHK_inconnectVoiceCall_inboundSession",
      DROP CONSTRAINT "CHK_inconnectVoiceCall_inboundAnswer",
      DROP CONSTRAINT "inconnectVoiceCall_direction_check",
      DROP CONSTRAINT "inconnectVoiceCall_result_check",
      ADD CONSTRAINT "inconnectVoiceCall_direction_check" CHECK (direction = 'outbound'),
      ADD CONSTRAINT "inconnectVoiceCall_result_check" CHECK (result IN ('answered', 'no-answer', 'busy', 'canceled', 'failed')),
      ALTER COLUMN "actorMemberId" SET NOT NULL,
      DROP COLUMN "inboundSessionId",
      DROP COLUMN "inboundDecision",
      DROP COLUMN "inboundScreenedAt",
      DROP COLUMN "inboundDialSettled",
      DROP COLUMN "answeredMemberId"`);
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCallLeg"
      DROP CONSTRAINT "CHK_inconnectVoiceCallLeg_topology",
      DROP CONSTRAINT "inconnectVoiceCallLeg_kind_check",
      ADD CONSTRAINT "inconnectVoiceCallLeg_kind_check" CHECK (kind IN ('browser', 'destination')),
      ADD CONSTRAINT "inconnectVoiceCallLeg_topology_check" CHECK ((kind = 'browser') = ("parentCallSid" IS NULL))`);
  }
}
