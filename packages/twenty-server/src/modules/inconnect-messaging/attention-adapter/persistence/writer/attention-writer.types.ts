import { type QueryRunner } from 'typeorm';

import {
  type AttentionSnapshot,
  type AttentionTrackingScope,
  type OriginalAttentionResult,
  type ScopedAttentionEvent,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { type AttentionStoredResult } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { type AttentionReaderError } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';

// An explicit trusted-backend collaboration, NOT an authorization capability.
// The future implementation must authenticate, reauthorize through Messaging /
// Record Access and bind evidence to its durable source under these same locks.
export type AttentionWriterAdmission = Readonly<{
  scope: AttentionTrackingScope;
  eventKey: string;
  fingerprint: string;
  authorityKind: 'HUMAN' | 'BACKEND' | 'PROVIDER';
  actorWorkspaceMemberId: string | null;
  authenticationReference: string;
  correlationReference: string | null;
  evidenceId: string | null;
  providerStatusEventId: string | null;
  outboundAdmission: 'APPLIED' | 'CONSUMED' | null;
}>;

export type AttentionWriterInput = Readonly<{
  queryRunner: QueryRunner;
  input: ScopedAttentionEvent;
  causal: Readonly<{
    // Already routed/claimed by the caller; never chosen from a public payload.
    webhook: Readonly<{ id: string; leaseToken: string }> | null;
    providerStatusEventId: string | null;
  }>;
  // Read/authorize only: may not mutate ledger, aggregate, causal rows or runner.
  // Causal DML must already exist in this unit, with common locks acquired FIRST.
  admit: (
    context: Readonly<{
      queryRunner: QueryRunner;
      input: ScopedAttentionEvent;
      snapshot: AttentionSnapshot;
      consumption: 'NEW' | 'CONSUMED' | 'CONFLICT';
    }>,
  ) => Promise<AttentionWriterAdmission | null>;
}>;

export type AttentionWriterError = Readonly<{
  code:
    | AttentionReaderError['code']
    | 'AUTHORITY_REQUIRED'
    | 'ADMISSION_FAILED'
    | 'CAUSALITY_VIOLATION'
    | 'CAUSAL_OPERATION_REJECTED'
    | 'WRITE_FAILED'
    | 'INCOMPLETE_WRITE';
  path: string;
  sqlState?: string;
}>;

export type AttentionWriterResult =
  | Readonly<{
      ok: true;
      // No durable success until the caller commits. No publication requested.
      status: 'PREPARED';
      value: Readonly<{
        outcome: AttentionStoredResult;
        snapshot: AttentionSnapshot;
        originals: Readonly<{
          eventResult: OriginalAttentionResult | null;
          effectResult: OriginalAttentionResult | null;
        }>;
        rows: Readonly<{
          auditId: string;
          effectId: string | null;
          receiptId: string | null;
          responseIntentId: string | null;
          outboxId: string | null;
        }>;
      }>;
    }>
  | Readonly<{
      ok: false;
      callerMustRollback: true;
      error: AttentionWriterError;
    }>;
