// All values are backend references. Reacquisition does not repair an earlier
// Message -> Receipt inversion: the caller must already hold the ordered locks.
export const DURABLE_INBOUND_RECEIPT_LOCK_SQL = `SELECT w."id"
  FROM core."inconnectMessagingWebhookReceipt" w
  JOIN core."inconnectMessagingConversation" c
    ON c."workspaceId" = w."workspaceId" AND c."providerConnectionId" = w."providerConnectionId"
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid
    AND c."providerConnectionId" = $3::uuid AND c."attentionTrackingEpochId" = $4::uuid
    AND w."id" = $5::uuid
  FOR UPDATE OF w`;

// Raw text preserves microseconds, including detection of sub-millisecond drift.
// Reject infinity/BC/out-of-range instead of formatting them into valid instants.
const timestamp = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL
  WHEN isfinite(${column}) AND ${column} >= '0001-01-01 00:00:00+00'::timestamptz
    AND ${column} < '10000-01-01 00:00:00+00'::timestamptz
  THEN to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ELSE ${column}::text END`;

export const DURABLE_INBOUND_FACT_SQL = `SELECT
  w."id" AS "receiptId", w."workspaceId", w."providerConnectionId",
  w."eventKind", w."idempotencyKey", w."payloadHash", w."normalizedMetadata",
  ${timestamp('w."firstReceivedAt"')} AS "firstReceivedAt",
  w."processingState", w."leaseToken", w."attemptCount", w."processedAt",
  (w."leaseExpiresAt" > clock_timestamp()) AS "leaseValid",
  p."id" AS "connectionId", p."workspaceId" AS "connectionWorkspaceId",
  p."provider", p."channel", p."lifecycleStatus", p."inboundRoutingKey",
  p."credentialsVersion", (p."encryptedCredentials" LIKE 'enc:v2:%') AS "credentialsConfigured",
  (SELECT count(*)::text FROM core."inconnectMessagingProviderConnection" candidate
    WHERE candidate."provider" = p."provider" AND candidate."channel" = p."channel"
      AND candidate."inboundRoutingKey" = p."inboundRoutingKey") AS "routingCount",
  c."id" AS "conversationId", c."externalAddressNormalized",
  c."attentionTrackingEpochId" AS "currentEpochId",
  m."id" AS "messageId", m."conversationId" AS "messageConversationId",
  m."workspaceId" AS "messageWorkspaceId", m."providerConnectionId" AS "messageConnectionId",
  m."attentionTrackingEpochId" AS "originEpochId", m."direction", m."type", m."body",
  m."sendMode", m."outboundState", m."providerMessageId", m."providerMetadata",
  ${timestamp('m."serverReceivedAt"')} AS "serverReceivedAt",
  ${timestamp('m."providerOccurredAt"')} AS "providerOccurredAt",
  ${timestamp('m."effectiveInboundAt"')} AS "effectiveInboundAt", m."timestampSource",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'ordinal', a."ordinal", 'type', a."type", 'declaredMimeType', a."declaredMimeType",
    'safeFilename', a."safeFilename") ORDER BY a."ordinal")
    FROM core."inconnectMessagingAttachment" a
    WHERE a."workspaceId" = m."workspaceId" AND a."providerConnectionId" = m."providerConnectionId"
      AND a."messageId" = m."id"), '[]'::jsonb) AS attachments
  FROM core."inconnectMessagingConversation" c
  JOIN core."inconnectMessagingProviderConnection" p
    ON p."id" = c."providerConnectionId" AND p."workspaceId" = c."workspaceId"
  JOIN core."inconnectMessagingWebhookReceipt" w
    ON w."workspaceId" = c."workspaceId" AND w."providerConnectionId" = c."providerConnectionId"
      AND w."id" = $5::uuid
  JOIN core."inconnectMessagingMessage" m
    ON m."workspaceId" = c."workspaceId" AND m."conversationId" = c."id"
      AND m."providerConnectionId" = c."providerConnectionId" AND m."id" = $6::uuid
      AND m."attentionTrackingEpochId" = $4::uuid
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid
    AND c."providerConnectionId" = $3::uuid AND c."attentionTrackingEpochId" = $4::uuid`;
