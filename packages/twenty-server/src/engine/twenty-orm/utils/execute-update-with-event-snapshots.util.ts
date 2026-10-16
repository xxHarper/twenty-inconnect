import { isDefined } from 'twenty-shared/utils';
import { type Driver } from 'typeorm/driver/Driver';
import {
  type EntityMetadata,
  type ObjectLiteral,
  type UpdateResult,
} from 'typeorm';

import {
  TwentyORMException,
  TwentyORMExceptionCode,
} from 'src/engine/twenty-orm/exceptions/twenty-orm.exception';

// Append private scalar columns rather than replacing the caller's RETURNING SQL.
// This preserves projections, expressions, aliases and PostgreSQL value parsers.
export const executeUpdateWithEventSnapshots = async ({
  getReturningExpression,
  entityMetadata,
  driver,
  escape,
  execute,
  beforeIds,
}: {
  getReturningExpression: () => string;
  entityMetadata: EntityMetadata;
  driver: Driver;
  escape: (identifier: string) => string;
  execute: (snapshotReturning: string) => Promise<UpdateResult>;
  beforeIds: string[];
}): Promise<{ result: UpdateResult; recordsAfter: ObjectLiteral[] }> => {
  const returningExpression = getReturningExpression();
  let aliasPrefix = '__twenty_update_snapshot_';

  while (
    returningExpression.toLowerCase().includes(aliasPrefix) ||
    entityMetadata.columns.some((column) =>
      column.databaseName.startsWith(aliasPrefix),
    )
  ) {
    aliasPrefix = `_${aliasPrefix}`;
  }

  const snapshotColumns = entityMetadata.columns.map((column, index) => ({
    column,
    alias: `${aliasPrefix}${index}`,
  }));
  const internalReturning = snapshotColumns
    .map(
      ({ column, alias }) =>
        `${escape(entityMetadata.tableName)}.${escape(column.databaseName)} AS ${escape(alias)}`,
    )
    .join(', ');

  const result = await execute(internalReturning);

  const throwCorruptedSnapshot = (): never => {
    throw new TwentyORMException(
      'UPDATE result does not correspond to its captured event snapshots',
      TwentyORMExceptionCode.ORM_EVENT_DATA_CORRUPTED,
    );
  };

  if (
    !Array.isArray(result.raw) ||
    (isDefined(result.affected) && result.raw.length !== result.affected)
  ) {
    return throwCorruptedSnapshot();
  }

  const allowedIds = new Set(beforeIds);
  const returnedIds = new Set<string>();
  const recordsAfter: ObjectLiteral[] = [];
  const callerRows: ObjectLiteral[] = [];
  const hasCallerReturning = getReturningExpression().length > 0;

  for (const rawRow of result.raw) {
    if (
      typeof rawRow !== 'object' ||
      rawRow === null ||
      Array.isArray(rawRow)
    ) {
      return throwCorruptedSnapshot();
    }

    const record: ObjectLiteral = {};
    const callerRow: ObjectLiteral = { ...rawRow };

    for (const { column, alias } of snapshotColumns) {
      if (!Object.prototype.hasOwnProperty.call(rawRow, alias)) {
        return throwCorruptedSnapshot();
      }

      column.setEntityValue(
        record,
        driver.prepareHydratedValue(rawRow[alias], column),
      );
      delete callerRow[alias];
    }

    if (
      typeof record.id !== 'string' ||
      !allowedIds.has(record.id) ||
      returnedIds.has(record.id)
    ) {
      return throwCorruptedSnapshot();
    }

    returnedIds.add(record.id);
    recordsAfter.push(record);
    if (hasCallerReturning) {
      callerRows.push(callerRow);
    }
  }

  return { result: { ...result, raw: callerRows }, recordsAfter };
};
