import { type EntityManager } from 'typeorm';

import { decodeReceiptIngressContract } from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';

export const READ_RECEIPT_INGRESS_CONTRACT_SQL = `SELECT
  to_jsonb(receipt) ? 'ingressContractVersion' AS installed,
  to_jsonb(receipt)->'ingressContractVersion' AS version
  FROM core."inconnectMessagingWebhookReceipt" receipt
  WHERE "id" = $1::uuid AND "workspaceId" = $2::uuid AND "providerConnectionId" = $3::uuid`;

// Inert version projection only, NOT an admission or current processing grant.
// The future caller must separately validate the entire frozen fact, claim,
// current connection, Message, epoch and complete ledger in its locked unit.
export const readReceiptIngressContract = async (
  manager: EntityManager,
  scope: Readonly<{
    receiptId: string;
    workspaceId: string;
    providerConnectionId: string;
  }>,
) => {
  const rows: unknown = await manager.query(READ_RECEIPT_INGRESS_CONTRACT_SQL, [
    scope.receiptId,
    scope.workspaceId,
    scope.providerConnectionId,
  ]);
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !rows[0] ||
    typeof rows[0].installed !== 'boolean'
  )
    throw new Error('Incomplete receipt version projection');
  return decodeReceiptIngressContract(
    rows[0].installed,
    rows[0].installed ? rows[0].version : undefined,
  );
};
