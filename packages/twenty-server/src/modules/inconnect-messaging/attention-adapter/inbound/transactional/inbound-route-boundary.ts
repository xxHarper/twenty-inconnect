import { Raw, type EntityManager } from 'typeorm';

import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';

export const INBOUND_ROUTE_SQL = `SELECT
  (to_jsonb(c) ? 'attentionTrackingMode')::integer +
  (to_jsonb(c) ? 'attentionWriterProtocolVersion')::integer +
  (to_jsonb(c) ? 'attentionGateUpdatedAt')::integer AS columns,
  to_jsonb(c)->'attentionTrackingMode' AS mode,
  to_jsonb(c)->'attentionWriterProtocolVersion' AS "protocolVersion",
  to_jsonb(c)->>'attentionGateUpdatedAt' AS "gateUpdatedAt"
  FROM core."inconnectMessagingConfiguration" c WHERE "workspaceId" = $1::uuid FOR SHARE`;

export const INBOUND_ROUTE_PAUSE_MILLISECONDS = 60_000;
export const INBOUND_ROUTE_PAUSE_CATEGORY = 'INBOUND_ROUTE_PAUSED';

export class InboundRoutePaused extends InconnectMessagingWebhookException {
  constructor() {
    super('RECEIPT_NOT_PROCESSABLE', false);
  }
}

// Raw receives a metadata property path, not an escaped SQL identifier.
// Quote each component; never depend on TypeORM's generated alias casing.
export const inboundRoutePauseFilter = () =>
  Raw(
    (path) => {
      const prefix = path.split('.').slice(0, -1);
      const column = (name: string) =>
        [...prefix, name]
          .map((identifier) => `"${identifier.replace(/"/g, '""')}"`)
          .join('.');
      return `(${column('eventKind')} <> 'INBOUND_MESSAGE' OR ${column('processingState')} <> 'RECEIVED' OR ${column('error')}->>'category' IS DISTINCT FROM :pauseCategory OR ${column('updatedAt')} <= clock_timestamp() - (:pauseMilliseconds * INTERVAL '1 millisecond'))`;
    },
    {
      pauseCategory: INBOUND_ROUTE_PAUSE_CATEGORY,
      pauseMilliseconds: INBOUND_ROUTE_PAUSE_MILLISECONDS,
    },
  );

// This is a release boundary, not a late ENABLED check offered as revocation.
// It runs before the legacy Receipt lock and remains held to that unit's commit.
// R2 still issues only in DISABLED. No ENABLED emitter/processor pair is released.
export const requireLegacyInboundRoute = async (
  manager: EntityManager,
  workspaceId: string,
): Promise<void> => {
  const rows: unknown = await manager.query(INBOUND_ROUTE_SQL, [workspaceId]);
  if (Array.isArray(rows) && rows.length === 1) {
    const gate = rows[0];
    if (gate?.columns === 0 && gate.mode === null) return;
    const validProtocol =
      gate?.protocolVersion === null ||
      (Number.isSafeInteger(gate?.protocolVersion) && gate.protocolVersion > 0);
    const validTimestamp =
      typeof gate?.gateUpdatedAt === 'string' &&
      Number.isFinite(Date.parse(gate.gateUpdatedAt));
    if (
      gate?.columns === 3 &&
      validProtocol &&
      (gate.gateUpdatedAt === null || validTimestamp)
    ) {
      if (gate.mode === 'DISABLED') return;
      if (
        ['PREPARING', 'SUSPENDED', 'ENABLED'].includes(gate.mode) &&
        (gate.mode !== 'ENABLED' || gate.protocolVersion === 1) &&
        validTimestamp
      )
        throw new InboundRoutePaused();
    }
  }
  throw new InconnectMessagingWebhookException(
    'RECEIPT_NOT_PROCESSABLE',
    false,
  );
};
