import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { type DurableInboundAttentionInput } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound.types';
import { rowTimestamp } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { attentionTimestampMicroseconds } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-timestamp';

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const text = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value);
const attachment = z.strictObject({
  ordinal: z.number().int().min(0).max(9),
  type: z.enum(['IMAGE', 'STICKER', 'AUDIO', 'VIDEO', 'DOCUMENT', 'CONTACT']),
  declaredMimeType: text.nullable(),
  safeFilename: z.string().min(1).max(180),
});
const messageType = z.enum([
  'TEXT',
  'IMAGE',
  'STICKER',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'CONTACT',
  'LOCATION',
]);
const timestampSource = z.enum(['PROVIDER', 'SERVER']);
// Fixed v1 storage decoder, NOT a call to today's/future provider normalizer.
// Ingress version 1 fixes this shape, including metadata and attachment intent.
const normalizedV1 = z.strictObject({
  kind: z.literal('INBOUND_MESSAGE'),
  idempotencyKey: text,
  providerMessageId: text,
  externalAddressNormalized: z.string().regex(/^\+[1-9][0-9]+$/),
  waId: text.nullable(),
  body: z.string(),
  messageType,
  serverReceivedAt: z.string(),
  providerOccurredAt: z.string().nullable(),
  effectiveInboundAt: z.string(),
  timestampSource,
  attachments: z
    .array(attachment.extend({ providerMediaLocator: text.nullable() }))
    .max(10),
  providerMetadata: z.strictObject({
    provider: z.literal('TWILIO'),
    channel: z.literal('WHATSAPP'),
    accountSid: text.nullable(),
    from: text,
    waId: text.nullable(),
    messagingServiceSid: text.nullable(),
    to: text.nullable(),
    profileName: text.nullable(),
    media: z.array(z.strictObject({ contentType: text.nullable() })).max(10),
    location: z
      .strictObject({
        latitude: text,
        longitude: text,
        label: text.nullable(),
        name: text.nullable(),
        address: text.nullable(),
      })
      .nullable(),
  }),
});
const backendFact = z.strictObject({
  receiptId: uuid,
  workspaceId: uuid,
  providerConnectionId: uuid,
  eventKind: z.literal('INBOUND_MESSAGE'),
  idempotencyKey: text,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  normalizedMetadata: normalizedV1,
  firstReceivedAt: z.string(),
  processingState: z.literal('PROCESSING'),
  leaseToken: uuid,
  leaseValid: z.literal(true),
  attemptCount: z.number().int().positive(),
  processedAt: z.null(),
  connectionId: uuid,
  connectionWorkspaceId: uuid,
  provider: z.literal('TWILIO'),
  channel: z.literal('WHATSAPP'),
  lifecycleStatus: z.literal('ENABLED'),
  inboundRoutingKey: text,
  credentialsVersion: z.number().int().positive(),
  credentialsConfigured: z.literal(true),
  routingCount: z.literal('1'),
  conversationId: uuid,
  externalAddressNormalized: text,
  currentEpochId: uuid,
  messageId: uuid,
  messageConversationId: uuid,
  messageWorkspaceId: uuid,
  messageConnectionId: uuid,
  originEpochId: uuid,
  direction: z.literal('INBOUND'),
  type: messageType,
  body: z.string(),
  sendMode: z.null(),
  outboundState: z.null(),
  providerMessageId: text,
  providerMetadata: normalizedV1.shape.providerMetadata,
  serverReceivedAt: z.string(),
  providerOccurredAt: z.string().nullable(),
  effectiveInboundAt: z.string(),
  timestampSource,
  attachments: z.array(attachment).max(10),
});

const instant = (value: string) =>
  attentionTimestampMicroseconds(rowTimestamp(value, '$.inbound.timestamp'));
const equalInstant = (left: string | null, right: string | null) =>
  left === null || right === null
    ? left === right
    : instant(left) === instant(right);
const v1Instant = (value: string | null) =>
  value === null ||
  (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    instant(value) >= BigInt(0));

export const decodeDurableInboundFact = (
  value: unknown,
  expected: Omit<DurableInboundAttentionInput, 'queryRunner'>,
) => {
  const parsed = backendFact.safeParse(value);
  if (!parsed.success) return null;
  const fact = parsed.data;
  const normalized = fact.normalizedMetadata;
  const { scope } = expected;
  if (
    fact.receiptId !== expected.receiptId ||
    fact.leaseToken !== expected.leaseToken ||
    fact.workspaceId !== scope.workspaceId ||
    fact.providerConnectionId !== scope.providerConnectionId ||
    fact.connectionId !== scope.providerConnectionId ||
    fact.connectionWorkspaceId !== scope.workspaceId ||
    fact.conversationId !== scope.conversationId ||
    fact.currentEpochId !== scope.trackingEpochId ||
    fact.messageId !== expected.messageId ||
    fact.messageWorkspaceId !== scope.workspaceId ||
    fact.messageConnectionId !== scope.providerConnectionId ||
    fact.messageConversationId !== scope.conversationId ||
    fact.originEpochId !== scope.trackingEpochId ||
    fact.idempotencyKey !== normalized.idempotencyKey ||
    normalized.idempotencyKey !== normalized.providerMessageId ||
    fact.providerMessageId !== normalized.providerMessageId ||
    fact.externalAddressNormalized !== normalized.externalAddressNormalized ||
    fact.type !== normalized.messageType ||
    fact.body !== normalized.body ||
    !isDeepStrictEqual(fact.providerMetadata, normalized.providerMetadata) ||
    normalized.waId !== normalized.providerMetadata.waId ||
    ![
      normalized.serverReceivedAt,
      normalized.providerOccurredAt,
      normalized.effectiveInboundAt,
    ].every(v1Instant) ||
    !equalInstant(fact.firstReceivedAt, normalized.serverReceivedAt) ||
    !equalInstant(fact.serverReceivedAt, normalized.serverReceivedAt) ||
    !equalInstant(fact.providerOccurredAt, normalized.providerOccurredAt) ||
    !equalInstant(fact.effectiveInboundAt, normalized.effectiveInboundAt) ||
    fact.timestampSource !== normalized.timestampSource ||
    normalized.timestampSource !==
      (normalized.providerOccurredAt === null ? 'SERVER' : 'PROVIDER') ||
    normalized.effectiveInboundAt !==
      (normalized.providerOccurredAt ?? normalized.serverReceivedAt) ||
    normalized.attachments.some((item, index) => item.ordinal !== index) ||
    normalized.providerMetadata.media.length !==
      normalized.attachments.length ||
    normalized.attachments.some(
      (item, index) =>
        item.declaredMimeType !==
        normalized.providerMetadata.media[index].contentType,
    ) ||
    !isDeepStrictEqual(
      fact.attachments,
      normalized.attachments.map(
        ({ providerMediaLocator: _locator, ...intent }) => intent,
      ),
    )
  )
    return null;
  // waId on Conversation is mutable across later inbounds. Provider locators,
  // download state, detected MIME, File and bytes have their own media lifecycle.
  return fact;
};
