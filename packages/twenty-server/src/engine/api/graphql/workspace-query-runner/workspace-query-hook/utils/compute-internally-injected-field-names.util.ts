import { isDefined } from 'twenty-shared/utils';

type WriteData = Record<string, unknown> | Record<string, unknown>[];

const asRecordArray = (
  data: unknown,
): Record<string, unknown>[] | undefined => {
  if (Array.isArray(data)) {
    return data.every(
      (record): record is Record<string, unknown> =>
        typeof record === 'object' && record !== null,
    )
      ? data
      : undefined;
  }

  return typeof data === 'object' && data !== null
    ? [data as Record<string, unknown>]
    : undefined;
};

export const computeInternallyInjectedFieldNames = ({
  dataBeforeHooks,
  dataAfterHooks,
}: {
  dataBeforeHooks: WriteData | undefined;
  dataAfterHooks: WriteData | undefined;
}): string[] => {
  const recordsBeforeHooks = asRecordArray(dataBeforeHooks);
  const recordsAfterHooks = asRecordArray(dataAfterHooks);

  if (
    !isDefined(recordsBeforeHooks) ||
    !isDefined(recordsAfterHooks) ||
    recordsBeforeHooks.length !== recordsAfterHooks.length
  ) {
    return [];
  }

  const fieldNamesAfterHooks = new Set(
    recordsAfterHooks.flatMap((record) => Object.keys(record)),
  );

  return [...fieldNamesAfterHooks].filter((fieldName) =>
    recordsBeforeHooks.every(
      (record) => !Object.prototype.hasOwnProperty.call(record, fieldName),
    ),
  );
};
