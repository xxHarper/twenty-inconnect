import { type QueryRunner } from 'typeorm';

import { createAttentionReadSession } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';

// Inert building block, no administrative entry point. ALL authorized connection
// writers must adopt gate-first ordering before revocation can be serialized.
// The caller owns the transaction and must abort on every error.
export const prepareProviderConnectionDisable = async (
  queryRunner: QueryRunner,
  workspaceId: string,
  providerConnectionId: string,
): Promise<void> => {
  const session = createAttentionReadSession(queryRunner);
  await session.verify();
  const gate = await session.query(
    `SELECT "workspaceId"
    FROM core."inconnectMessagingConfiguration" WHERE "workspaceId" = $1::uuid FOR UPDATE`,
    [workspaceId],
  );
  if (gate.length !== 1) throw new Error('Configuration required');
  const changed = await session.query(
    `WITH changed AS (
    UPDATE core."inconnectMessagingProviderConnection"
    SET "lifecycleStatus" = 'DISABLED', "updatedAt" = now()
    WHERE "workspaceId" = $1::uuid AND "id" = $2::uuid RETURNING "id"
  ) SELECT "id" FROM changed`,
    [workspaceId, providerConnectionId],
  );
  if (changed.length !== 1) throw new Error('Connection required');
  await session.verify();
};
