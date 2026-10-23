import { type QueryRunner } from 'typeorm';

import { type AttentionTrackingScope } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';

// Backend references to verify, never authority supplied by an HTTP/job payload.
// Locks must precede the causal INSERT; no flag can certify that history here.
export type DurableInboundAttentionInput = Readonly<{
  queryRunner: QueryRunner;
  scope: AttentionTrackingScope;
  receiptId: string;
  leaseToken: string;
  messageId: string;
}>;
