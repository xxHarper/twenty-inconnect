import { DataSource, EntitySchema, type ObjectLiteral } from 'typeorm';

import { executeUpdateWithEventSnapshots } from 'src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util';

// Metadata and driver conversion only; this datasource is never initialized.
const connection = new DataSource({
  type: 'postgres',
  entities: [
    new EntitySchema({
      name: 'record',
      tableName: '_record',
      columns: {
        id: { type: 'uuid', primary: true },
        ownerId: { type: 'uuid', name: 'physical_owner_id' },
        timestamp: { type: 'timestamptz' },
        amount: { type: 'numeric' },
        details: { type: 'jsonb' },
      },
    }),
  ],
});
const rawValues = [
  'record-id',
  'new-owner-id',
  new Date('2026-10-16T15:00:00.000Z'),
  '12345678901234567890.12345',
  { primaryPhoneNumber: '1234567890' },
];

beforeAll(async () => {
  await (
    connection as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

const run = async (returningExpression: string, callerRow: ObjectLiteral) => {
  let capturedProjection = '';
  const result = await executeUpdateWithEventSnapshots({
    getReturningExpression: () => returningExpression,
    entityMetadata: connection.getMetadata('record'),
    driver: connection.driver,
    escape: (identifier) => connection.driver.escape(identifier),
    beforeIds: ['record-id'],
    execute: async (projection) => {
      capturedProjection = projection;
      const aliases = [...projection.matchAll(/AS "([^"]+)"/g)].map(
        (match) => match[1],
      );
      return {
        raw: [
          {
            ...callerRow,
            ...Object.fromEntries(
              aliases.map((alias, index) => [alias, rawValues[index]]),
            ),
          },
        ],
        generatedMaps: [],
        affected: 1,
      };
    },
  });
  return { ...result, capturedProjection };
};

describe('executeUpdateWithEventSnapshots', () => {
  it('should hydrate physical names and timestamps without losing numeric precision or JSON values', async () => {
    const { result, recordsAfter, capturedProjection } = await run('"id"', {
      id: 'record-id',
    });
    expect(capturedProjection).toContain('"_record"."physical_owner_id" AS');
    expect(recordsAfter).toEqual([
      {
        id: 'record-id',
        ownerId: 'new-owner-id',
        timestamp: rawValues[2],
        amount: rawValues[3],
        details: rawValues[4],
      },
    ]);
    expect(result.raw).toEqual([{ id: 'record-id' }]);
  });

  it.each([
    '"id" AS "__twenty_update_snapshot_0"',
    'id AS __TWENTY_UPDATE_SNAPSHOT_0',
  ])(
    'should avoid collisions with caller returning aliases (%s)',
    async (expression) => {
      const callerRow = { __twenty_update_snapshot_0: 'caller-value' };
      const { result, recordsAfter, capturedProjection } = await run(
        expression,
        callerRow,
      );
      expect(capturedProjection).not.toContain(
        'AS "__twenty_update_snapshot_0"',
      );
      expect(result.raw).toEqual([callerRow]);
      expect(recordsAfter[0].id).toBe('record-id');
    },
  );

  it('should keep a caller result empty when no RETURNING was requested', async () => {
    const { result, recordsAfter } = await run('', {});
    expect(result.raw).toEqual([]);
    expect(recordsAfter).toHaveLength(1);
  });
});
