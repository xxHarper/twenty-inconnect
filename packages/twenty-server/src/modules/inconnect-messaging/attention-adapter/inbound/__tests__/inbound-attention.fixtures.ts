import { createHash, randomUUID } from 'node:crypto';

import Twilio from 'twilio';

import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { INBOUND_ATTENTION_ADMISSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/inbound-attention-sql';
import { prepareSignedInboundAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/inbound/prepare-signed-inbound-attention-write';
import {
  identifier,
  initial,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  sessionRow,
  step,
  type ReadFixture,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  writerRunner,
  writerScript,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { type ConversationAttentionState } from 'src/modules/inconnect-messaging/attention-domain';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { type TwilioWhatsappClientFactory } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-client.factory';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingProviderMediaDeliveryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-media-delivery.service';

export const inboundFixture = (
  fixture: ReadFixture = {},
  before: ConversationAttentionState = initial(),
  extraParameters: Record<string, string> = {},
) => {
  const parameters = {
    MessageSid: 'provider-message',
    From: 'whatsapp:+525512345678',
    Body: 'hola',
    NumMedia: '0',
    ...extraParameters,
  };
  const request: InconnectMessagingWebhookRequest = {
    kind: 'INBOUND_MESSAGE',
    routingKey: 'private-route',
    effectiveUrl:
      'https://crm.example.test/webhooks/inconnect-messaging/twilio/whatsapp/private-route/inbound',
    contentType: 'application/x-www-form-urlencoded',
    signature: '',
    rawBody: new URLSearchParams(parameters).toString(),
    parameters,
    serverReceivedAt: new Date('2026-10-22T12:00:00.000Z'),
  };
  request.signature = Twilio.getExpectedTwilioSignature(
    'test-auth-token',
    request.effectiveUrl,
    parameters,
  );
  const providerRegistry = new InconnectMessagingProviderRegistry();
  const clientFactory = {
    create: jest.fn(() => {
      throw new Error('No Twilio calls');
    }),
  };
  const secureHttp = {
    getHttpClient: jest.fn(() => {
      throw new Error('No HTTP');
    }),
  };
  const provider = new TwilioWhatsappMessagingProvider(
    providerRegistry,
    clientFactory as unknown as TwilioWhatsappClientFactory,
    {} as TwentyConfigService,
    secureHttp as unknown as SecureHttpClientService,
    {} as InconnectMessagingProviderMediaDeliveryService,
  );
  provider.onModuleInit();
  const decrypt = jest
    .fn()
    .mockReturnValue(JSON.stringify({ authToken: 'test-auth-token' }));
  const secretEncryptionService = {
    decryptVersionedOrThrow: decrypt,
  } as unknown as SecretEncryptionService;
  const payloadHash = createHash('sha256')
    .update(request.rawBody)
    .digest('hex');
  const normalized = provider.normalizeWebhook({ request, payloadHash });
  if (normalized.kind !== 'INBOUND_MESSAGE') throw new Error('Invalid fixture');
  const event = fixture.event ?? {
    kind: 'INBOUND_RECEIVED' as const,
    scope: {
      workspaceId: scope.workspaceId,
      conversationId: scope.conversationId,
      providerConnectionId: scope.providerConnectionId,
    },
    eventKey: JSON.stringify(['whatsapp-inbound-v1', identifier(27)]),
    messageId: identifier(10),
  };
  const scenario = writerScript({ ...fixture, event }, before);
  const authenticationReference = JSON.stringify([
    'twilio-signature-v1',
    identifier(27),
    payloadHash,
  ]);
  const correlationReference = JSON.stringify([
    'inbound-cause-v1',
    identifier(27),
    identifier(10),
    normalized.providerMessageId,
  ]);
  const admissionRow = {
    encryptedCredentials: 'workspace-encrypted-credentials',
    inboundRoutingKey: request.routingKey,
    routingCount: '1',
    provider: 'TWILIO',
    channel: 'WHATSAPP',
    lifecycleStatus: 'ENABLED',
    externalAddressNormalized: normalized.externalAddressNormalized,
    payloadHash,
    normalizedMetadata: normalized,
    idempotencyKey: normalized.idempotencyKey,
    eventKind: 'INBOUND_MESSAGE',
    processingState: 'PROCESSING',
    leaseToken: identifier(28),
    leaseValid: true,
    firstReceivedAt: request.serverReceivedAt.toISOString(),
    providerMessageId: normalized.providerMessageId,
    direction: 'INBOUND',
    type: normalized.messageType,
    body: normalized.body,
    providerMetadata: normalized.providerMetadata,
  };
  for (const statement of scenario.steps) {
    statement.parameters = statement.parameters.map((value) =>
      value === scenario.admission.authenticationReference
        ? authenticationReference
        : value,
    );
    // Only Audit uses the nullable correlation field at its last parameter.
    if (
      statement.sql.includes(
        'INSERT INTO core."inconnectMessagingAttentionTransitionAudit"',
      )
    )
      statement.parameters = [
        ...statement.parameters.slice(0, -1),
        correlationReference,
      ];
  }
  scenario.steps.splice(
    scenario.readerLength + 2,
    0,
    step(ATTENTION_SESSION_SQL, [], [sessionRow]),
    step(
      INBOUND_ATTENTION_ADMISSION_SQL,
      [
        scope.workspaceId,
        scope.conversationId,
        scope.providerConnectionId,
        scope.trackingEpochId,
        identifier(27),
        identifier(28),
        identifier(10),
        request.routingKey,
      ],
      [admissionRow],
    ),
    step(ATTENTION_SESSION_SQL, [], [sessionRow]),
  );
  const run = () => {
    let nextId = 100;
    jest
      .mocked(randomUUID)
      .mockImplementation(
        () => identifier(nextId++) as ReturnType<typeof randomUUID>,
      );
    const harness = writerRunner(scenario.steps);
    const promise = prepareSignedInboundAttentionWrite({
      queryRunner: harness.queryRunner,
      scope,
      messageId: identifier(10),
      webhook: { id: identifier(27), leaseToken: identifier(28) },
      request,
      providerRegistry,
      secretEncryptionService,
    });
    return { ...harness, promise };
  };
  return {
    scenario,
    admissionRow,
    request,
    normalized,
    decrypt,
    run,
    clientFactory,
    secureHttp,
  };
};
