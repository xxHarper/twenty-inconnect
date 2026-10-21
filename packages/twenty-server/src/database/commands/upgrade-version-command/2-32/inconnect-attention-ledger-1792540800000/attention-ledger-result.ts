// Row-local verification only. No table is read from this CHECK function.
export const ATTENTION_LEDGER_RESULT_FUNCTION = `CREATE FUNCTION core.im_at_result_valid(
  result jsonb, event_key text, effect_key text, fingerprint text,
  workspace_id uuid, conversation_id uuid, connection_id uuid
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
DECLARE
  audit jsonb := result->'audit';
  before_state jsonb := audit->'before';
  after_state jsonb := audit->'after';
  provenance jsonb := audit->'provenance';
  evidence jsonb := audit->'evidence';
  tuple jsonb;
  expected_key jsonb;
  event_kind text := audit->>'eventKind';
  outcome text := result->>'kind';
  reason text := result->>'reason';
  expected_kind text;
  expected_reason text;
  expected_status text := before_state->>'status';
  covered text := audit->>'coveredRevision';
  before_revision text := before_state->>'revision';
  expected_revision text := before_revision;
BEGIN
  IF (core.im_at_keys(result,ARRAY['kind','reason','audit']) AND
    core.im_at_keys(audit,ARRAY['scope','eventKey','effectKey','eventKind','before','after','attentionChanged',
      'intentId','messageId','actorWorkspaceMemberId','coveredRevision','provenance','evidence','successPolicy']) AND
    core.im_at_keys(audit->'scope',ARRAY['workspaceId','conversationId','providerConnectionId']) AND
    audit->'scope' = jsonb_build_object('workspaceId',workspace_id::text,'conversationId',conversation_id::text,'providerConnectionId',connection_id::text) AND
    audit->'eventKey' = to_jsonb(event_key) AND audit->'effectKey' = to_jsonb(effect_key) AND
    audit->>'successPolicy' = 'PROPOSED_DELIVERED_OR_READ' AND
    core.im_at_keys(before_state,ARRAY['status','revision']) AND core.im_at_keys(after_state,ARRAY['status','revision']) AND
    before_state->>'status' IN ('PENDING','ATTENDED') AND after_state->>'status' IN ('PENDING','ATTENDED') AND
    jsonb_typeof(before_state->'revision') = 'string' AND jsonb_typeof(after_state->'revision') = 'string' AND
    core.im_at_revision(before_revision) AND core.im_at_revision(after_state->>'revision') AND
    jsonb_typeof(audit->'attentionChanged') = 'boolean' AND
    outcome IN ('APPLIED','IGNORED','DUPLICATE','CONFLICT') AND jsonb_typeof(result->'reason') = 'string' AND
    octet_length(core.im_at_compact(result)) <= 65536) IS NOT TRUE THEN RETURN false; END IF;
  IF ((audit->'intentId' = 'null'::jsonb OR core.im_at_string(audit->'intentId',128)) AND
    (audit->'messageId' = 'null'::jsonb OR core.im_at_uuid(audit->'messageId')) AND
    (audit->'actorWorkspaceMemberId' = 'null'::jsonb OR core.im_at_uuid(audit->'actorWorkspaceMemberId')) AND
    (audit->'coveredRevision' = 'null'::jsonb OR (jsonb_typeof(audit->'coveredRevision') = 'string' AND core.im_at_revision(covered))) AND
    (provenance = 'null'::jsonb OR core.im_at_provenance(provenance))) IS NOT TRUE THEN RETURN false; END IF;
  tuple := fingerprint::jsonb;
  IF jsonb_typeof(tuple) <> 'array' OR core.im_at_compact(tuple) IS DISTINCT FROM fingerprint OR
    tuple->>0 IS DISTINCT FROM event_kind THEN RETURN false; END IF;
  CASE event_kind
    WHEN 'INBOUND_RECEIVED' THEN
      IF jsonb_array_length(tuple) <> 2 OR NOT core.im_at_uuid(tuple->1) OR audit->'messageId' <> tuple->1 THEN RETURN false; END IF;
      expected_key := jsonb_build_array('INBOUND',tuple->1);
    WHEN 'MESSAGES_READ' THEN
      IF jsonb_array_length(tuple) <> 2 OR NOT core.im_at_uuid(tuple->1) OR audit->'actorWorkspaceMemberId' <> tuple->1 THEN RETURN false; END IF;
      expected_key := jsonb_build_array('READ',event_key);
    WHEN 'MANUAL_ACTION' THEN
      IF (jsonb_array_length(tuple) = 5 AND core.im_at_string(tuple->1,128) AND core.im_at_uuid(tuple->2) AND
        tuple->>3 IN ('PENDING','ATTENDED') AND jsonb_typeof(tuple->4) = 'string' AND core.im_at_revision(tuple->>4) AND
        audit->'intentId' = tuple->1 AND audit->'actorWorkspaceMemberId' = tuple->2 AND audit->'coveredRevision' = tuple->4) IS NOT TRUE THEN RETURN false; END IF;
      expected_key := jsonb_build_array('MANUAL',tuple->2,tuple->1);
    WHEN 'RESPONSE_INTENDED' THEN
      IF (jsonb_array_length(tuple) = 9 AND core.im_at_string(tuple->1,128) AND core.im_at_uuid(tuple->2) AND
        core.im_at_string(tuple->3,16384) AND jsonb_typeof(tuple->4) = 'string' AND core.im_at_revision(tuple->>4) AND
        tuple->>5 IN ('FREEFORM','TEMPLATE') AND core.im_at_provenance(provenance) AND
        audit->'intentId' = tuple->1 AND audit->'messageId' = tuple->2 AND audit->'coveredRevision' = tuple->4 AND
        provenance->'kind' = tuple->6 AND audit->'actorWorkspaceMemberId' = tuple->7 AND
        provenance->'authorityReference' = tuple->8 AND
        ((tuple->>6 = 'HUMAN' AND provenance->'actorWorkspaceMemberId' = tuple->7) OR
         (tuple->>6 IN ('AUTOMATION','LEGACY_UNKNOWN') AND tuple->7 = 'null'::jsonb))) IS NOT TRUE THEN RETURN false; END IF;
      expected_key := jsonb_build_array('RESPONSE',tuple->1);
    WHEN 'PROVIDER_EVIDENCE' THEN
      IF (jsonb_array_length(tuple) = 6 AND core.im_at_string(tuple->1,128) AND core.im_at_uuid(tuple->2) AND
        core.im_at_string(tuple->3,16384) AND core.im_at_string(tuple->4,16384) AND
        tuple->>5 IN ('QUEUED','SENDING','SENT','DELIVERED','READ','FAILED','UNKNOWN') AND
        audit->'intentId' = tuple->1 AND audit->'messageId' = tuple->2 AND
        core.im_at_keys(evidence,ARRAY['evidenceId','providerMessageId','status']) AND
        evidence = jsonb_build_object('providerMessageId',tuple->3,'evidenceId',tuple->4,'status',tuple->5)) IS NOT TRUE THEN RETURN false; END IF;
      expected_key := jsonb_build_array('EVIDENCE',tuple->3,tuple->4);
    ELSE RETURN false;
  END CASE;
  IF core.im_at_compact(expected_key) IS DISTINCT FROM effect_key THEN RETURN false; END IF;
  IF event_kind IN ('INBOUND_RECEIVED','MESSAGES_READ') AND
    (audit->'intentId' <> 'null'::jsonb OR audit->'coveredRevision' <> 'null'::jsonb) THEN RETURN false; END IF;
  IF event_kind IN ('MANUAL_ACTION','MESSAGES_READ') AND audit->'messageId' <> 'null'::jsonb THEN RETURN false; END IF;
  IF event_kind = 'INBOUND_RECEIVED' AND audit->'actorWorkspaceMemberId' <> 'null'::jsonb THEN RETURN false; END IF;
  IF event_kind NOT IN ('RESPONSE_INTENDED','PROVIDER_EVIDENCE') AND provenance <> 'null'::jsonb THEN RETURN false; END IF;
  IF event_kind <> 'PROVIDER_EVIDENCE' AND evidence <> 'null'::jsonb THEN RETURN false; END IF;
  IF event_kind = 'PROVIDER_EVIDENCE' THEN
    IF (provenance = 'null'::jsonb) <> (covered IS NULL) THEN RETURN false; END IF;
    IF audit->'actorWorkspaceMemberId' IS DISTINCT FROM COALESCE(provenance->'actorWorkspaceMemberId','null'::jsonb) THEN RETURN false; END IF;
    IF outcome <> 'CONFLICT' AND provenance = 'null'::jsonb THEN RETURN false; END IF;
  END IF;
  IF outcome = 'DUPLICATE' THEN
    RETURN reason IN ('SAME_EVENT','SAME_INTENTION_OR_EVIDENCE') AND
      (event_kind <> 'MESSAGES_READ' OR reason = 'SAME_EVENT') AND
      (covered IS NULL OR core.im_at_compare_revision(covered,before_revision) <= 0) AND
      before_state = after_state AND audit->'attentionChanged' = 'false'::jsonb;
  END IF;
  IF outcome = 'CONFLICT' AND reason = 'IDEMPOTENCY_CONFLICT' THEN
    RETURN before_state = after_state AND audit->'attentionChanged' = 'false'::jsonb;
  END IF;
  IF covered IS NOT NULL AND core.im_at_compare_revision(covered,before_revision) > 0 THEN
    expected_kind := 'CONFLICT'; expected_reason := 'FUTURE_REVISION';
  ELSE
    CASE event_kind
      WHEN 'INBOUND_RECEIVED' THEN
        expected_kind := 'APPLIED'; expected_reason := 'INBOUND_OPENED'; expected_status := 'PENDING';
      WHEN 'MESSAGES_READ' THEN expected_kind := 'IGNORED'; expected_reason := 'READ_DOES_NOT_ATTEND';
      WHEN 'MANUAL_ACTION' THEN
        IF tuple->>3 = 'PENDING' THEN expected_kind := 'APPLIED'; expected_reason := 'MANUAL_PENDING_RENEWED'; expected_status := 'PENDING';
        ELSIF covered <> before_revision THEN expected_kind := 'CONFLICT'; expected_reason := 'STALE_MANUAL_ATTENDED';
        ELSIF expected_status = 'ATTENDED' THEN expected_kind := 'IGNORED'; expected_reason := 'ALREADY_ATTENDED';
        ELSE expected_kind := 'APPLIED'; expected_reason := 'MANUAL_ATTENDED'; expected_status := 'ATTENDED'; END IF;
      WHEN 'RESPONSE_INTENDED' THEN
        IF covered <> before_revision THEN expected_kind := 'CONFLICT'; expected_reason := 'STALE_RESPONSE_INTENT';
        ELSIF reason = 'MESSAGE_IDENTITY_CONFLICT' THEN expected_kind := 'CONFLICT'; expected_reason := reason;
        ELSE expected_kind := 'APPLIED'; expected_reason := 'RESPONSE_REGISTERED'; END IF;
      WHEN 'PROVIDER_EVIDENCE' THEN
        IF provenance = 'null'::jsonb THEN expected_kind := 'CONFLICT'; expected_reason := 'RESPONSE_INTENT_NOT_FOUND';
        ELSIF reason = 'MESSAGE_IDENTITY_CONFLICT' THEN expected_kind := 'CONFLICT'; expected_reason := reason;
        ELSIF provenance->>'kind' <> 'HUMAN' THEN expected_kind := 'IGNORED'; expected_reason := 'NON_HUMAN_RESPONSE';
        ELSIF evidence->>'status' NOT IN ('DELIVERED','READ') THEN expected_kind := 'IGNORED'; expected_reason := 'INSUFFICIENT_PROVIDER_EVIDENCE';
        ELSIF covered <> before_revision THEN expected_kind := 'IGNORED'; expected_reason := 'REVISION_NOT_CURRENT';
        ELSIF expected_status = 'ATTENDED' THEN expected_kind := 'IGNORED'; expected_reason := 'ALREADY_ATTENDED';
        ELSE expected_kind := 'APPLIED'; expected_reason := 'HUMAN_RESPONSE_CONFIRMED'; expected_status := 'ATTENDED'; END IF;
    END CASE;
  END IF;
  IF expected_kind = 'APPLIED' AND expected_reason <> 'RESPONSE_REGISTERED' THEN
    expected_revision := core.im_at_next_revision(before_revision);
  END IF;
  RETURN COALESCE(outcome = expected_kind AND reason = expected_reason AND
    after_state = jsonb_build_object('status',expected_status,'revision',expected_revision) AND
    audit->'attentionChanged' = to_jsonb(expected_revision <> before_revision), false);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END
$fn$`;
