import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1795780800000, { type: 'slow' })
export class AddInconnectVoiceDistributionSlowInstanceCommand implements SlowInstanceCommand {
  async runDataMigration(): Promise<void> {}

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      DROP CONSTRAINT "CHK_inconnectVoiceCall_inboundSession",
      ADD COLUMN "distributionReason" text,
      ADD CONSTRAINT "CHK_inconnectVoiceCall_distribution"
        CHECK ("distributionReason" IS NULL OR direction = 'inbound'),
      ADD CONSTRAINT "CHK_inconnectVoiceCall_inboundSession"
        CHECK ("inboundSessionId" IS NULL OR (direction = 'inbound' AND "actorMemberId" IS NOT NULL
          AND ("recordId" IS NOT NULL OR "distributionReason" IS NOT NULL)))`);
    await queryRunner.query(`CREATE TABLE core."inconnectVoicePhoneCursor" (
      "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
      pool text NOT NULL,
      "lastMemberId" uuid,
      PRIMARY KEY ("workspaceId", pool)
    )`);
    await queryRunner.query(`CREATE TABLE core."inconnectVoiceInboundOffer" (
      id uuid PRIMARY KEY,
      "callId" uuid NOT NULL REFERENCES core."inconnectVoiceCall"(id),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
      "actorMemberId" uuid NOT NULL,
      "sessionId" uuid NOT NULL,
      pool text,
      "offeredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "endedAt" timestamptz,
      result text CHECK (result IN ('answered', 'no-answer', 'busy', 'canceled', 'failed', 'declined')),
      "durationSeconds" integer CHECK ("durationSeconds" >= 0),
      UNIQUE ("callId", id),
      UNIQUE ("callId", ordinal),
      UNIQUE ("callId", "actorMemberId"),
      CHECK (("endedAt" IS NULL) = (result IS NULL)),
      CHECK ("durationSeconds" IS NULL OR result IS NOT DISTINCT FROM 'answered')
    )`);
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCallLeg"
      DROP CONSTRAINT "inconnectVoiceCallLeg_callId_kind_key",
      ADD COLUMN "inboundOfferId" uuid,
      ADD CONSTRAINT "FK_inconnectVoiceLeg_offer"
        FOREIGN KEY ("callId", "inboundOfferId") REFERENCES core."inconnectVoiceInboundOffer"("callId", id),
      ADD CONSTRAINT "CHK_inconnectVoiceLeg_offer" CHECK ("inboundOfferId" IS NULL OR kind = 'browser-inbound')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_inconnectVoiceLeg_legacyKind"
      ON core."inconnectVoiceCallLeg" ("callId", kind) WHERE "inboundOfferId" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_inconnectVoiceLeg_offer"
      ON core."inconnectVoiceCallLeg" ("inboundOfferId") WHERE "inboundOfferId" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // A physical rollback must preserve all distribution history.
    await queryRunner.query(`DO $migration$ BEGIN
      IF EXISTS (SELECT FROM core."inconnectVoiceCall" WHERE "distributionReason" IS NOT NULL)
        OR EXISTS (SELECT FROM core."inconnectVoiceInboundOffer")
        OR EXISTS (SELECT FROM core."inconnectVoicePhoneCursor") THEN
        RAISE EXCEPTION 'Voice distribution history forbids reversal';
      END IF;
    END $migration$`);
    await queryRunner.query(`DROP INDEX core."IDX_inconnectVoiceLeg_offer", core."IDX_inconnectVoiceLeg_legacyKind"`);
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCallLeg"
      DROP CONSTRAINT "FK_inconnectVoiceLeg_offer", DROP CONSTRAINT "CHK_inconnectVoiceLeg_offer",
      DROP COLUMN "inboundOfferId", ADD CONSTRAINT "inconnectVoiceCallLeg_callId_kind_key" UNIQUE ("callId", kind)`);
    await queryRunner.query(`DROP TABLE core."inconnectVoiceInboundOffer", core."inconnectVoicePhoneCursor"`);
    await queryRunner.query(`ALTER TABLE core."inconnectVoiceCall"
      DROP CONSTRAINT "CHK_inconnectVoiceCall_inboundSession", DROP CONSTRAINT "CHK_inconnectVoiceCall_distribution",
      DROP COLUMN "distributionReason",
      ADD CONSTRAINT "CHK_inconnectVoiceCall_inboundSession"
        CHECK ("inboundSessionId" IS NULL OR (direction = 'inbound' AND "actorMemberId" IS NOT NULL AND "recordId" IS NOT NULL))`);
  }
}
