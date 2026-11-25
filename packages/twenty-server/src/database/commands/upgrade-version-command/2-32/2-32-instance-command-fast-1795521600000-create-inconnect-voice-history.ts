import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

export const INCONNECT_VOICE_HISTORY_UP = [
  `CREATE TABLE core."inconnectVoiceCall" (
    id uuid PRIMARY KEY,
    "workspaceId" uuid NOT NULL REFERENCES core.workspace (id),
    "objectMetadataId" uuid NOT NULL,
    "recordId" uuid NOT NULL,
    "actorMemberId" uuid NOT NULL,
    "actorLabel" text NOT NULL,
    direction text NOT NULL CHECK (direction = 'outbound'),
    "accountSid" text NOT NULL,
    "applicationSid" text NOT NULL,
    "callerId" text NOT NULL,
    destination text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
    "expiresAt" timestamptz NOT NULL,
    "startedAt" timestamptz,
    "answeredAt" timestamptz,
    "endedAt" timestamptz,
    "durationSeconds" integer CHECK ("durationSeconds" >= 0),
    status text NOT NULL DEFAULT 'reserved'
      CHECK (status IN ('reserved', 'connecting', 'ringing', 'answered', 'finished')),
    result text CHECK (result IN ('answered', 'no-answer', 'busy', 'canceled', 'failed')),
    "technicalError" text CHECK ("technicalError" IN ('reservation-expired', 'routing-denied', 'provider-failed')),
    "nextReconcileAt" timestamptz,
    "reconcileAttempts" integer NOT NULL DEFAULT 0 CHECK ("reconcileAttempts" >= 0),
    UNIQUE (id, "accountSid"),
    FOREIGN KEY ("objectMetadataId", "workspaceId") REFERENCES core."objectMetadata" (id, "workspaceId"),
    CHECK ((status = 'finished') = (result IS NOT NULL)),
    CHECK ("durationSeconds" IS NULL OR result IS NOT DISTINCT FROM 'answered')
  )`,
  `CREATE UNIQUE INDEX "IDX_inconnectVoiceCall_activeActor" ON core."inconnectVoiceCall"
    ("workspaceId", "actorMemberId") WHERE status <> 'finished'`,
  `CREATE INDEX "IDX_inconnectVoiceCall_recordHistory" ON core."inconnectVoiceCall"
    ("workspaceId", "objectMetadataId", "recordId", "createdAt" DESC, id DESC)`,
  `CREATE TABLE core."inconnectVoiceCallLeg" (
    "callId" uuid NOT NULL,
    "accountSid" text NOT NULL,
    "providerCallSid" text NOT NULL,
    "parentCallSid" text,
    kind text NOT NULL CHECK (kind IN ('browser', 'destination')),
    PRIMARY KEY ("accountSid", "providerCallSid"),
    UNIQUE ("callId", kind),
    UNIQUE ("callId", "accountSid", "providerCallSid"),
    FOREIGN KEY ("callId", "accountSid") REFERENCES core."inconnectVoiceCall" (id, "accountSid"),
    FOREIGN KEY ("callId", "accountSid", "parentCallSid")
      REFERENCES core."inconnectVoiceCallLeg" ("callId", "accountSid", "providerCallSid"),
    CHECK ((kind = 'browser') = ("parentCallSid" IS NULL)),
    CHECK ("providerCallSid" <> "parentCallSid")
  )`,
] as const;

@RegisteredInstanceCommand('2.32.0', 1795521600000)
export class CreateInconnectVoiceHistoryFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of INCONNECT_VOICE_HISTORY_UP) {
      await queryRunner.query(statement);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE core."inconnectVoiceCallLeg"');
    await queryRunner.query('DROP TABLE core."inconnectVoiceCall"');
  }
}
