import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// T1 integrity only. This trigger does not authenticate an INSERT or resist an
// arbitrary SQL writer using backend credentials. No default/backfill/promotion.
export const RECEIPT_INGRESS_UP: readonly string[] = [
  `ALTER TABLE core."inconnectMessagingWebhookReceipt" ADD COLUMN "ingressContractVersion" integer NULL`,
  `ALTER TABLE core."inconnectMessagingWebhookReceipt" ADD CONSTRAINT "CHK_IM_INGRESS_VERSION"
    CHECK ("ingressContractVersion" IS NULL OR "ingressContractVersion" = 1)`,
  `CREATE FUNCTION core.im_ingress_receipt_guard() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'receipt identity retained' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW."id",NEW."workspaceId",NEW."providerConnectionId",NEW."eventKind",
          NEW."idempotencyKey",NEW."payloadHash",NEW."firstReceivedAt",NEW."normalizedMetadata",NEW."ingressContractVersion")
          IS DISTINCT FROM
          ROW(OLD."id",OLD."workspaceId",OLD."providerConnectionId",OLD."eventKind",
          OLD."idempotencyKey",OLD."payloadHash",OLD."firstReceivedAt",OLD."normalizedMetadata",OLD."ingressContractVersion") THEN
          RAISE EXCEPTION 'receipt fact is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW."ingressContractVersion" IS NOT NULL AND (
        NEW."ingressContractVersion" = 1 AND NEW."eventKind" = 'INBOUND_MESSAGE'
        AND NEW."payloadHash" ~ '^[0-9a-f]{64}$'
        AND jsonb_typeof(NEW."normalizedMetadata") = 'object'
        AND NEW."normalizedMetadata"->>'kind' = 'INBOUND_MESSAGE'
        AND NEW."normalizedMetadata"->>'idempotencyKey' = NEW."idempotencyKey"
        AND NEW."normalizedMetadata"->>'providerMessageId' = NEW."idempotencyKey"
        AND NEW."normalizedMetadata"->>'serverReceivedAt' IS NOT NULL
        AND (NEW."normalizedMetadata"->>'serverReceivedAt')::timestamptz = NEW."firstReceivedAt"
        AND isfinite(NEW."firstReceivedAt")
      ) IS NOT TRUE THEN
        RAISE EXCEPTION 'invalid receipt contract' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$`,
  `CREATE FUNCTION core.im_ingress_receipt_truncate_guard() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
    BEGIN
      RAISE EXCEPTION 'receipt identities retained' USING ERRCODE = '23514';
    END
    $fn$`,
  `CREATE TRIGGER "TR_IM_INGRESS_RECEIPT_WRITE" BEFORE INSERT OR UPDATE OR DELETE
    ON core."inconnectMessagingWebhookReceipt" FOR EACH ROW EXECUTE FUNCTION core.im_ingress_receipt_guard()`,
  `CREATE TRIGGER "TR_IM_INGRESS_RECEIPT_TRUNCATE" BEFORE TRUNCATE
    ON core."inconnectMessagingWebhookReceipt" FOR EACH STATEMENT EXECUTE FUNCTION core.im_ingress_receipt_truncate_guard()`,
];

// Separately authorized destructive downgrade: loses durable provenance, never
// recreates it from historical facts. Existing receipts/ledger remain in place.
export const RECEIPT_INGRESS_DOWN: readonly string[] = [
  `DROP TRIGGER "TR_IM_INGRESS_RECEIPT_TRUNCATE" ON core."inconnectMessagingWebhookReceipt"`,
  `DROP TRIGGER "TR_IM_INGRESS_RECEIPT_WRITE" ON core."inconnectMessagingWebhookReceipt"`,
  `DROP FUNCTION core.im_ingress_receipt_truncate_guard()`,
  `DROP FUNCTION core.im_ingress_receipt_guard()`,
  `ALTER TABLE core."inconnectMessagingWebhookReceipt" DROP CONSTRAINT "CHK_IM_INGRESS_VERSION"`,
  `ALTER TABLE core."inconnectMessagingWebhookReceipt" DROP COLUMN "ingressContractVersion"`,
];

@RegisteredInstanceCommand('2.32.0', 1792666800000)
export class AddInconnectMessagingIngressContractFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of RECEIPT_INGRESS_UP)
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of RECEIPT_INGRESS_DOWN)
      await queryRunner.query(statement);
  }
}
