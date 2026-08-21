const POSTGRES_BIGINT_MAX = '9223372036854775807';

export const isInconnectRecordAccessRevision = (
  value: unknown,
): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  (value.length < POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value <= POSTGRES_BIGINT_MAX));

export const incrementInconnectRecordAccessRevision = (
  revision: string,
): string | undefined => {
  if (!isInconnectRecordAccessRevision(revision)) {
    return undefined;
  }

  const digits = revision.split('').map(Number);
  let carry = 1;

  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const nextDigit = digits[index] + carry;

    digits[index] = nextDigit % 10;
    carry = Math.floor(nextDigit / 10);
  }

  if (carry > 0) {
    digits.unshift(carry);
  }

  const nextRevision = digits.join('');

  return isInconnectRecordAccessRevision(nextRevision)
    ? nextRevision
    : undefined;
};
