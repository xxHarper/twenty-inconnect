import { z } from 'zod';

import { type QueryRunner } from 'typeorm';

import { type InconnectMessagingOutboxPublicationRequest } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

export type TrackedInboundClaim = Readonly<{
  receiptId: string;
  workspaceId: string;
  providerConnectionId: string;
  leaseToken: string;
}>;
export type TrackedInboundInput = Readonly<{
  queryRunner: QueryRunner;
  claim: TrackedInboundClaim;
}>;
export type PreparedTrackedInbound = Readonly<{
  status: 'PREPARED';
  receiptId: string;
  conversationId: string;
  trackingEpochId: string;
  messageId: string;
  providerMessageId: string;
  workspaceId: string;
  providerConnectionId: string;
  publicationRequests: readonly InconnectMessagingOutboxPublicationRequest[];
}>;

export class TrackedInboundFailure extends Error {
  readonly callerMustRollback = true;
  constructor(readonly category: string) {
    super(category);
  }
}
export const rejectTrackedInbound = (category: string): never => {
  throw new TrackedInboundFailure(category);
};

export class TrackedInboundSqlFailure extends Error {
  constructor(
    readonly code?: string,
    readonly constraint?: string,
  ) {
    super('CAUSAL_SQL_FAILED');
  }
}

// This parses routing/DML inputs only. R3 subsequently verifies the complete
// frozen v1 fact, metadata, timestamps and attachment intent before any commit.
// It is deliberately not an alternative admission or provider normalizer.
export const inboundWriteShape = z.strictObject({
  kind: z.literal('INBOUND_MESSAGE'),
  idempotencyKey: z.string().min(1),
  providerMessageId: z.string().min(1),
  externalAddressNormalized: z.string().regex(/^\+[1-9][0-9]+$/),
  waId: z.string().nullable(),
  body: z.string(),
  messageType: z.enum([
    'TEXT',
    'IMAGE',
    'STICKER',
    'AUDIO',
    'VIDEO',
    'DOCUMENT',
    'CONTACT',
    'LOCATION',
  ]),
  serverReceivedAt: z.iso.datetime(),
  providerOccurredAt: z.iso.datetime().nullable(),
  effectiveInboundAt: z.iso.datetime(),
  timestampSource: z.enum(['PROVIDER', 'SERVER']),
  providerMetadata: z.record(z.string(), z.unknown()),
  attachments: z
    .array(
      z.strictObject({
        ordinal: z.number().int().min(0).max(9),
        type: z.enum([
          'IMAGE',
          'STICKER',
          'AUDIO',
          'VIDEO',
          'DOCUMENT',
          'CONTACT',
        ]),
        providerMediaLocator: z.string().min(1).nullable(),
        declaredMimeType: z.string().min(1).nullable(),
        safeFilename: z.string().min(1).max(180),
      }),
    )
    .max(10),
});

// No runtime switch can assert that the external release obligations are done.
// Changing this boundary needs a reviewed cutover, not an environment boolean.
export const trackedInboundReleaseBlockers = Object.freeze([
  'PHYSICAL_POSTGRESQL_ACCEPTANCE',
  'ALL_CONNECTION_WRITERS_GATE_FIRST',
  'INGRESS_ENABLED_V1_AND_LEGACY_DRAIN',
  'OUTBOUND_AND_MANUAL_WRITER_CUTOVER',
  'RESTORE_CUSTODY_AND_OPERATIONS_ACCEPTANCE',
] as const);
