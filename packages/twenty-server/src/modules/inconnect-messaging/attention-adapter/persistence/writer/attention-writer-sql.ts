// Identifiers are private source constants. S is always $1..$4, values only.
const scopeColumns =
  '"workspaceId", "conversationId", "providerConnectionId", "trackingEpochId"';
const scopeValues = '$1::uuid, $2::uuid, $3::uuid, $4::uuid';
const scoped = (alias: string) =>
  ['workspaceId', 'conversationId', 'providerConnectionId', 'trackingEpochId']
    .map((column, index) => `${alias}."${column}" = $${index + 1}::uuid`)
    .join(' AND ');

// No bootstrap writes. Also flush the caller's possible epoch/pointer cycle.
// Flush every deferred obligation relevant to this operation before PREPARED.
export const ATTENTION_WRITE_CONSTRAINTS = [
  'FK_IM_AT_CONVERSATION_EPOCH',
  'TR_IM_AT_EPOCH_COMPLETE',
  'FK_IM_AT_EFFECT_CANONICAL',
  'FK_IM_AT_EFFECT_RESPONSE',
  'FK_IM_AT_INTENT_REGISTRATION',
  'TR_IM_AT_EFFECT_LINKS',
  'TR_IM_AT_EFFECT_COMPLETE',
  'TR_IM_AT_RECEIPT_LINKS',
  'TR_IM_AT_RESPONSEINTENT_LINKS',
  'TR_IM_AT_AUDIT_COMPLETE',
  'TR_IM_AT_MESSAGE_COMPLETE',
  'TR_IM_AT_OUTBOX_COMPLETE',
] as const;
const constraints = ATTENTION_WRITE_CONSTRAINTS.map(
  (name) => `core."${name}"`,
).join(', ');
export const ATTENTION_DEFER_SQL = `SET CONSTRAINTS ${constraints} DEFERRED`;
export const ATTENTION_COMPLETE_SQL = `SET CONSTRAINTS ${constraints} IMMEDIATE`;

export const ATTENTION_WEBHOOK_LOCK_SQL = `SELECT w."id", w."workspaceId", w."providerConnectionId", w."eventKind",
  (w."processingState" = 'PROCESSING' AND w."leaseToken" = $5::uuid
    AND w."leaseExpiresAt" > statement_timestamp()) AS "leaseValid"
  FROM core."inconnectMessagingWebhookReceipt" w
  JOIN core."inconnectMessagingConversation" c ON c."id" = $2::uuid
    AND c."workspaceId" = w."workspaceId" AND c."providerConnectionId" = w."providerConnectionId"
  WHERE w."workspaceId" = $1::uuid AND w."providerConnectionId" = $3::uuid AND w."id" = $4::uuid FOR UPDATE OF w`;

// Supplemental causal checks; business facts are read ONLY through C2-II.
// These booleans are computed by PostgreSQL, never supplied transaction IDs.
export const ATTENTION_CAUSAL_MESSAGE_SQL = `SELECT m."id", m."direction", m."sendMode", m."providerMessageId", m."outboundState",
  core.im_at_own_write(m."attentionCreatedTransactionId") AS "createdHere",
  core.im_at_own_write(m."attentionUpdatedTransactionId") AS "updatedHere"
  FROM core."inconnectMessagingMessage" m WHERE m."workspaceId" = $1::uuid
    AND m."conversationId" = $2::uuid AND m."providerConnectionId" = $3::uuid
    AND m."attentionTrackingEpochId" = $4::uuid AND m."id" = $5::uuid FOR UPDATE OF m`;
export const ATTENTION_CAUSAL_STATUS_SQL = `SELECT s."id", s."webhookReceiptId", s."normalizedStatus", s."appliedToProjection",
  core.im_at_own_write(s."attentionCreatedTransactionId") AS "createdHere",
  EXISTS (SELECT 1 FROM core."inconnectMessagingAttentionEffect" e WHERE ${scoped('e')}
    AND e."effectKey" = $7::text AND e."fingerprint" = $8::text AND e."providerStatusEventId" = s."id") AS "consumedBinding"
  FROM core."inconnectMessagingProviderStatusEvent" s
  JOIN core."inconnectMessagingMessage" m ON m."id" = s."messageId" AND m."workspaceId" = s."workspaceId"
  WHERE s."workspaceId" = $1::uuid AND m."conversationId" = $2::uuid AND m."providerConnectionId" = $3::uuid
    AND m."attentionTrackingEpochId" = $4::uuid AND s."messageId" = $5::uuid AND s."id" = $6::uuid FOR SHARE OF s`;

// CTE SELECT keeps the installed TypeORM driver envelope identical for INSERT
// and UPDATE (a bare UPDATE has a different raw shape). All writes return IDs.
export const ATTENTION_INSERT_EFFECT_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttentionEffect" (${scopeColumns}, "id", "effectKey", "fingerprint", "canonicalReceiptId", "eventKind", "messageId", "responseIntentId", "providerStatusEventId")
  VALUES (${scopeValues}, $5::uuid, $6::text, $7::text, $8::uuid, $9::varchar, $10::uuid, $11::text, $12::uuid) RETURNING "id"
) SELECT "id" FROM written`;
export const ATTENTION_INSERT_AUDIT_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttentionTransitionAudit" (${scopeColumns}, "id", "eventKey", "effectKey", "fingerprint", "result", "resultVersion", "authorityKind", "authenticationReference", "correlationReference")
  VALUES (${scopeValues}, $5::uuid, $6::text, $7::text, $8::text, $9::jsonb, 1, $10::varchar, $11::text, $12::text) RETURNING "id"
) SELECT "id" FROM written`;
export const ATTENTION_INSERT_RECEIPT_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttentionReceipt" (${scopeColumns}, "id", "eventKey", "effectId", "originalAuditId")
  SELECT ${scopeValues}, $5::uuid, $6::text, e."id", $7::uuid
  FROM core."inconnectMessagingAttentionEffect" e WHERE ${scoped('e')}
    AND e."effectKey" = $8::text AND e."fingerprint" = $9::text
  RETURNING "id", "effectId"
) SELECT "id", "effectId" FROM written`;
export const ATTENTION_INSERT_INTENT_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttentionResponseIntent" (${scopeColumns}, "id", "intentId", "messageId", "contentFingerprint", "coveredRevision", "provenanceKind", "actorWorkspaceMemberId", "authorityReference", "format", "registeredEffectId")
  VALUES (${scopeValues}, $5::uuid, $6::text, $7::uuid, $8::text, $9::text, $10::varchar, $11::uuid, $12::text, $13::varchar, $14::uuid) RETURNING "id"
) SELECT "id" FROM written`;
export const ATTENTION_UPDATE_CONVERSATION_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingConversation" c SET "attentionStatus" = $7::varchar, "attentionRevision" = $8::text,
    "pendingAt" = CASE WHEN $7::varchar = 'PENDING' THEN c."pendingAt" ELSE NULL END, "updatedAt" = statement_timestamp()
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid AND c."providerConnectionId" = $3::uuid
    AND c."attentionTrackingEpochId" = $4::uuid AND c."attentionStatus" = $5::varchar AND c."attentionRevision" = $6::text
  RETURNING c."id"
) SELECT "id" FROM written`;
// pendingAt opening is server-owned by im_at_conversation_guard; renewals keep
// the existing timestamp without transporting it through JavaScript Date.
export const ATTENTION_INSERT_OUTBOX_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingOutboxEvent" ("id", "workspaceId", "aggregateType", "aggregateId", "eventType", "immutablePayload", "deduplicationKey", "availableAt", "processingState", "leaseToken", "leaseExpiresAt", "attemptCount", "error", "publishedAt")
  VALUES ($5::uuid, $1::uuid, 'CONVERSATION', $2::uuid, 'CONVERSATION_ATTENTION_CHANGED', jsonb_build_object('conversationId', $2::uuid::text),
    core.im_at_outbox_key($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6::text), statement_timestamp(), 'PENDING', NULL, NULL, 0, NULL, NULL) RETURNING "id"
) SELECT "id" FROM written`;
