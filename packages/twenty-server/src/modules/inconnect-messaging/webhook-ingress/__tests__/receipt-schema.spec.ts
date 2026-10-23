import { RECEIPT_INGRESS_UP } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1792666800000-add-inconnect-messaging-ingress-contract';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

import { protectedRequest } from './authenticated-ingress.fixtures';
import { receiptCatalogFixture } from './receipt-schema.fixtures';

type Catalog = ReturnType<typeof receiptCatalogFixture>['catalog'];

const rejectCatalog = async (
  fixture: ReturnType<typeof receiptCatalogFixture>,
) => {
  await expect(
    fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
  ).rejects.toBeDefined();
  expect(fixture.query.mock.calls).toEqual([[RECEIPT_INGRESS_SCHEMA_SQL]]);
  expect(fixture.state.original).toBeNull();
  expect(fixture.state.committed).toBe(false);
  expect(fixture.builder.values).not.toHaveBeenCalled();
  expect(fixture.add).not.toHaveBeenCalled();
  expect(fixture.external).not.toHaveBeenCalled();
};

describe('P2-SCHEMA-01 catalog admission (SOURCE-ONLY; no PostgreSQL)', () => {
  it.each(['O', 'A'])(
    'accepts nominal unconditional, table-wide triggers enabled as %s',
    async (enabled) => {
      const fixture = receiptCatalogFixture();
      fixture.catalog.triggers.forEach((row) => (row.tgenabled = enabled));
      await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
      expect(fixture.projection.mock.results[0].value).toEqual([
        { installed: true, compatible: true },
      ]);
      expect(fixture.state.original?.ingressContractVersion).toBe(1);
      expect(fixture.add).toHaveBeenCalledTimes(1);
    },
  );

  it('matches both approved CREATE TRIGGER statements without changing the DDL', () => {
    const triggers = RECEIPT_INGRESS_UP.filter((sql) =>
      sql.startsWith('CREATE TRIGGER'),
    ).map((sql) => sql.replace(/\s+/g, ' '));
    expect(triggers).toEqual([
      'CREATE TRIGGER "TR_IM_INGRESS_RECEIPT_WRITE" BEFORE INSERT OR UPDATE OR DELETE ON core."inconnectMessagingWebhookReceipt" FOR EACH ROW EXECUTE FUNCTION core.im_ingress_receipt_guard()',
      'CREATE TRIGGER "TR_IM_INGRESS_RECEIPT_TRUNCATE" BEFORE TRUNCATE ON core."inconnectMessagingWebhookReceipt" FOR EACH STATEMENT EXECUTE FUNCTION core.im_ingress_receipt_truncate_guard()',
    ]);
  });

  it.each<[string, (catalog: Catalog) => void]>([
    [
      'WRITE UPDATE OF ingressContractVersion',
      (catalog) => {
        catalog.triggers[0].tgattr = [17];
      },
    ],
    [
      'WRITE UPDATE OF normalizedMetadata',
      (catalog) => {
        catalog.triggers[0].tgattr = [9];
      },
    ],
    [
      'WRITE UPDATE OF multiple columns',
      (catalog) => {
        catalog.triggers[0].tgattr = [9, 17];
      },
    ],
    [
      'WRITE WHEN false',
      (catalog) => {
        catalog.triggers[0].tgqual =
          '{CONST :consttype 16 :constisnull false :constvalue 1 [ 0 ]}';
      },
    ],
    [
      'WRITE WHEN true',
      (catalog) => {
        catalog.triggers[0].tgqual =
          '{CONST :consttype 16 :constisnull false :constvalue 1 [ 1 ]}';
      },
    ],
    [
      'TRUNCATE contradictory column list',
      (catalog) => {
        catalog.triggers[1].tgattr = [17];
      },
    ],
    [
      'TRUNCATE WHEN false',
      (catalog) => {
        catalog.triggers[1].tgqual =
          '{CONST :consttype 16 :constisnull false :constvalue 1 [ 0 ]}';
      },
    ],
    [
      'TRUNCATE WHEN true',
      (catalog) => {
        catalog.triggers[1].tgqual =
          '{CONST :consttype 16 :constisnull false :constvalue 1 [ 1 ]}';
      },
    ],
    [
      'WRITE missing',
      (catalog) => {
        catalog.triggers.shift();
      },
    ],
    [
      'TRUNCATE missing',
      (catalog) => {
        catalog.triggers.pop();
      },
    ],
    [
      'all triggers missing',
      (catalog) => {
        catalog.triggers = [];
      },
    ],
    [
      'CHECK missing',
      (catalog) => {
        catalog.constraints = [];
      },
    ],
    [
      'CHECK not validated',
      (catalog) => {
        catalog.constraints[0].convalidated = false;
      },
    ],
    [
      'wrong CHECK kind',
      (catalog) => {
        catalog.constraints[0].contype = 'f';
      },
    ],
    [
      'wrong CHECK name',
      (catalog) => {
        catalog.constraints[0].conname = 'other';
      },
    ],
    [
      'CHECK on another table',
      (catalog) => {
        catalog.constraints[0].conrelid = 'core.other';
      },
    ],
    [
      'wrong column type',
      (catalog) => {
        catalog.attributes[0].atttypid = 'pg_catalog.text';
      },
    ],
    [
      'NOT NULL column',
      (catalog) => {
        catalog.attributes[0].attnotnull = true;
      },
    ],
    [
      'column default',
      (catalog) => {
        catalog.attributes[0].atthasdef = true;
      },
    ],
  ])(
    'rejects %s before INSERT, fallback, commit or enqueue',
    async (_name, change) => {
      const fixture = receiptCatalogFixture();
      change(fixture.catalog);
      await rejectCatalog(fixture);
      expect(fixture.projection.mock.results[0].value).toEqual([
        { installed: true, compatible: false },
      ]);
    },
  );

  describe.each([0, 1])('trigger index %s', (index) => {
    it.each([
      { tgenabled: 'D' },
      { tgenabled: 'R' },
      { tgfoid: 'core.other_guard()' },
      { tgtype: 0 },
      { tgtype: 29 },
      { tgisinternal: true },
      { tgrelid: 'core.other' },
      { tgname: 'other' },
    ])('rejects incompatible attributes %j', async (change) => {
      const fixture = receiptCatalogFixture();
      Object.assign(fixture.catalog.triggers[index], change);
      await rejectCatalog(fixture);
    });
  });

  it('preserves genuine PRE_DDL through the legacy persister without a v1 INSERT', async () => {
    const fixture = receiptCatalogFixture();
    fixture.catalog.attributes = [];
    fixture.catalog.triggers = [];
    fixture.catalog.constraints = [];
    await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
    expect(fixture.projection.mock.results[0].value).toEqual([
      { installed: false, compatible: true },
    ]);
    expect(fixture.query.mock.calls).toEqual([[RECEIPT_INGRESS_SCHEMA_SQL]]);
    expect(fixture.builder.values.mock.calls[0][0]).not.toHaveProperty(
      'ingressContractVersion',
    );
    expect(fixture.add).toHaveBeenCalledTimes(1);
  });

  it.each(
    [
      [],
      [
        { installed: true, compatible: true },
        { installed: true, compatible: true },
      ],
      [{ installed: true }],
      [{ compatible: true }],
      [{ installed: false, compatible: false }],
      [{ installed: 'false', compatible: true }],
      [{ installed: true, compatible: 'true' }],
    ].map((rows) => ({ rows })),
  )('rejects malformed or partial SQL envelope $rows', async ({ rows }) => {
    const fixture = receiptCatalogFixture();
    fixture.projection.mockReturnValueOnce(rows);
    await rejectCatalog(fixture);
  });

  it('propagates schema SQL errors without interpreting them as PRE_DDL', async () => {
    const fixture = receiptCatalogFixture();
    fixture.projection.mockImplementationOnce(() => {
      throw new Error('catalog unavailable');
    });
    await rejectCatalog(fixture);
  });

  it.each([null, 1])(
    'retains duplicate identity, first arrival and version %s',
    async (version) => {
      const fixture = receiptCatalogFixture();
      await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
      fixture.state.duplicate = true;
      fixture.state.original!.ingressContractVersion = version;
      const original = structuredClone(fixture.state.original);
      fixture.add.mockClear();
      const verified = await fixture.verify();
      if (!verified.capability) throw new Error('Missing authentic capability');
      const result = await fixture.service.persistAuthenticatedInbound(
        verified.capability,
      );
      expect(result.admission).toBe(
        version === null ? 'DUPLICATE_LEGACY' : 'DUPLICATE_V1',
      );
      expect(result.receipt.id).toBe(original!.id);
      expect(fixture.state.original).toEqual(original);
      expect(
        fixture.query.mock.calls.some(([sql]) => /\bUPDATE\b/.test(sql)),
      ).toBe(false);
      expect(fixture.add).toHaveBeenCalledTimes(1);
    },
  );
});
