import { type QueryRunner } from 'typeorm';

import {
  createAttentionReadSession,
  AttentionReadFailure,
  type AttentionReadSession,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { type AttentionWriterError } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';

export class AttentionWriteFailure extends Error {
  constructor(readonly failure: AttentionWriterError) {
    super(failure.code);
  }
}
export const failAttentionWrite = (
  code: AttentionWriterError['code'],
  path: string,
): never => {
  throw new AttentionWriteFailure({ code, path });
};
const sqlState = (error: unknown): string | undefined => {
  if (error === null || typeof error !== 'object') return undefined;
  const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
};

export const createAttentionWriteSession = (queryRunner: QueryRunner) => {
  const session = createAttentionReadSession(queryRunner);
  const control = async (statement: string) => {
    // Reuse the accepted runner/session protocol on both sides of SET CONSTRAINTS.
    await session.verify();
    let result: unknown;
    try {
      result = await queryRunner.query(statement, [], true);
    } catch (error) {
      throw new AttentionWriteFailure({
        code: 'WRITE_FAILED',
        path: '$.constraints',
        sqlState: sqlState(error),
      });
    }
    if (
      result === null ||
      typeof result !== 'object' ||
      !('records' in result) ||
      !Array.isArray(result.records) ||
      result.records.length !== 0 ||
      !('raw' in result) ||
      result.raw !== result.records ||
      !('affected' in result) ||
      result.affected !== null
    )
      return failAttentionWrite('INCOMPLETE_WRITE', '$.constraints.result');
    await session.verify();
  };
  return { session, control };
};

export const writeAttentionRow = async (
  session: AttentionReadSession,
  statement: string,
  parameters: readonly unknown[],
) => {
  try {
    return await session.one(statement, parameters);
  } catch (error) {
    // Preserve safe SQLSTATE; do not retry or turn UNIQUE into DUPLICATE.
    if (error instanceof AttentionReadFailure) {
      const failure = error.failure;
      if (failure.code === 'QUERY_FAILED')
        throw new AttentionWriteFailure({ ...failure, code: 'WRITE_FAILED' });
      if (failure.code === 'INCOMPLETE_PROJECTION')
        return failAttentionWrite('INCOMPLETE_WRITE', '$.write.result');
    }
    throw error;
  }
};
