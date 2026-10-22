// All identifiers below are repository-owned constants. Only values use $n.
// Explicit JSON projections exclude technical xid8 markers and ORM Date parsing.
const scopedColumns = [
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
] as const;
const columns = {
  conversation: [
    'id',
    'workspaceId',
    'providerConnectionId',
    'attentionTrackingEpochId',
    'attentionStatus',
    'attentionRevision',
    'pendingAt',
  ],
  epoch: [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'identityVersion',
    'reducerVersion',
    'successPolicy',
    'lifecycle',
    'bootstrapStatus',
    'bootstrapRevision',
    'bootstrapPendingAt',
    'bootstrapReference',
    'createdAt',
    'activatedAt',
    'closedAt',
  ],
  effect: [
    'id',
    ...scopedColumns,
    'effectKey',
    'fingerprint',
    'canonicalReceiptId',
    'eventKind',
    'messageId',
    'responseIntentId',
    'providerStatusEventId',
    'createdAt',
  ],
  receipt: [
    'id',
    ...scopedColumns,
    'eventKey',
    'effectId',
    'originalAuditId',
    'createdAt',
  ],
  intent: [
    'id',
    ...scopedColumns,
    'intentId',
    'messageId',
    'contentFingerprint',
    'coveredRevision',
    'provenanceKind',
    'actorWorkspaceMemberId',
    'authorityReference',
    'format',
    'registeredEffectId',
    'createdAt',
  ],
  audit: [
    'id',
    ...scopedColumns,
    'eventKey',
    'effectKey',
    'fingerprint',
    'result',
    'resultVersion',
    'authorityKind',
    'authenticationReference',
    'correlationReference',
    'recordedAt',
  ],
  message: [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'attentionTrackingEpochId',
    'direction',
    'sendMode',
    'providerMessageId',
  ],
  status: [
    'id',
    'workspaceId',
    'messageId',
    'webhookReceiptId',
    'providerEventKey',
    'originalStatus',
    'normalizedStatus',
    'appliedToProjection',
  ],
  webhook: ['id', 'workspaceId', 'providerConnectionId', 'eventKind'],
} as const;
const timestamps = new Set([
  'pendingAt',
  'bootstrapPendingAt',
  'createdAt',
  'activatedAt',
  'closedAt',
  'recordedAt',
]);
const exactTimestamp = (expression: string): string =>
  `CASE WHEN isfinite(${expression}) AND ${expression} >= timestamptz '0001-01-01 00:00:00+00' AND ${expression} < timestamptz '10000-01-01 00:00:00+00' THEN to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE ${expression}::text END`;
const project = (kind: keyof typeof columns, alias: string): string =>
  `CASE WHEN ${alias}."id" IS NULL THEN NULL ELSE jsonb_build_object(${columns[
    kind
  ]
    .map(
      (column) =>
        `'${column}', ${
          timestamps.has(column)
            ? exactTimestamp(`${alias}."${column}"`)
            : `${alias}."${column}"`
        }`,
    )
    .join(', ')}) END`;
const scope = (alias: string): string =>
  scopedColumns
    .map((column, index) => `${alias}."${column}" = $${index + 1}::uuid`)
    .join(' AND ');
const conversationScope = `c."workspaceId" = $1::uuid AND c."id" = $2::uuid AND c."providerConnectionId" = $3::uuid`;
const messageScope = (alias: string): string =>
  `${alias}."workspaceId" = $1::uuid AND ${alias}."conversationId" = $2::uuid AND ${alias}."providerConnectionId" = $3::uuid AND ${alias}."attentionTrackingEpochId" = $4::uuid`;

export const ATTENTION_SESSION_SQL = `SELECT
  current_setting('transaction_isolation') AS "isolation",
  current_setting('transaction_read_only') AS "readOnly",
  current_setting('row_security') AS "rowSecurity",
  pg_is_in_recovery() AS "inRecovery", pg_backend_pid() AS "backendPid",
  pg_current_xact_id()::text AS "transactionId",
  (SELECT setting FROM pg_settings WHERE name = 'statement_timeout') AS "statementTimeout",
  (SELECT setting FROM pg_settings WHERE name = 'lock_timeout') AS "lockTimeout"`;

// to_jsonb extraction permits detecting pre-DDL configuration without naming
// missing columns. No attention table is referenced until ENABLED/protocol 1.
export const ATTENTION_CONFIGURATION_SQL = `SELECT configuration."workspaceId",
  to_jsonb(configuration) ?& ARRAY['attentionTrackingMode','attentionWriterProtocolVersion','attentionGateUpdatedAt'] AS "installed",
  to_jsonb(configuration)->'attentionTrackingMode' AS "mode",
  to_jsonb(configuration)->'attentionWriterProtocolVersion' AS "protocolVersion",
  ${exactTimestamp("((to_jsonb(configuration)->>'attentionGateUpdatedAt')::timestamptz)")} AS "gateUpdatedAt"
  FROM core."inconnectMessagingConfiguration" configuration
  WHERE configuration."workspaceId" = $1::uuid FOR SHARE OF configuration`;
export const ATTENTION_CONVERSATION_LOCK_SQL = `SELECT c."id", c."workspaceId", c."providerConnectionId"
  FROM core."inconnectMessagingConversation" c WHERE ${conversationScope} FOR UPDATE OF c`;
export const ATTENTION_ROOT_SQL = `SELECT ${project('conversation', 'c')} AS "conversation",
  ${project('epoch', 'epoch')} AS "epoch"
  FROM core."inconnectMessagingConversation" c
  LEFT JOIN core."inconnectMessagingAttentionEpoch" epoch ON epoch."id" = c."attentionTrackingEpochId"
    AND epoch."workspaceId" = $1::uuid AND epoch."conversationId" = $2::uuid AND epoch."providerConnectionId" = $3::uuid
  WHERE ${conversationScope}`;

const slotsSql = (
  lookup: 'NONE' | 'INTENT_ID' | 'MESSAGE_ID',
): string => `SELECT
  ${project('conversation', 'c')} AS "conversation", ${project('epoch', 'epoch')} AS "epoch",
  r."id" IS NOT NULL AS "receiptPresent", ${project('receipt', 'r')} AS "receipt",
  e."id" IS NOT NULL AS "effectPresent", ${project('effect', 'e')} AS "effect",
  ${lookup === 'NONE' ? 'false AS "intentPresent", NULL::jsonb AS "intent"' : `i."id" IS NOT NULL AS "intentPresent", ${project('intent', 'i')} AS "intent"`}
  FROM core."inconnectMessagingConversation" c
  LEFT JOIN core."inconnectMessagingAttentionEpoch" epoch ON epoch."id" = c."attentionTrackingEpochId"
    AND epoch."workspaceId" = $1::uuid AND epoch."conversationId" = $2::uuid AND epoch."providerConnectionId" = $3::uuid
  LEFT JOIN core."inconnectMessagingAttentionReceipt" r ON ${scope('r')} AND r."eventKey" = $5::text
  LEFT JOIN core."inconnectMessagingAttentionEffect" e ON ${scope('e')} AND e."effectKey" = $6::text
  ${lookup === 'NONE' ? '' : `LEFT JOIN core."inconnectMessagingAttentionResponseIntent" i ON ${scope('i')} AND ${lookup === 'INTENT_ID' ? 'i."intentId" = $7::text' : 'i."messageId" = $7::uuid'}`}
  WHERE ${conversationScope}`;
export const ATTENTION_SLOTS_SQL = Object.freeze({
  NONE: slotsSql('NONE'),
  INTENT_ID: slotsSql('INTENT_ID'),
  MESSAGE_ID: slotsSql('MESSAGE_ID'),
});

// LEFT JOIN preserves a base Effect even when any mandatory link is missing.
// Intent registration is a fixed additional pair, never a history traversal.
export const ATTENTION_EFFECT_LINKS_SQL = `SELECT
  ${project('effect', 'e')} AS "effect",
  ${project('receipt', 'r')} AS "canonicalReceipt", ${project('audit', 'a')} AS "canonicalAudit",
  ${project('message', 'm')} AS "message", ${project('intent', 'i')} AS "intent",
  ${project('status', 's')} AS "providerStatus", ${project('webhook', 'w')} AS "webhook",
  ${project('effect', 'g')} AS "registrationEffect", ${project('receipt', 'gr')} AS "registrationReceipt",
  ${project('audit', 'ga')} AS "registrationAudit", ${project('message', 'gm')} AS "registrationMessage"
  FROM core."inconnectMessagingAttentionEffect" e
  LEFT JOIN core."inconnectMessagingAttentionReceipt" r ON ${scope('r')} AND r."id" = e."canonicalReceiptId"
  LEFT JOIN core."inconnectMessagingAttentionTransitionAudit" a ON ${scope('a')} AND a."id" = r."originalAuditId"
  LEFT JOIN core."inconnectMessagingMessage" m ON ${messageScope('m')} AND m."id" = e."messageId"
  LEFT JOIN core."inconnectMessagingAttentionResponseIntent" i ON ${scope('i')} AND i."intentId" = e."responseIntentId"
  LEFT JOIN core."inconnectMessagingProviderStatusEvent" s ON s."id" = e."providerStatusEventId" AND s."workspaceId" = $1::uuid AND s."messageId" = m."id"
  LEFT JOIN core."inconnectMessagingWebhookReceipt" w ON w."id" = s."webhookReceiptId" AND w."workspaceId" = $1::uuid AND w."providerConnectionId" = $3::uuid
  LEFT JOIN core."inconnectMessagingAttentionEffect" g ON ${scope('g')} AND g."id" = i."registeredEffectId"
  LEFT JOIN core."inconnectMessagingAttentionReceipt" gr ON ${scope('gr')} AND gr."id" = g."canonicalReceiptId"
  LEFT JOIN core."inconnectMessagingAttentionTransitionAudit" ga ON ${scope('ga')} AND ga."id" = gr."originalAuditId"
  LEFT JOIN core."inconnectMessagingMessage" gm ON ${messageScope('gm')} AND gm."id" = g."messageId"
  WHERE ${scope('e')} AND e."id" = $5::uuid`;
export const ATTENTION_ORIGINAL_AUDIT_SQL = `SELECT ${project('audit', 'a')} AS "audit"
  FROM core."inconnectMessagingAttentionTransitionAudit" a WHERE ${scope('a')} AND a."id" = $5::uuid`;
// C lookup deliberately retains legacy/other origin epoch for explicit rejection.
export const ATTENTION_SOURCE_MESSAGE_SQL = `SELECT ${project('message', 'm')} AS "message"
  FROM core."inconnectMessagingMessage" m WHERE m."workspaceId" = $1::uuid
    AND m."conversationId" = $2::uuid AND m."providerConnectionId" = $3::uuid AND m."id" = $4::uuid`;
