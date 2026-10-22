import { type QueryRunner } from 'typeorm';

import {
  type AttentionProjectionFacts,
  type AttentionProjectionPlan,
  type ScopedAttentionEvent,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import {
  type AttentionEpochRow,
  type AttentionMessageColumns,
  type AttentionPersistenceError,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';

// Internal backend contract only. IDs and historical attribution grant no access.
// The caller resolves/authenticates the source and owns the primary transaction.
export type AttentionReaderInput = Readonly<{
  queryRunner: QueryRunner;
  input: ScopedAttentionEvent;
}>;

export type AttentionReaderError = Readonly<{
  code:
    | AttentionPersistenceError['code']
    | 'QUERY_FAILED'
    | 'INCORRECT_TRANSACTION'
    | 'INCOMPLETE_PROJECTION'
    | 'SNAPSHOT_CHANGED'
    | 'SCHEMA_NOT_INSTALLED'
    | 'GATE_MISSING'
    | 'TRACKING_DISABLED'
    | 'TRACKING_PREPARING'
    | 'TRACKING_SUSPENDED'
    | 'CONVERSATION_MISSING'
    | 'EPOCH_UNPREPARED'
    | 'EPOCH_MISSING'
    | 'EPOCH_PREPARING'
    | 'EPOCH_SUSPENDED'
    | 'EPOCH_CLOSED'
    | 'INVALID_CONFIGURATION'
    | 'INVALID_PROJECTION';
  path: string;
  sqlState?: string;
}>;

export type AttentionReaderResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        plan: AttentionProjectionPlan;
        facts: AttentionProjectionFacts;
        epoch: AttentionEpochRow;
        sourceMessage: AttentionMessageColumns | null;
        // These obligations are deliberately not certified by a persistence read.
        unresolved: readonly [
          'CURRENT_AUTHORITY',
          'SOURCE_AUTHENTICATION_AND_CORRELATION',
          'EVIDENCE_ID_BINDING_AND_OUTBOUND_ADMISSION',
          'PHYSICAL_POSTGRESQL_ACCEPTANCE',
        ];
      }>;
    }>
  | Readonly<{ ok: false; error: AttentionReaderError }>;
