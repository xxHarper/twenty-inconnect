// Only decoded finite Gregorian timestamps (years 0001..9999) reach here.
// This key compares instants at microsecond precision without changing raw text.
// It is never an ordering key for domain events.
export const attentionTimestampMicroseconds = (timestamp: string): bigint => {
  const parts = timestamp.match(/\d+/g)!;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const previousYear = year - 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const days =
    365 * previousYear +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400) +
    daysPerMonth
      .slice(0, month - 1)
      .reduce((total, count) => total + count, 0) +
    day -
    1;
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? '';
  const offset = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(timestamp);
  const offsetSeconds =
    offset === null
      ? 0
      : (offset[1] === '+' ? 1 : -1) *
        (Number(offset[2]) * 3600 + Number(offset[3] ?? 0) * 60);
  const seconds =
    BigInt(days) * BigInt(86400) +
    BigInt(
      Number(parts[3]) * 3600 +
        Number(parts[4]) * 60 +
        Number(parts[5]) -
        offsetSeconds,
    );
  return seconds * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
};
