import {
  incrementInconnectRecordAccessRevision,
  isInconnectRecordAccessRevision,
} from 'src/engine/core-modules/inconnect-record-access/utils/increment-inconnect-record-access-revision.util';

describe('INCONNECT record access revision utilities', () => {
  it.each([
    ['0', '1'],
    ['1', '2'],
    ['9007199254740993', '9007199254740994'],
    ['9223372036854775806', '9223372036854775807'],
  ])(
    'increments %s without JavaScript number precision loss',
    (revision, expected) => {
      expect(incrementInconnectRecordAccessRevision(revision)).toBe(expected);
    },
  );

  it.each(['', '-1', '01', '1.0', '9223372036854775808'])(
    'rejects invalid PostgreSQL bigint revision %s',
    (revision) => {
      expect(isInconnectRecordAccessRevision(revision)).toBe(false);
      expect(incrementInconnectRecordAccessRevision(revision)).toBeUndefined();
    },
  );

  it('does not increment past the PostgreSQL bigint maximum', () => {
    expect(
      incrementInconnectRecordAccessRevision('9223372036854775807'),
    ).toBeUndefined();
  });
});
