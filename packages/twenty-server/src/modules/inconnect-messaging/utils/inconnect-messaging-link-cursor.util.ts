import { validate as isUuid } from 'uuid';

import {
  decodeCursor,
  encodeCursorData,
} from 'src/engine/api/graphql/graphql-query-runner/utils/cursors.util';
import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

export type InconnectMessagingLinkCandidateCursor = {
  id: string;
  label: string;
};

export const encodeInconnectMessagingLinkCandidateCursor = ({
  id,
  label,
}: InconnectMessagingLinkCandidateCursor): string =>
  encodeCursorData({ id, kind: 'link-candidate', label, version: 1 });

export const decodeInconnectMessagingLinkCandidateCursor = (
  cursor: string,
): InconnectMessagingLinkCandidateCursor => {
  let decoded: unknown;

  try {
    decoded = decodeCursor(cursor);
  } catch {
    throw new UserInputError('Invalid INCONNECT Messaging link cursor');
  }

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw new UserInputError('Invalid INCONNECT Messaging link cursor');
  }

  const candidate = decoded as Record<string, unknown>;

  if (
    candidate.version !== 1 ||
    candidate.kind !== 'link-candidate' ||
    typeof candidate.id !== 'string' ||
    !isUuid(candidate.id) ||
    typeof candidate.label !== 'string'
  ) {
    throw new UserInputError('Invalid INCONNECT Messaging link cursor');
  }

  return { id: candidate.id, label: candidate.label };
};
