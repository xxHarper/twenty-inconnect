import { type InsertResult } from 'typeorm';

import { CommonQueryRunnerException } from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { extractSingleRecordIdFromInsertResult } from 'src/engine/api/common/common-query-runners/utils/extract-single-record-id-from-insert-result.util';

const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RECORD_ID = '22222222-2222-4222-8222-222222222222';

const buildInsertResult = (
  overrides: Partial<InsertResult> = {},
): InsertResult => ({
  identifiers: [{ id: RECORD_ID }],
  generatedMaps: [{ id: RECORD_ID }],
  raw: [{ id: RECORD_ID }],
  ...overrides,
});

describe('extractSingleRecordIdFromInsertResult', () => {
  it('returns the single agreeing UUID', () => {
    expect(extractSingleRecordIdFromInsertResult(buildInsertResult())).toBe(
      RECORD_ID,
    );
  });

  it.each([
    ['zero identifiers', { identifiers: [] }],
    [
      'multiple identifiers',
      { identifiers: [{ id: RECORD_ID }, { id: OTHER_RECORD_ID }] },
    ],
    ['a missing identifier id', { identifiers: [{}] }],
    ['an invalid identifier UUID', { identifiers: [{ id: 'invalid' }] }],
    ['zero generated maps', { generatedMaps: [] }],
    [
      'multiple generated maps',
      {
        generatedMaps: [{ id: RECORD_ID }, { id: OTHER_RECORD_ID }],
      },
    ],
    [
      'an identifier/generated-map mismatch',
      { generatedMaps: [{ id: OTHER_RECORD_ID }] },
    ],
    ['a raw/generated-map mismatch', { raw: [{ id: OTHER_RECORD_ID }] }],
    [
      'multiple raw returned rows',
      { raw: [{ id: RECORD_ID }, { id: RECORD_ID }] },
    ],
  ] satisfies Array<[string, Partial<InsertResult>]>)(
    'fails closed for %s',
    (_label, overrides) => {
      expect(() =>
        extractSingleRecordIdFromInsertResult(buildInsertResult(overrides)),
      ).toThrow(CommonQueryRunnerException);
    },
  );

  it('accepts an empty raw result when identifiers and generated maps agree', () => {
    expect(
      extractSingleRecordIdFromInsertResult(
        buildInsertResult({
          raw: [],
        }),
      ),
    ).toBe(RECORD_ID);
  });
});
