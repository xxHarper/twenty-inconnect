import { validate as isUuid } from 'uuid';

import {
  decodeCursor,
  encodeCursorData,
} from 'src/engine/api/graphql/graphql-query-runner/utils/cursors.util';
import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

export type InconnectMessagingCursorKind = 'conversation' | 'message';

export type InconnectMessagingCursor = {
  id: string;
  kind: InconnectMessagingCursorKind;
  sortAt: Date;
};

export const encodeInconnectMessagingCursor = ({
  id,
  kind,
  sortAt,
}: InconnectMessagingCursor): string =>
  encodeCursorData({ id, kind, sortAt: sortAt.toISOString(), version: 1 });

export const decodeInconnectMessagingCursor = ({
  cursor,
  expectedKind,
}: {
  cursor: string;
  expectedKind: InconnectMessagingCursorKind;
}): InconnectMessagingCursor => {
  let decoded: unknown;

  try {
    decoded = decodeCursor(cursor);
  } catch {
    throw new UserInputError('Invalid INCONNECT Messaging cursor');
  }

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw new UserInputError('Invalid INCONNECT Messaging cursor');
  }

  const candidate = decoded as Record<string, unknown>;
  const sortAt =
    typeof candidate.sortAt === 'string' ? new Date(candidate.sortAt) : null;

  if (
    candidate.version !== 1 ||
    candidate.kind !== expectedKind ||
    typeof candidate.id !== 'string' ||
    !isUuid(candidate.id) ||
    sortAt === null ||
    Number.isNaN(sortAt.getTime())
  ) {
    throw new UserInputError('Invalid INCONNECT Messaging cursor');
  }

  return { id: candidate.id, kind: expectedKind, sortAt };
};
