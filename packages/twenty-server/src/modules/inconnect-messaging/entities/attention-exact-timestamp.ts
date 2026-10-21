import { type ValueTransformer } from 'typeorm';

import {
  decodeAttentionValue,
  rowTimestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';

// pg normally parses timestamptz as Date before TypeORM invokes transformers.
// Reject that lossy path; the future reader must SELECT timestamp::text as raw data.
const requireExactTimestamp = (value: unknown): string | null => {
  if (value === null) return null;
  const decoded = decodeAttentionValue(rowTimestamp, value);

  if (!decoded.ok) {
    throw new Error('Attention timestamps require exact PostgreSQL text');
  }

  return decoded.value;
};

export const ATTENTION_EXACT_TIMESTAMP: ValueTransformer = {
  to: requireExactTimestamp,
  from: requireExactTimestamp,
};
