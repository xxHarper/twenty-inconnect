import {
  DataSource,
  EntitySchema,
  SelectQueryBuilder,
  type QueryRunner,
  type ObjectLiteral,
} from 'typeorm';

import { computeEventSelectQueryBuilder } from 'src/engine/twenty-orm/utils/compute-event-select-query-builder.util';
import { executeUpdateWithEventSnapshots } from 'src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util';

const connection = new DataSource({
  type: 'postgres',
  entities: [
    new EntitySchema<ObjectLiteral>({
      name: 'comparableRecord',
      tableName: '_comparable_record',
      columns: {
        id: { type: 'uuid', primary: true },
        ownerId: { type: 'uuid', name: 'physical_owner_id' },
        name: { type: String, select: false },
        timestamp: { type: 'timestamptz' },
        amount: { type: 'numeric' },
        details: { type: 'jsonb' },
      },
      embeddeds: {
        profile: {
          schema: new EntitySchema({
            name: 'profile',
            columns: { label: { type: String } },
          }),
        },
      },
      relations: {
        owner: {
          type: 'many-to-one',
          target: 'comparableMember',
          joinColumn: { name: 'physical_owner_id' },
        },
      },
    }),
    new EntitySchema({
      name: 'comparableMember',
      columns: { id: { type: 'uuid', primary: true } },
    }),
  ],
});

beforeAll(async () => {
  await (
    connection as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

const buildSelector = (selectAllColumns: boolean) => {
  const builder = connection
    .createQueryBuilder('comparableRecord', 'record')
    .select(['record.id', 'record.ownerId'])
    .where('record.id = :id', { id: 'abcdefab-1234-4567-89ab-abcdefabcdef' })
    .update()
    .set({ ownerId: 'new-owner' });
  const selector = computeEventSelectQueryBuilder({
    queryBuilder: builder as never,
    expressionMap: builder.expressionMap,
    objectRecordsPermissions: {},
    internalContext: {} as never,
    authContext: {} as never,
    featureFlagMap: {} as never,
    selectAllColumns,
  });
  return { builder, selector };
};

describe('complete private UPDATE event selection', () => {
  it('preserves the existing partial selector contract for other mutation builders', () => {
    const { builder, selector } = buildSelector(false);
    expect(selector.expressionMap.selects).toEqual(
      builder.expressionMap.selects,
    );
    expect(selector.getQuery()).not.toContain('"name"');
  });

  it('hydrates complete comparable BEFORE/AFTER including hidden, embedded, typed and relation columns without expanding the public projection', async () => {
    const { builder, selector } = buildSelector(true);
    const metadata = connection.getMetadata('comparableRecord');
    const physicalRow: Record<string, unknown> = {
      id: 'abcdefab-1234-4567-89ab-abcdefabcdef',
      physical_owner_id: 'old-owner',
      name: 'Unchanged',
      timestamp: new Date('2026-10-16T15:00:00Z'),
      amount: '12345678901234567890.12345',
      details: { nested: [1, 2] },
      profileLabel: 'Unchanged profile',
    };
    const query = jest.fn().mockResolvedValue({
      records: [
        Object.fromEntries(
          metadata.columns.map((column) => [
            `record_${column.databaseName}`,
            physicalRow[column.databaseName],
          ]),
        ),
      ],
    });
    selector.setQueryRunner({
      query,
      isTransactionActive: false,
      isReleased: false,
      broadcaster: { broadcast: jest.fn().mockResolvedValue(undefined) },
    } as unknown as QueryRunner);
    // Exercise native TypeORM hydration with only SQL transport replaced. Scope
    // enforcement is tested independently by the WorkspaceSelect builder suites.
    const beforeRecords =
      await SelectQueryBuilder.prototype.getMany.call(selector);
    const { recordsAfter, result } = await executeUpdateWithEventSnapshots({
      entityMetadata: metadata,
      driver: connection.driver,
      escape: (name) => connection.driver.escape(name),
      getReturningExpression: () => '"id"',
      beforeIds: [physicalRow.id as string],
      execute: async (projection) => ({
        raw: [
          {
            id: physicalRow.id,
            ...Object.fromEntries(
              [...projection.matchAll(/AS "([^"]+)"/g)].map((match, index) => [
                match[1],
                metadata.columns[index].databaseName === 'physical_owner_id'
                  ? 'new-owner'
                  : physicalRow[metadata.columns[index].databaseName],
              ]),
            ),
          },
        ],
        affected: 1,
        generatedMaps: [],
      }),
    });
    expect(beforeRecords).toEqual([
      {
        id: physicalRow.id,
        ownerId: 'old-owner',
        name: physicalRow.name,
        timestamp: physicalRow.timestamp,
        amount: physicalRow.amount,
        details: physicalRow.details,
        profile: { label: 'Unchanged profile' },
      },
    ]);
    expect(recordsAfter).toEqual([
      { ...beforeRecords[0], ownerId: 'new-owner' },
    ]);
    expect(result.raw).toEqual([{ id: physicalRow.id }]);
    expect(builder.expressionMap.selects).toEqual([
      { selection: 'record.id' },
      { selection: 'record.ownerId' },
    ]);
    expect(selector.getQuery()).toContain('"record"."name"');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
