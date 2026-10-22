import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { ApiPath } from 'twenty-shared/types';

import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type AttentionWriterInput } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { createAttentionReadSession } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { INBOUND_ATTENTION_ADMISSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/inbound-attention-sql';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TWILIO_WHATSAPP_PROVIDER_KEY } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';

// No exported authenticated token or caller-supplied trusted boolean. The raw
// signed form must still be available; a stored Receipt alone cannot mint this.
export const admitSignedInbound = async ({
  context,
  expected,
  request,
  webhook,
  providerRegistry,
  secretEncryptionService,
}: {
  context: Parameters<AttentionWriterInput['admit']>[0];
  expected: AttentionWriterInput['input'];
  request: InconnectMessagingWebhookRequest;
  webhook: NonNullable<AttentionWriterInput['causal']['webhook']>;
  providerRegistry: InconnectMessagingProviderRegistry;
  secretEncryptionService: SecretEncryptionService;
}): ReturnType<AttentionWriterInput['admit']> => {
  const { input, queryRunner } = context;
  if (
    input.event.kind !== 'INBOUND_RECEIVED' ||
    !isDeepStrictEqual(input, expected) ||
    !isDeepStrictEqual(context.snapshot.scope, input.scope) ||
    request.kind !== 'INBOUND_MESSAGE' ||
    request.contentType?.split(';')[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
  )
    return null;

  // Bind the signed URL to the same routing key used in the database. A token
  // shared by two connections must not let a signed URL select the other one.
  if (
    new URL(request.effectiveUrl).pathname !==
    `/${ApiPath.Webhooks}/inconnect-messaging/twilio/whatsapp/${encodeURIComponent(request.routingKey)}/inbound`
  )
    return null;

  const parameters: Record<string, string | string[]> = Object.create(null);
  for (const [name, value] of new URLSearchParams(request.rawBody)) {
    const previous = parameters[name];
    parameters[name] =
      previous === undefined
        ? value
        : typeof previous === 'string'
          ? [previous, value]
          : [...previous, value];
  }
  // The signature and the durable payload hash must describe the same form.
  if (!isDeepStrictEqual({ ...parameters }, { ...request.parameters }))
    return null;

  const scope = input.scope;
  const session = createAttentionReadSession(queryRunner);
  await session.verify();
  const rows = await session.query(INBOUND_ATTENTION_ADMISSION_SQL, [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
    webhook.id,
    webhook.leaseToken,
    input.event.messageId,
    request.routingKey,
  ]);
  await session.verify();
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (
    row === null ||
    typeof row !== 'object' ||
    !('encryptedCredentials' in row) ||
    typeof row.encryptedCredentials !== 'string' ||
    !('inboundRoutingKey' in row) ||
    row.inboundRoutingKey !== request.routingKey ||
    !('routingCount' in row) ||
    row.routingCount !== '1' ||
    !('provider' in row) ||
    row.provider !== 'TWILIO' ||
    !('channel' in row) ||
    row.channel !== 'WHATSAPP' ||
    !('lifecycleStatus' in row) ||
    row.lifecycleStatus !== 'ENABLED' ||
    !('eventKind' in row) ||
    row.eventKind !== 'INBOUND_MESSAGE' ||
    !('processingState' in row) ||
    row.processingState !== 'PROCESSING' ||
    !('leaseToken' in row) ||
    row.leaseToken !== webhook.leaseToken ||
    !('leaseValid' in row) ||
    row.leaseValid !== true ||
    !('direction' in row) ||
    row.direction !== 'INBOUND' ||
    !('firstReceivedAt' in row) ||
    typeof row.firstReceivedAt !== 'string'
  )
    return null;

  const credentials: unknown = JSON.parse(
    secretEncryptionService.decryptVersionedOrThrow(
      row.encryptedCredentials as EncryptedString,
      { workspaceId: scope.workspaceId },
    ),
  );
  if (
    credentials === null ||
    typeof credentials !== 'object' ||
    Array.isArray(credentials)
  )
    return null;
  const provider = providerRegistry.resolve(TWILIO_WHATSAPP_PROVIDER_KEY);
  // The provider port expects JSON credentials; parsing above establishes the
  // object boundary and its real signature verifier validates credential fields.
  if (
    !provider.validateWebhookSignature({
      credentials: credentials as Record<string, unknown>,
      request: { ...request, parameters },
    })
  )
    return null;
  const payloadHash = createHash('sha256')
    .update(request.rawBody, 'utf8')
    .digest('hex');
  const normalized = provider.normalizeWebhook({
    request: {
      ...request,
      parameters,
      serverReceivedAt: new Date(row.firstReceivedAt),
    },
    payloadHash,
  });
  if (
    normalized.kind !== 'INBOUND_MESSAGE' ||
    !('payloadHash' in row) ||
    row.payloadHash !== payloadHash ||
    !('normalizedMetadata' in row) ||
    !isDeepStrictEqual(row.normalizedMetadata, normalized) ||
    !('idempotencyKey' in row) ||
    row.idempotencyKey !== normalized.idempotencyKey ||
    !('externalAddressNormalized' in row) ||
    row.externalAddressNormalized !== normalized.externalAddressNormalized ||
    !('providerMessageId' in row) ||
    row.providerMessageId !== normalized.providerMessageId ||
    !('body' in row) ||
    row.body !== normalized.body ||
    !('type' in row) ||
    row.type !== normalized.messageType ||
    !('providerMetadata' in row) ||
    !isDeepStrictEqual(row.providerMetadata, normalized.providerMetadata)
  )
    return null;
  return {
    scope,
    eventKey: input.event.eventKey,
    fingerprint: getAttentionEventIdentity(input.event).fingerprint,
    authorityKind: 'BACKEND',
    actorWorkspaceMemberId: null,
    authenticationReference: JSON.stringify([
      'twilio-signature-v1',
      webhook.id,
      payloadHash,
    ]),
    correlationReference: JSON.stringify([
      'inbound-cause-v1',
      webhook.id,
      input.event.messageId,
      normalized.providerMessageId,
    ]),
    evidenceId: null,
    providerStatusEventId: null,
    outboundAdmission: null,
  };
};
