export const ATTENTION_LEDGER_ROW_GUARDS: readonly string[] = [
  `CREATE FUNCTION core.im_at_own_write(transaction_id text) RETURNS boolean
   LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(transaction_id::xid8 = pg_current_xact_id(), false)
   $fn$`,
  `CREATE FUNCTION core.im_at_lock(workspace_id uuid, conversation_id uuid, connection_id uuid, epoch_id uuid, require_ready boolean)
   RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE gate record; conversation record;
   BEGIN
     SELECT * INTO gate FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = workspace_id FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'attention gate missing' USING ERRCODE = '23514'; END IF;
     SELECT * INTO conversation FROM core."inconnectMessagingConversation"
       WHERE "id" = conversation_id AND "workspaceId" = workspace_id AND "providerConnectionId" = connection_id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'attention scope missing' USING ERRCODE = '23514'; END IF;
     IF require_ready THEN
       IF gate."attentionTrackingMode" <> 'ENABLED' OR gate."attentionWriterProtocolVersion" IS DISTINCT FROM 1 OR
         conversation."attentionTrackingEpochId" IS DISTINCT FROM epoch_id OR NOT EXISTS (
           SELECT 1 FROM core."inconnectMessagingAttentionEpoch" WHERE "id" = epoch_id AND "workspaceId" = workspace_id
             AND "conversationId" = conversation_id AND "providerConnectionId" = connection_id AND "lifecycle" = 'READY'
         ) THEN RAISE EXCEPTION 'attention not ready' USING ERRCODE = '23514'; END IF;
     ELSIF gate."attentionTrackingMode" NOT IN ('PREPARING','ENABLED','SUSPENDED') THEN
       RAISE EXCEPTION 'attention preparation disabled' USING ERRCODE = '23514';
     END IF;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN RAISE EXCEPTION 'attention history is immutable' USING ERRCODE = '23514'; END
   $fn$`,
  `CREATE FUNCTION core.im_at_configuration_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF TG_OP = 'TRUNCATE' THEN
       IF EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEpoch") THEN
         RAISE EXCEPTION 'attention gate retained with epochs' USING ERRCODE = '23514'; END IF;
       RETURN NULL;
     END IF;
     IF TG_OP IN ('DELETE','UPDATE') AND EXISTS (
       SELECT 1 FROM core."inconnectMessagingAttentionEpoch" WHERE "workspaceId" = OLD."workspaceId"
     ) THEN
       IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'attention gate retained with epochs' USING ERRCODE = '23514'; END IF;
       IF NEW."workspaceId" <> OLD."workspaceId" OR NEW."attentionTrackingMode" = 'DISABLED' THEN
         RAISE EXCEPTION 'attention gate cannot erase prepared scope' USING ERRCODE = '23514'; END IF;
     END IF;
     IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
     IF NEW."attentionGateUpdatedAt" IS NOT NULL AND NOT isfinite(NEW."attentionGateUpdatedAt") THEN
       RAISE EXCEPTION 'invalid attention gate timestamp' USING ERRCODE = '23514'; END IF;
     IF (TG_OP = 'INSERT' AND NEW."attentionTrackingMode" <> 'DISABLED') OR
       (TG_OP = 'UPDATE' AND ROW(NEW."attentionTrackingMode",NEW."attentionWriterProtocolVersion") IS DISTINCT FROM
         ROW(OLD."attentionTrackingMode",OLD."attentionWriterProtocolVersion")) THEN
       IF NEW."attentionGateUpdatedAt" IS NULL THEN
         RAISE EXCEPTION 'explicit attention gate change needs timestamp' USING ERRCODE = '23514'; END IF;
     END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE conversation record;
   BEGIN
     IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'attention epoch retained' USING ERRCODE = '23514'; END IF;
     PERFORM core.im_at_lock(NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."id",false);
     IF TG_OP = 'UPDATE' THEN
       IF (to_jsonb(NEW) - ARRAY['lifecycle','activatedAt','closedAt']) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['lifecycle','activatedAt','closedAt']) OR
          (OLD."lifecycle" = 'CLOSED' AND NEW IS DISTINCT FROM OLD) OR
          (OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt") OR
          (OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt") THEN
         RAISE EXCEPTION 'attention epoch history is immutable' USING ERRCODE = '23514'; END IF;
     ELSE
       NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;
       IF NOT EXISTS (SELECT 1 FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = NEW."workspaceId"
         AND "attentionTrackingMode" IN ('PREPARING','ENABLED')) THEN
         RAISE EXCEPTION 'bootstrap requires explicit preparation gate' USING ERRCODE = '23514'; END IF;
       SELECT * INTO STRICT conversation FROM core."inconnectMessagingConversation" WHERE "id" = NEW."conversationId";
       IF conversation."attentionTrackingEpochId" IS NOT NULL OR NEW."bootstrapRevision" <> '0' OR
         NEW."bootstrapPendingAt" IS DISTINCT FROM conversation."pendingAt" OR
         (NEW."bootstrapStatus" = 'PENDING') <> (conversation."pendingAt" IS NOT NULL) THEN
         RAISE EXCEPTION 'attention bootstrap must preserve original pending' USING ERRCODE = '23514'; END IF;
     END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE conversation record;
   BEGIN
     NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;
     PERFORM core.im_at_lock(NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."trackingEpochId",true);
     IF TG_TABLE_NAME = 'inconnectMessagingAttentionTransitionAudit' THEN
       SELECT * INTO STRICT conversation FROM core."inconnectMessagingConversation" WHERE "id" = NEW."conversationId";
       IF NEW."result" #> '{audit,before}' IS DISTINCT FROM jsonb_build_object(
         'status',conversation."attentionStatus",'revision',conversation."attentionRevision") OR EXISTS (
         SELECT 1 FROM core."inconnectMessagingAttentionTransitionAudit" WHERE "workspaceId" = NEW."workspaceId"
           AND "conversationId" = NEW."conversationId" AND core.im_at_own_write("attentionCreatedTransactionId")
       ) THEN RAISE EXCEPTION 'attention audit requires current snapshot and one event per transaction' USING ERRCODE = '23514'; END IF;
     END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE gate record; conversation record;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD."attentionTrackingEpochId" IS NOT NULL THEN
         RAISE EXCEPTION 'tracked message identity retained' USING ERRCODE = '23514'; END IF;
       RETURN OLD;
     ELSIF TG_OP = 'UPDATE' THEN
       IF NEW."attentionCreatedTransactionId" IS DISTINCT FROM OLD."attentionCreatedTransactionId" THEN
         RAISE EXCEPTION 'message creation transaction is immutable' USING ERRCODE = '23514'; END IF;
       NEW."attentionUpdatedTransactionId" := pg_current_xact_id()::text;
       IF NEW."attentionTrackingEpochId" IS DISTINCT FROM OLD."attentionTrackingEpochId" OR
         (OLD."attentionTrackingEpochId" IS NOT NULL AND ROW(NEW."id",NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."direction",NEW."sendMode")
           IS DISTINCT FROM ROW(OLD."id",OLD."workspaceId",OLD."conversationId",OLD."providerConnectionId",OLD."direction",OLD."sendMode")) THEN
         RAISE EXCEPTION 'message origin epoch is immutable, including null' USING ERRCODE = '23514'; END IF;
       IF NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId" AND EXISTS (
         SELECT 1 FROM core."inconnectMessagingAttentionEffect" WHERE "messageId" = OLD."id" AND "eventKind" = 'PROVIDER_EVIDENCE'
       ) THEN RAISE EXCEPTION 'attention provider correlation is immutable' USING ERRCODE = '23514'; END IF;
       RETURN NEW;
     END IF;
     NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;
     NEW."attentionUpdatedTransactionId" := NULL;
     SELECT * INTO gate FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = NEW."workspaceId" FOR SHARE;
     SELECT * INTO conversation FROM core."inconnectMessagingConversation" WHERE "id" = NEW."conversationId"
       AND "workspaceId" = NEW."workspaceId" AND "providerConnectionId" = NEW."providerConnectionId" FOR UPDATE;
     IF NEW."attentionTrackingEpochId" IS NULL THEN
       IF gate."attentionTrackingMode" = 'ENABLED' OR conversation."attentionTrackingEpochId" IS NOT NULL THEN
         RAISE EXCEPTION 'legacy insert fenced in prepared scope' USING ERRCODE = '23514'; END IF;
     ELSE
       PERFORM core.im_at_lock(NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."attentionTrackingEpochId",true);
     END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF TG_OP = 'INSERT' THEN
       NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;
       RETURN NEW;
     ELSIF TG_OP = 'UPDATE' AND NEW."attentionCreatedTransactionId" IS DISTINCT FROM OLD."attentionCreatedTransactionId" THEN
       RAISE EXCEPTION 'status creation transaction is immutable' USING ERRCODE = '23514'; END IF;
     IF EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEffect" WHERE "providerStatusEventId" = OLD."id") AND
       (TG_OP = 'DELETE' OR ROW(NEW."id",NEW."workspaceId",NEW."messageId",NEW."webhookReceiptId",NEW."providerEventKey",NEW."originalStatus",NEW."normalizedStatus",NEW."appliedToProjection")
         IS DISTINCT FROM ROW(OLD."id",OLD."workspaceId",OLD."messageId",OLD."webhookReceiptId",OLD."providerEventKey",OLD."originalStatus",OLD."normalizedStatus",OLD."appliedToProjection")) THEN
       RAISE EXCEPTION 'attention status evidence is immutable' USING ERRCODE = '23514'; END IF;
     IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_webhook_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF ROW(NEW."id",NEW."workspaceId",NEW."providerConnectionId",NEW."eventKind") IS DISTINCT FROM
       ROW(OLD."id",OLD."workspaceId",OLD."providerConnectionId",OLD."eventKind") AND EXISTS (
         SELECT 1 FROM core."inconnectMessagingProviderStatusEvent" status
           JOIN core."inconnectMessagingAttentionEffect" effect ON effect."providerStatusEventId" = status."id"
           WHERE status."webhookReceiptId" = OLD."id"
       ) THEN RAISE EXCEPTION 'attention webhook correlation is immutable' USING ERRCODE = '23514'; END IF;
     RETURN NEW;
   END
   $fn$`,
];

export const ATTENTION_LEDGER_ROW_GUARDS_DOWN: readonly string[] = [
  'DROP FUNCTION core.im_at_webhook_guard()',
  'DROP FUNCTION core.im_at_status_guard()',
  'DROP FUNCTION core.im_at_message_guard()',
  'DROP FUNCTION core.im_at_insert_guard()',
  'DROP FUNCTION core.im_at_epoch_guard()',
  'DROP FUNCTION core.im_at_configuration_guard()',
  'DROP FUNCTION core.im_at_immutable()',
  'DROP FUNCTION core.im_at_lock(uuid,uuid,uuid,uuid,boolean)',
  'DROP FUNCTION core.im_at_own_write(text)',
];
