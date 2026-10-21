export const ATTENTION_LEDGER_LINK_GUARDS: readonly string[] = [
  `CREATE FUNCTION core.im_at_validate_effect(effect_id uuid) RETURNS void
   LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE effect record; receipt record; original record; epoch record;
     message record; intent record; status record; webhook record; audit jsonb; provenance jsonb;
   BEGIN
     SELECT * INTO STRICT effect FROM core."inconnectMessagingAttentionEffect" WHERE "id" = effect_id;
     SELECT * INTO STRICT receipt FROM core."inconnectMessagingAttentionReceipt" WHERE "id" = effect."canonicalReceiptId";
     SELECT * INTO STRICT original FROM core."inconnectMessagingAttentionTransitionAudit" WHERE "id" = receipt."originalAuditId";
     SELECT * INTO STRICT epoch FROM core."inconnectMessagingAttentionEpoch" WHERE "id" = effect."trackingEpochId";
     audit := original."result"->'audit';
     IF receipt."effectId" <> effect."id" OR
       ROW(receipt."workspaceId",receipt."conversationId",receipt."providerConnectionId",receipt."trackingEpochId") IS DISTINCT FROM
       ROW(effect."workspaceId",effect."conversationId",effect."providerConnectionId",effect."trackingEpochId") OR
       ROW(original."workspaceId",original."conversationId",original."providerConnectionId",original."trackingEpochId") IS DISTINCT FROM
       ROW(effect."workspaceId",effect."conversationId",effect."providerConnectionId",effect."trackingEpochId") OR
       ROW(original."eventKey",original."effectKey",original."fingerprint") IS DISTINCT FROM
       ROW(receipt."eventKey",effect."effectKey",effect."fingerprint") OR
       original."result"->>'kind' NOT IN ('APPLIED','IGNORED') OR audit->>'eventKind' <> effect."eventKind" OR
       audit->>'messageId' IS DISTINCT FROM effect."messageId"::text OR
       (audit #>> '{before,revision}' = epoch."bootstrapRevision" AND audit #>> '{before,status}' <> epoch."bootstrapStatus") OR
       (audit #>> '{after,revision}' = epoch."bootstrapRevision" AND audit #>> '{after,status}' <> epoch."bootstrapStatus") THEN
       RAISE EXCEPTION 'invalid attention canonical receipt or baseline' USING ERRCODE = '23514';
     END IF;
     IF effect."messageId" IS NOT NULL THEN
       SELECT * INTO STRICT message FROM core."inconnectMessagingMessage" WHERE "id" = effect."messageId" FOR SHARE;
       IF ROW(message."workspaceId",message."conversationId",message."providerConnectionId",message."attentionTrackingEpochId") IS DISTINCT FROM
         ROW(effect."workspaceId",effect."conversationId",effect."providerConnectionId",effect."trackingEpochId") OR
         message."direction" <> (CASE WHEN effect."eventKind" = 'INBOUND_RECEIVED' THEN 'INBOUND' ELSE 'OUTBOUND' END) THEN
         RAISE EXCEPTION 'invalid attention message cause' USING ERRCODE = '23514'; END IF;
     END IF;
     IF effect."responseIntentId" IS NOT NULL THEN
       SELECT * INTO STRICT intent FROM core."inconnectMessagingAttentionResponseIntent" WHERE
         "workspaceId" = effect."workspaceId" AND "conversationId" = effect."conversationId" AND
         "providerConnectionId" = effect."providerConnectionId" AND "trackingEpochId" = effect."trackingEpochId" AND "intentId" = effect."responseIntentId";
       provenance := jsonb_build_object('kind',intent."provenanceKind",'authorityReference',intent."authorityReference");
       IF intent."provenanceKind" = 'HUMAN' THEN
         provenance := provenance || jsonb_build_object('actorWorkspaceMemberId',intent."actorWorkspaceMemberId"::text); END IF;
       IF intent."messageId" <> message."id" OR intent."format" <> message."sendMode" OR
         audit->>'intentId' <> intent."intentId" OR audit->>'coveredRevision' <> intent."coveredRevision" OR
         audit->'provenance' IS DISTINCT FROM provenance THEN
         RAISE EXCEPTION 'invalid frozen attention intention' USING ERRCODE = '23514'; END IF;
       IF effect."eventKind" = 'RESPONSE_INTENDED' THEN
         IF intent."registeredEffectId" <> effect."id" OR original."result"->>'kind' <> 'APPLIED' OR
           original."result"->>'reason' <> 'RESPONSE_REGISTERED' OR effect."fingerprint" <> core.im_at_compact(jsonb_build_array(
             'RESPONSE_INTENDED',intent."intentId",intent."messageId"::text,intent."contentFingerprint",intent."coveredRevision",
             intent."format",intent."provenanceKind",intent."actorWorkspaceMemberId"::text,intent."authorityReference")) THEN
           RAISE EXCEPTION 'invalid attention intention registration' USING ERRCODE = '23514'; END IF;
       ELSE
         IF NOT EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEffect" registration WHERE
           registration."id" = intent."registeredEffectId" AND registration."eventKind" = 'RESPONSE_INTENDED' AND
           registration."responseIntentId" = intent."intentId") THEN
           RAISE EXCEPTION 'invalid causal registration kind' USING ERRCODE = '23514'; END IF;
         PERFORM core.im_at_validate_effect(intent."registeredEffectId");
       END IF;
     END IF;
     IF effect."eventKind" = 'PROVIDER_EVIDENCE' THEN
       SELECT * INTO STRICT status FROM core."inconnectMessagingProviderStatusEvent" WHERE "id" = effect."providerStatusEventId" FOR SHARE;
       IF status."workspaceId" <> effect."workspaceId" OR status."messageId" <> message."id" OR
         audit #>> '{evidence,providerMessageId}' IS DISTINCT FROM message."providerMessageId" OR
         audit #>> '{evidence,status}' IS DISTINCT FROM status."normalizedStatus" OR NOT status."appliedToProjection" THEN
         RAISE EXCEPTION 'invalid attention provider evidence' USING ERRCODE = '23514'; END IF;
       IF status."webhookReceiptId" IS NOT NULL THEN
         SELECT * INTO STRICT webhook FROM core."inconnectMessagingWebhookReceipt" WHERE "id" = status."webhookReceiptId" FOR SHARE;
         IF webhook."workspaceId" <> effect."workspaceId" OR webhook."providerConnectionId" <> effect."providerConnectionId" THEN
           RAISE EXCEPTION 'invalid attention webhook connection' USING ERRCODE = '23514'; END IF;
       END IF;
     END IF;
   EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'incomplete attention canonical cause' USING ERRCODE = '23514';
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
   DECLARE effect record; canonical_receipt record; canonical_audit record; original record; epoch record; canonical_state jsonb;
   BEGIN
     IF TG_TABLE_NAME = 'inconnectMessagingAttentionEffect' THEN
       PERFORM core.im_at_validate_effect(NEW."id");
     ELSIF TG_TABLE_NAME = 'inconnectMessagingAttentionResponseIntent' THEN
       PERFORM core.im_at_validate_effect(NEW."registeredEffectId");
       IF NOT EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEffect" WHERE "id" = NEW."registeredEffectId"
         AND "eventKind" = 'RESPONSE_INTENDED' AND "responseIntentId" = NEW."intentId") THEN
         RAISE EXCEPTION 'intention registration must be RESPONSE_INTENDED' USING ERRCODE = '23514'; END IF;
     ELSE
       PERFORM core.im_at_validate_effect(NEW."effectId");
       SELECT * INTO STRICT effect FROM core."inconnectMessagingAttentionEffect" WHERE "id" = NEW."effectId";
       SELECT * INTO STRICT canonical_receipt FROM core."inconnectMessagingAttentionReceipt" WHERE "id" = effect."canonicalReceiptId";
       SELECT * INTO STRICT canonical_audit FROM core."inconnectMessagingAttentionTransitionAudit" WHERE "id" = canonical_receipt."originalAuditId";
       SELECT * INTO STRICT original FROM core."inconnectMessagingAttentionTransitionAudit" WHERE "id" = NEW."originalAuditId";
       SELECT * INTO STRICT epoch FROM core."inconnectMessagingAttentionEpoch" WHERE "id" = NEW."trackingEpochId";
       IF ROW(original."eventKey",original."effectKey",original."fingerprint") IS DISTINCT FROM
         ROW(NEW."eventKey",effect."effectKey",effect."fingerprint") OR
         (original."result"->'audit' - ARRAY['eventKey','before','after','attentionChanged']) IS DISTINCT FROM
         (canonical_audit."result"->'audit' - ARRAY['eventKey','before','after','attentionChanged']) THEN
         RAISE EXCEPTION 'receipt original cause differs from canonical cause' USING ERRCODE = '23514'; END IF;
       IF NEW."id" <> effect."canonicalReceiptId" THEN
         IF original."result"->>'kind' <> 'DUPLICATE' OR original."result"->>'reason' <> 'SAME_INTENTION_OR_EVIDENCE' OR
           NEW."eventKey" = canonical_receipt."eventKey" OR
           core.im_at_compare_revision(original."result" #>> '{audit,before,revision}',canonical_audit."result" #>> '{audit,after,revision}') < 0 THEN
           RAISE EXCEPTION 'invalid alias own original' USING ERRCODE = '23514'; END IF;
         FOR canonical_state IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
           jsonb_build_object('status',epoch."bootstrapStatus",'revision',epoch."bootstrapRevision"),
           canonical_audit."result" #> '{audit,before}',canonical_audit."result" #> '{audit,after}')) LOOP
           IF canonical_state->>'revision' = original."result" #>> '{audit,before,revision}' AND
             canonical_state->>'status' <> original."result" #>> '{audit,before,status}' THEN
             RAISE EXCEPTION 'alias contradicts historical status at same revision' USING ERRCODE = '23514'; END IF;
         END LOOP;
       ELSIF original."id" <> canonical_audit."id" THEN
         RAISE EXCEPTION 'canonical original substitution' USING ERRCODE = '23514';
       END IF;
     END IF;
     RETURN NULL;
   EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'incomplete attention receipt links' USING ERRCODE = '23514';
   END
   $fn$`,
];

export const ATTENTION_LEDGER_LINK_GUARDS_DOWN: readonly string[] = [
  'DROP FUNCTION core.im_at_link_guard()',
  'DROP FUNCTION core.im_at_validate_effect(uuid)',
];
