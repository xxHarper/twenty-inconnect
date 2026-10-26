// All identifiers are private constants. No ORM INSERT may omit the origin
// epoch through its intentionally dormant pre-DDL mapping.
export const INBOUND_LOCATOR_SQL = `SELECT "id", "workspaceId", "providerConnectionId",
  "eventKind", "idempotencyKey", "payloadHash", "normalizedMetadata",
  to_jsonb(w)->'ingressContractVersion' AS version
  FROM core."inconnectMessagingWebhookReceipt" w
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid`;

export const INBOUND_CONNECTION_SQL = `SELECT p."id" FROM core."inconnectMessagingProviderConnection" p
  WHERE p."workspaceId" = $1::uuid AND p."id" = $2::uuid
    AND p."provider" = 'TWILIO' AND p."channel" = 'WHATSAPP'
    AND p."lifecycleStatus" = 'ENABLED' AND btrim(p."inboundRoutingKey") <> ''
    AND p."credentialsVersion" > 0 AND p."encryptedCredentials" LIKE 'enc:v2:%'
    AND (SELECT count(*) FROM core."inconnectMessagingProviderConnection" candidate
      WHERE candidate."provider" = p."provider" AND candidate."channel" = p."channel"
        AND candidate."inboundRoutingKey" = p."inboundRoutingKey") = 1`;

export const INBOUND_CREATE_CONVERSATION_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingConversation"
    ("id","workspaceId","providerConnectionId","externalAddressNormalized","waId",
     "linkedRecordObjectMetadataId","linkedRecordId","lastInboundAt","pendingAt")
  VALUES ($4::uuid,$1::uuid,$2::uuid,$3::text,$5::text,NULL,NULL,NULL,NULL)
  ON CONFLICT ("providerConnectionId","externalAddressNormalized") DO NOTHING RETURNING "id"
) SELECT "id" FROM written`;

// New statement after INSERT's possible uniqueness wait; never reuse its snapshot.
export const INBOUND_LOCK_CONVERSATION_SQL = `SELECT "id", "workspaceId", "providerConnectionId",
  "externalAddressNormalized" FROM core."inconnectMessagingConversation"
  WHERE "workspaceId" = $1::uuid AND "providerConnectionId" = $2::uuid
    AND "externalAddressNormalized" = $3::text FOR UPDATE`;

export const INBOUND_CREATE_EPOCH_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttentionEpoch"
    ("id","workspaceId","conversationId","providerConnectionId","identityVersion","reducerVersion",
     "successPolicy","lifecycle","bootstrapStatus","bootstrapRevision","bootstrapPendingAt","bootstrapReference")
  SELECT $4::uuid,c."workspaceId",c."id",c."providerConnectionId",'attention-domain-v1','attention-reducer-v1',
    'PROPOSED_DELIVERED_OR_READ','PREPARING',CASE WHEN c."pendingAt" IS NULL THEN 'ATTENDED' ELSE 'PENDING' END,
    '0',c."pendingAt",$5::text FROM core."inconnectMessagingConversation" c
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid AND c."providerConnectionId" = $3::uuid
    AND c."attentionTrackingEpochId" IS NULL AND c."attentionStatus" IS NULL AND c."attentionRevision" IS NULL
  RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_PREPARE_POINTER_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingConversation" c SET "attentionTrackingEpochId" = e."id",
    "attentionStatus" = e."bootstrapStatus", "attentionRevision" = '0', "updatedAt" = statement_timestamp()
  FROM core."inconnectMessagingAttentionEpoch" e
  WHERE c."workspaceId" = $1::uuid AND c."id" = $2::uuid AND c."providerConnectionId" = $3::uuid
    AND e."id" = $4::uuid AND e."workspaceId" = c."workspaceId" AND e."conversationId" = c."id"
    AND e."providerConnectionId" = c."providerConnectionId" AND e."lifecycle" = 'PREPARING'
    AND c."attentionTrackingEpochId" IS NULL RETURNING c."id"
) SELECT "id" FROM written`;

export const INBOUND_READY_EPOCH_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingAttentionEpoch" SET "lifecycle" = 'READY', "activatedAt" = statement_timestamp()
  WHERE "workspaceId" = $1::uuid AND "conversationId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "id" = $4::uuid AND "lifecycle" = 'PREPARING' AND "activatedAt" IS NULL RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_LOCK_RECEIPT_SQL = `SELECT "id" FROM core."inconnectMessagingWebhookReceipt"
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid FOR UPDATE`;
export const INBOUND_RECEIPT_LEASE_SQL = `SELECT "id", "processingState", "leaseToken",
  ("leaseExpiresAt" > clock_timestamp()) AS "leaseValid", "attemptCount", "processedAt" IS NULL AS "unfinished"
  FROM core."inconnectMessagingWebhookReceipt"
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid`;

// Resolve all directions and workspaces for the connection's global provider ID.
// A contradictory winner must fail, rather than look absent and create around it.
export const INBOUND_MESSAGE_SQL = `SELECT "id", "workspaceId", "conversationId", "providerConnectionId",
  "attentionTrackingEpochId", "direction" FROM core."inconnectMessagingMessage"
  WHERE "providerConnectionId" = $1::uuid AND "providerMessageId" = $2::text FOR UPDATE`;
export const INBOUND_INSERT_MESSAGE_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingMessage"
    ("id","workspaceId","conversationId","providerConnectionId","attentionTrackingEpochId","direction","type",
     "body","providerMessageId","providerMetadata","serverReceivedAt","providerOccurredAt","effectiveInboundAt","timestampSource")
  VALUES ($5::uuid,$1::uuid,$2::uuid,$3::uuid,$4::uuid,'INBOUND',$6::varchar,$7::text,$8::text,
    $9::jsonb,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13::varchar) RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_INSERT_ATTACHMENT_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingAttachment"
    ("id","workspaceId","providerConnectionId","messageId","ordinal","type","providerMediaLocator",
     "declaredMimeType","safeFilename","ingestionState","attemptCount","lastErrorCode")
  VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::varchar,$7::text,$8::text,$9::text,$10::varchar,0,$11::varchar)
  RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_UPDATE_ACTIVITY_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingConversation" SET
    "lastInboundAt" = GREATEST(COALESCE("lastInboundAt",$4::timestamptz),$4::timestamptz),
    "waId" = COALESCE($5::text,"waId"), "updatedAt" = statement_timestamp()
  WHERE "workspaceId" = $1::uuid AND "id" = $2::uuid AND "providerConnectionId" = $3::uuid RETURNING "id"
) SELECT "id" FROM written`;

export const INBOUND_INSERT_OUTBOX_SQL = `WITH written AS (
  INSERT INTO core."inconnectMessagingOutboxEvent"
    ("id","workspaceId","aggregateType","aggregateId","eventType","immutablePayload","deduplicationKey",
     "availableAt","processingState","attemptCount")
  VALUES ($1::uuid,$2::uuid,'MESSAGE',$3::uuid,'INBOUND_MESSAGE_RECEIVED',$4::jsonb,$5::text,statement_timestamp(),'PENDING',0)
  RETURNING "id"
) SELECT "id" FROM written`;
export const INBOUND_ORIGINAL_OUTBOX_SQL = `SELECT "id", "workspaceId", "aggregateType", "aggregateId",
  "eventType", "immutablePayload", "deduplicationKey" FROM core."inconnectMessagingOutboxEvent"
  WHERE "deduplicationKey" = $1::text`;

export const INBOUND_FINALIZE_RECEIPT_SQL = `WITH written AS (
  UPDATE core."inconnectMessagingWebhookReceipt" SET "processingState" = 'PROCESSED', "leaseToken" = NULL,
    "leaseExpiresAt" = NULL, "processedAt" = clock_timestamp(), "error" = NULL, "updatedAt" = statement_timestamp()
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid
    AND "eventKind" = 'INBOUND_MESSAGE' AND "ingressContractVersion" = 1
    AND "processingState" = 'PROCESSING' AND "leaseToken" = $4::uuid
    AND "leaseExpiresAt" > clock_timestamp() AND "processedAt" IS NULL RETURNING "id"
) SELECT "id" FROM written`;
