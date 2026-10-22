import { type QueryRunner } from 'typeorm';

import { type AttentionPersistenceResult } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import {
  decodeAttentionValue,
  rowBoolean,
  rowObject,
  rowRevision,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { type AttentionReaderError } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';

export class AttentionReadFailure extends Error {
  constructor(readonly failure: AttentionReaderError) {
    super(failure.code);
  }
}
export const failAttentionRead = (
  code: AttentionReaderError['code'],
  path: string,
): never => {
  throw new AttentionReadFailure({ code, path });
};
export const decodeReadValue = <TValue>(
  result: AttentionPersistenceResult<TValue>,
): TValue => {
  if (!result.ok)
    return failAttentionRead(result.error.code, result.error.path);
  return result.value;
};
export const readObject = <
  TShape extends Record<string, (value: unknown, path: string) => unknown>,
>(
  shape: TShape,
  value: unknown,
) => decodeReadValue(decodeAttentionValue(rowObject(shape), value));
export const unknownReadValue = (value: unknown): unknown => value;

const driverState = (error: unknown): string | undefined => {
  if (error === null || typeof error !== 'object') return undefined;
  const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
};

// This is not a connection/transaction factory. A connected exclusive runner is
// required; the installed PostgreSQL runner otherwise connects lazily in query().
export const createAttentionReadSession = (queryRunner: QueryRunner) => {
  const manager = queryRunner.manager;
  const connection = queryRunner.connection;
  if (!manager || !connection)
    return failAttentionRead('INCORRECT_TRANSACTION', '$.queryRunner');
  const databaseConnection: unknown =
    'databaseConnection' in queryRunner
      ? queryRunner.databaseConnection
      : undefined;
  const assertRunner = () => {
    if (
      queryRunner.isReleased !== false ||
      queryRunner.isTransactionActive !== true ||
      queryRunner.manager !== manager ||
      manager.queryRunner !== queryRunner ||
      manager.connection !== connection ||
      queryRunner.connection !== connection ||
      connection.options.type !== 'postgres' ||
      connection.isInitialized !== true ||
      !('mode' in queryRunner) ||
      queryRunner.mode !== 'master' ||
      !('transactionDepth' in queryRunner) ||
      queryRunner.transactionDepth !== 1 ||
      !databaseConnection ||
      !('databaseConnection' in queryRunner) ||
      queryRunner.databaseConnection !== databaseConnection
    )
      return failAttentionRead('INCORRECT_TRANSACTION', '$.queryRunner');
  };
  assertRunner();

  const query = async (
    statement: string,
    parameters: readonly unknown[],
  ): Promise<unknown[]> => {
    assertRunner();
    let result: unknown;
    try {
      result = await queryRunner.query(statement, [...parameters], true);
    } catch (error) {
      throw new AttentionReadFailure({
        code: 'QUERY_FAILED',
        path: '$.query',
        sqlState: driverState(error),
      });
    }
    assertRunner();
    // TypeORM 0.3.31 preserves pg rows and rowCount in structured SELECT output.
    // An incomplete driver envelope can never prove a negative lookup.
    if (
      result === null ||
      typeof result !== 'object' ||
      !('records' in result) ||
      !Array.isArray(result.records) ||
      !('affected' in result) ||
      result.affected !== result.records.length ||
      !('raw' in result) ||
      result.raw !== result.records
    )
      return failAttentionRead('INCOMPLETE_PROJECTION', '$.query.result');
    return result.records;
  };
  const one = async (
    statement: string,
    parameters: readonly unknown[],
  ): Promise<unknown> => {
    const rows = await query(statement, parameters);
    if (rows.length !== 1)
      return failAttentionRead('INCOMPLETE_PROJECTION', '$.query.cardinality');
    return rows[0];
  };
  let transactionIdentity: string | undefined;
  const verify = async () => {
    const session = readObject(
      {
        isolation: unknownReadValue,
        readOnly: unknownReadValue,
        rowSecurity: unknownReadValue,
        inRecovery: rowBoolean,
        backendPid: unknownReadValue,
        transactionId: rowRevision,
        statementTimeout: rowRevision,
        lockTimeout: rowRevision,
      },
      await one(ATTENTION_SESSION_SQL, []),
    );
    if (
      session.isolation !== 'read committed' ||
      session.readOnly !== 'off' ||
      session.rowSecurity !== 'off' ||
      session.inRecovery ||
      typeof session.backendPid !== 'number' ||
      !Number.isSafeInteger(session.backendPid) ||
      session.backendPid <= 0 ||
      BigInt(session.transactionId) < BigInt(1) ||
      BigInt(session.transactionId) > BigInt('18446744073709551615') ||
      BigInt(session.statementTimeout) === BigInt(0) ||
      BigInt(session.lockTimeout) === BigInt(0)
    )
      return failAttentionRead('INCORRECT_TRANSACTION', '$.session');
    const identity = JSON.stringify([
      session.backendPid,
      session.transactionId,
    ]);
    if (transactionIdentity !== undefined && transactionIdentity !== identity)
      return failAttentionRead('INCORRECT_TRANSACTION', '$.session.identity');
    transactionIdentity = identity;
  };
  return { query, one, verify };
};

export type AttentionReadSession = ReturnType<
  typeof createAttentionReadSession
>;
