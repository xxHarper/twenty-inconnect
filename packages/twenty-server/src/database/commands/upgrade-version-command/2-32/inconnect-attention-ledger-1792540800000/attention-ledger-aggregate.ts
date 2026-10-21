export const ATTENTION_LEDGER_AGGREGATE_GUARDS: readonly string[] = [
  `CREATE FUNCTION core.im_at_conversation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE epoch record; gate record;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD."attentionTrackingEpochId" IS NOT NULL THEN
         RAISE EXCEPTION 'prepared conversation retained' USING ERRCODE = '23514'; END IF;
       RETURN OLD;
     ELSIF TG_OP = 'INSERT' THEN
       IF NEW."attentionTrackingEpochId" IS NOT NULL OR NEW."attentionStatus" IS NOT NULL OR NEW."attentionRevision" IS NOT NULL THEN
         RAISE EXCEPTION 'conversation must exist before explicit bootstrap' USING ERRCODE = '23514'; END IF;
       RETURN NEW;
     END IF;
     IF OLD."attentionTrackingEpochId" IS NOT NULL AND
       ROW(NEW."id",NEW."workspaceId",NEW."providerConnectionId",NEW."attentionTrackingEpochId") IS DISTINCT FROM
       ROW(OLD."id",OLD."workspaceId",OLD."providerConnectionId",OLD."attentionTrackingEpochId") THEN
       RAISE EXCEPTION 'prepared conversation scope is immutable' USING ERRCODE = '23514'; END IF;
     IF ROW(NEW."attentionTrackingEpochId",NEW."attentionStatus",NEW."attentionRevision",NEW."pendingAt") IS NOT DISTINCT FROM
       ROW(OLD."attentionTrackingEpochId",OLD."attentionStatus",OLD."attentionRevision",OLD."pendingAt") THEN RETURN NEW; END IF;
     IF OLD."attentionTrackingEpochId" IS NULL AND NEW."attentionTrackingEpochId" IS NULL THEN
       SELECT * INTO gate FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = NEW."workspaceId" FOR SHARE;
       IF gate."attentionTrackingMode" = 'ENABLED' THEN
         RAISE EXCEPTION 'unprepared attention scope not ready' USING ERRCODE = '23514'; END IF;
       RETURN NEW;
     END IF;
     IF OLD."attentionTrackingEpochId" IS NULL THEN
       PERFORM core.im_at_lock(NEW."workspaceId",NEW."id",NEW."providerConnectionId",NEW."attentionTrackingEpochId",false);
       SELECT * INTO STRICT epoch FROM core."inconnectMessagingAttentionEpoch" WHERE "id" = NEW."attentionTrackingEpochId";
       IF NOT core.im_at_own_write(epoch."attentionCreatedTransactionId") THEN
         RAISE EXCEPTION 'bootstrap epoch must be created atomically' USING ERRCODE = '23514'; END IF;
       IF NEW."attentionStatus" IS DISTINCT FROM epoch."bootstrapStatus" OR NEW."attentionRevision" IS DISTINCT FROM '0' OR
         NEW."pendingAt" IS DISTINCT FROM OLD."pendingAt" OR NEW."pendingAt" IS DISTINCT FROM epoch."bootstrapPendingAt" THEN
         RAISE EXCEPTION 'bootstrap cannot reinterpret pending history' USING ERRCODE = '23514'; END IF;
       RETURN NEW;
     END IF;
     PERFORM core.im_at_lock(NEW."workspaceId",NEW."id",NEW."providerConnectionId",NEW."attentionTrackingEpochId",true);
     IF NEW."attentionRevision" IS DISTINCT FROM core.im_at_next_revision(OLD."attentionRevision") OR NOT EXISTS (
       SELECT 1 FROM core."inconnectMessagingAttentionTransitionAudit" audit WHERE audit."workspaceId" = NEW."workspaceId"
         AND audit."conversationId" = NEW."id" AND audit."providerConnectionId" = NEW."providerConnectionId"
         AND audit."trackingEpochId" = NEW."attentionTrackingEpochId" AND core.im_at_own_write(audit."attentionCreatedTransactionId")
         AND audit."result" #> '{audit,attentionChanged}' = 'true'::jsonb
         AND audit."result" #> '{audit,before}' = jsonb_build_object('status',OLD."attentionStatus",'revision',OLD."attentionRevision")
         AND audit."result" #> '{audit,after}' = jsonb_build_object('status',NEW."attentionStatus",'revision',NEW."attentionRevision")
     ) THEN RAISE EXCEPTION 'attention mutation requires matching new audit' USING ERRCODE = '23514'; END IF;
     IF NEW."attentionStatus" = 'PENDING' THEN
       IF OLD."pendingAt" IS NULL THEN NEW."pendingAt" := statement_timestamp();
       ELSIF NEW."pendingAt" IS DISTINCT FROM OLD."pendingAt" THEN
         RAISE EXCEPTION 'pending period start is preserved' USING ERRCODE = '23514'; END IF;
     ELSIF NEW."pendingAt" IS NOT NULL THEN
       RAISE EXCEPTION 'attended must clear pending timestamp' USING ERRCODE = '23514';
     END IF;
     RETURN NEW;
   EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'bootstrap epoch missing' USING ERRCODE = '23514';
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_epoch_complete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM core."inconnectMessagingConversation" conversation WHERE conversation."id" = NEW."conversationId"
       AND conversation."workspaceId" = NEW."workspaceId" AND conversation."providerConnectionId" = NEW."providerConnectionId"
       AND conversation."attentionTrackingEpochId" = NEW."id") THEN
       RAISE EXCEPTION 'epoch requires atomic conversation pointer' USING ERRCODE = '23514'; END IF;
     RETURN NULL;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_outbox_key(workspace_id uuid, conversation_id uuid, connection_id uuid, epoch_id uuid, effect_key text)
   RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
     SELECT core.im_at_compact(jsonb_build_array('attention-outbox-v1',workspace_id::text,conversation_id::text,
       connection_id::text,epoch_id::text,effect_key,'CONVERSATION_ATTENTION_CHANGED'))
   $fn$`,
  `CREATE FUNCTION core.im_at_audit_complete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE conversation record; receipt record; effect record; epoch record; outcome text := NEW."result"->>'kind';
     audit jsonb := NEW."result"->'audit'; output_key text;
   BEGIN
     PERFORM core.im_at_lock(NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."trackingEpochId",true);
     SELECT * INTO STRICT conversation FROM core."inconnectMessagingConversation" WHERE "id" = NEW."conversationId";
     SELECT * INTO STRICT epoch FROM core."inconnectMessagingAttentionEpoch" WHERE "id" = NEW."trackingEpochId";
     IF audit->'after' IS DISTINCT FROM jsonb_build_object('status',conversation."attentionStatus",'revision',conversation."attentionRevision") OR
       (audit #>> '{before,revision}' = '0' AND audit #>> '{before,status}' <> epoch."bootstrapStatus") THEN
       RAISE EXCEPTION 'audit does not describe committed aggregate' USING ERRCODE = '23514'; END IF;
     IF outcome = 'CONFLICT' THEN
       IF EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEffect" WHERE "conversationId" = NEW."conversationId" AND core.im_at_own_write("attentionCreatedTransactionId")) OR
         EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionReceipt" WHERE "conversationId" = NEW."conversationId" AND core.im_at_own_write("attentionCreatedTransactionId")) OR
         EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionResponseIntent" WHERE "conversationId" = NEW."conversationId" AND core.im_at_own_write("attentionCreatedTransactionId")) THEN
         RAISE EXCEPTION 'conflict cannot consume ledger keys' USING ERRCODE = '23514'; END IF;
     ELSE
       SELECT * INTO STRICT receipt FROM core."inconnectMessagingAttentionReceipt" WHERE "workspaceId" = NEW."workspaceId"
         AND "conversationId" = NEW."conversationId" AND "providerConnectionId" = NEW."providerConnectionId"
         AND "trackingEpochId" = NEW."trackingEpochId" AND "eventKey" = NEW."eventKey";
       SELECT * INTO STRICT effect FROM core."inconnectMessagingAttentionEffect" WHERE "id" = receipt."effectId";
       IF effect."effectKey" <> NEW."effectKey" OR effect."fingerprint" <> NEW."fingerprint" THEN
         RAISE EXCEPTION 'audit consumption identity differs' USING ERRCODE = '23514'; END IF;
       IF outcome IN ('APPLIED','IGNORED') THEN
         IF receipt."originalAuditId" <> NEW."id" OR effect."canonicalReceiptId" <> receipt."id" OR
           NOT core.im_at_own_write(receipt."attentionCreatedTransactionId") OR NOT core.im_at_own_write(effect."attentionCreatedTransactionId") THEN
           RAISE EXCEPTION 'new effect requires own canonical original' USING ERRCODE = '23514'; END IF;
       ELSIF NEW."result"->>'reason' = 'SAME_INTENTION_OR_EVIDENCE' THEN
         IF receipt."originalAuditId" <> NEW."id" OR NOT core.im_at_own_write(receipt."attentionCreatedTransactionId") THEN
           RAISE EXCEPTION 'alias requires own original' USING ERRCODE = '23514'; END IF;
       ELSIF receipt."originalAuditId" = NEW."id" THEN
         RAISE EXCEPTION 'same event replay preserves earlier original' USING ERRCODE = '23514';
       END IF;
     END IF;
     output_key := core.im_at_outbox_key(NEW."workspaceId",NEW."conversationId",NEW."providerConnectionId",NEW."trackingEpochId",NEW."effectKey");
     IF audit->'attentionChanged' = 'true'::jsonb THEN
       IF NOT EXISTS (SELECT 1 FROM core."inconnectMessagingOutboxEvent" output WHERE output."deduplicationKey" = output_key
         AND output."workspaceId" = NEW."workspaceId" AND output."aggregateType" = 'CONVERSATION'
         AND output."aggregateId" = NEW."conversationId" AND output."eventType" = 'CONVERSATION_ATTENTION_CHANGED'
         AND output."immutablePayload" = jsonb_build_object('conversationId',NEW."conversationId"::text) AND core.im_at_own_write(output."attentionCreatedTransactionId")) THEN
         RAISE EXCEPTION 'attention change requires atomic durable output' USING ERRCODE = '23514'; END IF;
     ELSIF EXISTS (SELECT 1 FROM core."inconnectMessagingOutboxEvent" output WHERE output."deduplicationKey" = output_key AND core.im_at_own_write(output."attentionCreatedTransactionId")) THEN
       RAISE EXCEPTION 'unchanged attention cannot emit output' USING ERRCODE = '23514';
     END IF;
     RETURN NULL;
   EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'incomplete attention audit delta' USING ERRCODE = '23514';
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_message_complete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF NEW."attentionTrackingEpochId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM core."inconnectMessagingAttentionEffect" effect WHERE effect."messageId" = NEW."id"
         AND effect."workspaceId" = NEW."workspaceId" AND effect."conversationId" = NEW."conversationId"
         AND effect."providerConnectionId" = NEW."providerConnectionId" AND effect."trackingEpochId" = NEW."attentionTrackingEpochId"
         AND effect."eventKind" = CASE WHEN NEW."direction" = 'INBOUND' THEN 'INBOUND_RECEIVED' ELSE 'RESPONSE_INTENDED' END
         AND core.im_at_own_write(effect."attentionCreatedTransactionId")
     ) THEN RAISE EXCEPTION 'tracked message requires atomic original effect' USING ERRCODE = '23514'; END IF;
     RETURN NULL;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_effect_complete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE message record; status record;
   BEGIN
     IF NEW."messageId" IS NOT NULL THEN
       SELECT * INTO STRICT message FROM core."inconnectMessagingMessage" WHERE "id" = NEW."messageId" FOR SHARE;
       IF NEW."eventKind" = 'PROVIDER_EVIDENCE' THEN
         IF NOT core.im_at_own_write(message."attentionUpdatedTransactionId") THEN
           RAISE EXCEPTION 'new evidence requires atomic message update' USING ERRCODE = '23514'; END IF;
       ELSIF NOT core.im_at_own_write(message."attentionCreatedTransactionId") THEN
         RAISE EXCEPTION 'new attention cause requires atomic message creation' USING ERRCODE = '23514'; END IF;
       IF NEW."eventKind" = 'PROVIDER_EVIDENCE' THEN
         SELECT * INTO STRICT status FROM core."inconnectMessagingProviderStatusEvent" WHERE "id" = NEW."providerStatusEventId" FOR SHARE;
         IF NOT core.im_at_own_write(status."attentionCreatedTransactionId") OR status."normalizedStatus" IS DISTINCT FROM message."outboundState" THEN
           RAISE EXCEPTION 'new evidence requires atomic admitted outbound progress' USING ERRCODE = '23514'; END IF;
       END IF;
     END IF;
     RETURN NULL;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_outbox_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF TG_OP = 'TRUNCATE' THEN
       IF EXISTS (SELECT 1 FROM core."inconnectMessagingOutboxEvent" WHERE "eventType" = 'CONVERSATION_ATTENTION_CHANGED') THEN
         RAISE EXCEPTION 'attention output retention requires separate procedure' USING ERRCODE = '23514'; END IF;
       RETURN NULL;
     END IF;
     IF TG_OP = 'INSERT' THEN
       NEW."attentionCreatedTransactionId" := pg_current_xact_id()::text;
       RETURN NEW;
     END IF;
     IF TG_OP = 'DELETE' THEN
       IF OLD."eventType" = 'CONVERSATION_ATTENTION_CHANGED' THEN
         RAISE EXCEPTION 'attention output retention requires separate procedure' USING ERRCODE = '23514'; END IF;
       RETURN OLD;
     END IF;
     IF NEW."attentionCreatedTransactionId" IS DISTINCT FROM OLD."attentionCreatedTransactionId" THEN
       RAISE EXCEPTION 'output creation transaction is immutable' USING ERRCODE = '23514'; END IF;
     IF (OLD."eventType" = 'CONVERSATION_ATTENTION_CHANGED' OR NEW."eventType" = 'CONVERSATION_ATTENTION_CHANGED') AND
       ROW(NEW."id",NEW."workspaceId",NEW."aggregateType",NEW."aggregateId",NEW."eventType",NEW."immutablePayload",NEW."deduplicationKey") IS DISTINCT FROM
       ROW(OLD."id",OLD."workspaceId",OLD."aggregateType",OLD."aggregateId",OLD."eventType",OLD."immutablePayload",OLD."deduplicationKey") THEN
       RAISE EXCEPTION 'attention output identity is immutable' USING ERRCODE = '23514'; END IF;
     RETURN NEW;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_outbox_complete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   BEGIN
     IF NEW."eventType" = 'CONVERSATION_ATTENTION_CHANGED' AND NOT EXISTS (
       SELECT 1 FROM core."inconnectMessagingAttentionTransitionAudit" audit WHERE audit."workspaceId" = NEW."workspaceId"
         AND audit."conversationId" = NEW."aggregateId" AND NEW."aggregateType" = 'CONVERSATION'
         AND audit."result" #> '{audit,attentionChanged}' = 'true'::jsonb AND core.im_at_own_write(audit."attentionCreatedTransactionId")
         AND NEW."immutablePayload" = jsonb_build_object('conversationId',NEW."aggregateId"::text)
         AND NEW."deduplicationKey" = core.im_at_outbox_key(audit."workspaceId",audit."conversationId",audit."providerConnectionId",audit."trackingEpochId",audit."effectKey")
     ) THEN RAISE EXCEPTION 'attention output needs matching new change' USING ERRCODE = '23514'; END IF;
     RETURN NULL;
   END
   $fn$`,
];

export const ATTENTION_LEDGER_AGGREGATE_GUARDS_DOWN: readonly string[] = [
  'DROP FUNCTION core.im_at_outbox_complete()',
  'DROP FUNCTION core.im_at_outbox_guard()',
  'DROP FUNCTION core.im_at_effect_complete()',
  'DROP FUNCTION core.im_at_message_complete()',
  'DROP FUNCTION core.im_at_audit_complete()',
  'DROP FUNCTION core.im_at_outbox_key(uuid,uuid,uuid,uuid,text)',
  'DROP FUNCTION core.im_at_epoch_complete()',
  'DROP FUNCTION core.im_at_conversation_guard()',
];
