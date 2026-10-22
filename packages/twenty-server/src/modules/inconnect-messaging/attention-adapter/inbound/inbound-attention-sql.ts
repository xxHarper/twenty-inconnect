// Read only, after the writer's Configuration -> Conversation locks. This is
// source authentication/correlation, never another reader of attention facts.
export const INBOUND_ATTENTION_ADMISSION_SQL = `SELECT
  p."encryptedCredentials", p."inboundRoutingKey", p."provider", p."channel", p."lifecycleStatus",
  (SELECT count(*)::text FROM core."inconnectMessagingProviderConnection" candidate
    WHERE candidate."provider" = 'TWILIO' AND candidate."channel" = 'WHATSAPP'
      AND candidate."inboundRoutingKey" = $8::text) AS "routingCount",
  c."externalAddressNormalized",
  w."payloadHash", w."normalizedMetadata", w."idempotencyKey", w."eventKind",
  w."processingState", w."leaseToken",
  (w."leaseExpiresAt" > clock_timestamp()) AS "leaseValid",
  to_char(w."firstReceivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "firstReceivedAt",
  m."providerMessageId", m."direction", m."type", m."body", m."providerMetadata"
  FROM core."inconnectMessagingConversation" c
  JOIN core."inconnectMessagingProviderConnection" p
    ON p."id" = c."providerConnectionId" AND p."workspaceId" = c."workspaceId"
  JOIN core."inconnectMessagingWebhookReceipt" w
    ON w."workspaceId" = c."workspaceId" AND w."providerConnectionId" = c."providerConnectionId"
      AND w."id" = $5::uuid AND w."leaseToken" = $6::uuid
  JOIN core."inconnectMessagingMessage" m
    ON m."workspaceId" = c."workspaceId" AND m."conversationId" = c."id"
      AND m."providerConnectionId" = c."providerConnectionId" AND m."id" = $7::uuid
      AND m."attentionTrackingEpochId" = $4::uuid
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid
    AND c."providerConnectionId" = $3::uuid AND c."attentionTrackingEpochId" = $4::uuid`;
