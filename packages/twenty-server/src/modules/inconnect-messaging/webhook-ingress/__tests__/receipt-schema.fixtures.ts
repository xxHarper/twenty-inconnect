import { createHash } from 'node:crypto';

import {
  RECEIPT_INGRESS_SCHEMA_SQL,
  RECEIPT_INGRESS_GATE_SQL,
  RECEIPT_INGRESS_CONNECTION_SQL,
  RECEIPT_INGRESS_INSERT_SQL,
  RECEIPT_INGRESS_ORIGINAL_SQL,
} from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

import {
  protectedFixture,
  protectedRequest,
} from './authenticated-ingress.fixtures';

const RECEIPT_TABLE = 'core."inconnectMessagingWebhookReceipt"';

type TriggerCatalogRow = {
  tgrelid: string;
  tgname: string;
  tgisinternal: boolean;
  tgenabled: string;
  tgtype: number;
  tgfoid: string;
  // Numeric elements of int2vector, not its textual representation.
  tgattr: number[];
  // Opaque pg_node_tree: only SQL NULL means no WHEN condition.
  tgqual: string | null;
};

type ReceiptCatalog = {
  attributes: {
    attrelid: string;
    attname: string;
    attisdropped: boolean;
    atttypid: string;
    attnotnull: boolean;
    atthasdef: boolean;
  }[];
  triggers: TriggerCatalogRow[];
  constraints: {
    conrelid: string;
    conname: string;
    contype: string;
    convalidated: boolean;
  }[];
};

export const nominalReceiptCatalog = (): ReceiptCatalog => ({
  attributes: [
    {
      attrelid: RECEIPT_TABLE,
      attname: 'ingressContractVersion',
      attisdropped: false,
      atttypid: 'pg_catalog.int4',
      attnotnull: false,
      atthasdef: false,
    },
  ],
  triggers: [
    {
      tgrelid: RECEIPT_TABLE,
      tgname: 'TR_IM_INGRESS_RECEIPT_WRITE',
      tgisinternal: false,
      tgenabled: 'O',
      tgtype: 31,
      tgfoid: 'core.im_ingress_receipt_guard()',
      tgattr: [],
      tgqual: null,
    },
    {
      tgrelid: RECEIPT_TABLE,
      tgname: 'TR_IM_INGRESS_RECEIPT_TRUNCATE',
      tgisinternal: false,
      tgenabled: 'O',
      tgtype: 34,
      tgfoid: 'core.im_ingress_receipt_truncate_guard()',
      tgattr: [],
      tgqual: null,
    },
  ],
  constraints: [
    {
      conrelid: RECEIPT_TABLE,
      conname: 'CHK_IM_INGRESS_VERSION',
      contype: 'c',
      convalidated: true,
    },
  ],
});

// Independent SQL shape: reject unexpected SQL/parameters. The two optional
// conjunctions are interpreted so removing either reproduces false admission.
// This bounded catalog model does not execute SQL or emulate PostgreSQL.
const SCHEMA_WITHOUT_TRIGGER_RESTRICTIONS = `SELECT
  count(*) = 1 AS installed,
  COALESCE(bool_and(atttypid = 'pg_catalog.int4'::regtype AND NOT attnotnull
    AND NOT atthasdef), true)
    AND (count(*) = 0 OR (
      (SELECT count(*) FROM pg_catalog.pg_trigger
        WHERE tgrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
          AND NOT tgisinternal AND tgenabled IN ('O','A')
          AND ((tgname = 'TR_IM_INGRESS_RECEIPT_WRITE' AND tgtype = 31
            AND tgfoid = to_regprocedure('core.im_ingress_receipt_guard()'))
            OR (tgname = 'TR_IM_INGRESS_RECEIPT_TRUNCATE' AND tgtype = 34
            AND tgfoid = to_regprocedure('core.im_ingress_receipt_truncate_guard()')))) = 2
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
          AND conname = 'CHK_IM_INGRESS_VERSION' AND contype = 'c' AND convalidated)
    )) AS compatible
  FROM pg_catalog.pg_attribute
  WHERE attrelid = to_regclass('core."inconnectMessagingWebhookReceipt"')
    AND attname = 'ingressContractVersion' AND NOT attisdropped`;

export const receiptCatalogFixture = () => {
  const fixture = protectedFixture();
  const catalog = nominalReceiptCatalog();
  const delegate = fixture.query.getMockImplementation()!;
  const request = protectedRequest();
  const payloadHash = createHash('sha256')
    .update(request.rawBody)
    .digest('hex');
  const normalized = fixture.provider.normalizeWebhook({
    request,
    payloadHash,
  });
  const expectedParameters = new Map<string, unknown[] | undefined>([
    [RECEIPT_INGRESS_SCHEMA_SQL, undefined],
    [RECEIPT_INGRESS_GATE_SQL, [fixture.connection.workspaceId]],
    [
      RECEIPT_INGRESS_CONNECTION_SQL,
      [
        fixture.connection.workspaceId,
        fixture.connection.id,
        request.routingKey,
        fixture.connection.encryptedCredentials,
        fixture.connection.credentialsVersion,
      ],
    ],
    [
      RECEIPT_INGRESS_INSERT_SQL,
      [
        fixture.connection.workspaceId,
        fixture.connection.id,
        normalized.idempotencyKey,
        payloadHash,
        request.serverReceivedAt.toISOString(),
        JSON.stringify(normalized),
      ],
    ],
    [
      RECEIPT_INGRESS_ORIGINAL_SQL,
      [
        fixture.connection.workspaceId,
        fixture.connection.id,
        normalized.idempotencyKey,
      ],
    ],
  ]);
  const projection = jest.fn((sql: string): unknown => {
    const unrestricted = sql
      .replace(/\s+AND cardinality\(tgattr::smallint\[\]\) = 0/, '')
      .replace(/\s+AND tgqual IS NULL/, '');
    expect(unrestricted).toBe(SCHEMA_WITHOUT_TRIGGER_RESTRICTIONS);
    const attributes = catalog.attributes.filter(
      (row) =>
        row.attrelid === RECEIPT_TABLE &&
        row.attname === 'ingressContractVersion' &&
        !row.attisdropped,
    );
    const triggers = catalog.triggers.filter(
      (row) =>
        row.tgrelid === RECEIPT_TABLE &&
        !row.tgisinternal &&
        ['O', 'A'].includes(row.tgenabled) &&
        (!sql.includes('cardinality(tgattr::smallint[]) = 0') ||
          row.tgattr.length === 0) &&
        (!sql.includes('tgqual IS NULL') || row.tgqual === null) &&
        ((row.tgname === 'TR_IM_INGRESS_RECEIPT_WRITE' &&
          row.tgtype === 31 &&
          row.tgfoid === 'core.im_ingress_receipt_guard()') ||
          (row.tgname === 'TR_IM_INGRESS_RECEIPT_TRUNCATE' &&
            row.tgtype === 34 &&
            row.tgfoid === 'core.im_ingress_receipt_truncate_guard()')),
    );
    return [
      {
        installed: attributes.length === 1,
        compatible:
          attributes.every(
            (row) =>
              row.atttypid === 'pg_catalog.int4' &&
              !row.attnotnull &&
              !row.atthasdef,
          ) &&
          (attributes.length === 0 ||
            (triggers.length === 2 &&
              catalog.constraints.some(
                (row) =>
                  row.conrelid === RECEIPT_TABLE &&
                  row.conname === 'CHK_IM_INGRESS_VERSION' &&
                  row.contype === 'c' &&
                  row.convalidated,
              ))),
      },
    ];
  });
  fixture.query.mockImplementation(async (sql, parameters) => {
    expect(expectedParameters.has(sql)).toBe(true);
    expect(parameters).toEqual(expectedParameters.get(sql));
    if (sql !== RECEIPT_INGRESS_SCHEMA_SQL) return delegate(sql, parameters);
    return projection(sql);
  });
  return { ...fixture, catalog, projection };
};
