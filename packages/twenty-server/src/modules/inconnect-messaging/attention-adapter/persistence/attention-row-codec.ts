import {
  type AttentionPersistenceError,
  type AttentionPersistenceResult,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';

export type RowDecoder<TValue> = (value: unknown, path: string) => TValue;

// Internal control flow only; public boundaries return explicit failures.
class RowDecodeFailure extends Error {
  constructor(readonly failure: AttentionPersistenceError) {
    super(failure.code);
  }
}

export const rejectAttentionRow = (
  code: AttentionPersistenceError['code'],
  path: string,
): never => {
  throw new RowDecodeFailure({ code, path });
};

export const decodeAttentionValue = <TValue>(
  decoder: RowDecoder<TValue>,
  value: unknown,
): AttentionPersistenceResult<TValue> => {
  try {
    return { ok: true, value: decoder(value, '$') };
  } catch (error) {
    if (error instanceof RowDecodeFailure)
      return { ok: false, error: error.failure };
    throw error;
  }
};

export const rowObject =
  <TShape extends Record<string, RowDecoder<unknown>>>(shape: TShape) =>
  (
    value: unknown,
    path: string,
  ): { readonly [TKey in keyof TShape]: ReturnType<TShape[TKey]> } => {
    if (value === null) return rejectAttentionRow('INVALID_NULL', path);
    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return rejectAttentionRow('WRONG_TYPE', path);
    const record = value as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (Object.getOwnPropertySymbols(record).length > 0)
      return rejectAttentionRow('INVALID_VALUE', path);
    if (
      Object.getOwnPropertyNames(record).some(
        (key) => !Object.prototype.hasOwnProperty.call(shape, key),
      )
    )
      return rejectAttentionRow('INVALID_VALUE', path);
    const decoded: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if (!Object.prototype.hasOwnProperty.call(record, key))
        return rejectAttentionRow('MISSING_FIELD', `${path}.${key}`);
      if (!('value' in descriptors[key]))
        return rejectAttentionRow('WRONG_TYPE', `${path}.${key}`);
      decoded[key] = shape[key](descriptors[key].value, `${path}.${key}`);
    }
    // Every property has passed its own decoder; this is not a driver-row cast.
    return Object.freeze(decoded) as {
      readonly [TKey in keyof TShape]: ReturnType<TShape[TKey]>;
    };
  };

export const nullableRowValue =
  <TValue>(decoder: RowDecoder<TValue>): RowDecoder<TValue | null> =>
  (value, path) =>
    value === null ? null : decoder(value, path);

export const rowText =
  (maximumBytes: number): RowDecoder<string> =>
  (value, path) => {
    if (value === null) return rejectAttentionRow('INVALID_NULL', path);
    if (typeof value !== 'string')
      return rejectAttentionRow('WRONG_TYPE', path);
    if (
      value.length === 0 ||
      value.trim() !== value ||
      value.includes('\u0000') ||
      Array.from(value).some(
        (character) =>
          character.length === 1 &&
          character.charCodeAt(0) >= 0xd800 &&
          character.charCodeAt(0) <= 0xdfff,
      )
    )
      return rejectAttentionRow('INVALID_VALUE', path);
    if (Buffer.byteLength(value, 'utf8') > maximumBytes)
      return rejectAttentionRow('CAPACITY_EXCEEDED', path);
    return value;
  };

export const rowUuid: RowDecoder<string> = (value, path) => {
  const identifier = rowText(36)(value, path);
  // PostgreSQL's normalized UUID output has no version/variant restriction.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      identifier,
    )
  )
    return rejectAttentionRow('INVALID_UUID', path);
  return identifier;
};

export const rowRevision: RowDecoder<string> = (value, path) => {
  if (value === null) return rejectAttentionRow('INVALID_NULL', path);
  if (typeof value !== 'string') return rejectAttentionRow('WRONG_TYPE', path);
  if (value.trim() !== value || !/^(0|[1-9][0-9]*)$/.test(value))
    return rejectAttentionRow('INVALID_REVISION', path);
  return value;
};

export const rowChoice =
  <TValue extends string | number>(
    choices: readonly TValue[],
    version = false,
  ): RowDecoder<TValue> =>
  (value, path) => {
    if (value === null) return rejectAttentionRow('INVALID_NULL', path);
    if (typeof value !== typeof choices[0])
      return rejectAttentionRow('WRONG_TYPE', path);
    const selected = choices.find((choice) => choice === value);
    if (selected === undefined)
      return rejectAttentionRow(
        version ? 'INCOMPATIBLE_VERSION' : 'INVALID_VALUE',
        path,
      );
    return selected;
  };

export const rowBoolean: RowDecoder<boolean> = (value, path) => {
  if (value === null) return rejectAttentionRow('INVALID_NULL', path);
  if (typeof value !== 'boolean') return rejectAttentionRow('WRONG_TYPE', path);
  return value;
};

export const rowTimestamp: RowDecoder<string> = (value, path) => {
  const timestamp = rowText(40)(value, path);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2})(?::?(\d{2}))?)$/.exec(
      timestamp,
    );
  if (!match) return rejectAttentionRow('INVALID_VALUE', path);
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number(match[9] ?? 0) > 15 ||
    Number(match[10] ?? 0) > 59
  )
    return rejectAttentionRow('INVALID_VALUE', path);
  return timestamp;
};

export const rowScope = {
  workspaceId: rowUuid,
  conversationId: rowUuid,
  providerConnectionId: rowUuid,
  trackingEpochId: rowUuid,
};
export const rowStatus = rowChoice(['PENDING', 'ATTENDED'] as const);
export const rowEventKind = rowChoice([
  'INBOUND_RECEIVED',
  'MESSAGES_READ',
  'MANUAL_ACTION',
  'RESPONSE_INTENDED',
  'PROVIDER_EVIDENCE',
] as const);
export const rowFormat = rowChoice(['FREEFORM', 'TEMPLATE'] as const);
export const rowProvenanceKind = rowChoice([
  'HUMAN',
  'AUTOMATION',
  'LEGACY_UNKNOWN',
] as const);
export const rowProviderStatus = rowChoice([
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'UNKNOWN',
] as const);
