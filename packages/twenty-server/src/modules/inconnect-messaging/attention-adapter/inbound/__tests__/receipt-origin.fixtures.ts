import { createHmac } from 'node:crypto';

import { type DataSource, type Repository } from 'typeorm';

import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  identifier,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { type TwilioWhatsappClientFactory } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-client.factory';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { type InconnectMessagingProviderMediaDeliveryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-media-delivery.service';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

export const ORIGIN_TEST_TOKEN = 'source-only-auth-token';
export const ORIGIN_TEST_URL =
  'https://crm.example.test/webhooks/inconnect-messaging/twilio/whatsapp/route-1/inbound';

// Independent local signer; authentication in the services still uses Twilio's SDK.
export const signOriginRequest = (
  request: InconnectMessagingWebhookRequest,
  token = ORIGIN_TEST_TOKEN,
) => {
  const signed = Object.keys(request.parameters)
    .sort()
    .reduce((text, name) => {
      const value = request.parameters[name];
      const values = Array.isArray(value)
        ? [...new Set(value)].sort()
        : [value];
      return text + values.map((entry) => name + entry).join('');
    }, request.effectiveUrl);
  request.signature = createHmac('sha1', token)
    .update(signed, 'utf8')
    .digest('base64');
  return request;
};

export const originRequest = (
  parameters: Record<string, string | string[]> = {},
): InconnectMessagingWebhookRequest => {
  const form = {
    MessageSid: 'SM-origin',
    From: 'whatsapp:+525512345678',
    Body: 'Hola 👋 café 漢字',
    NumMedia: '0',
    ...parameters,
  };
  const raw = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    for (const entry of Array.isArray(value) ? value : [value])
      raw.append(name, entry);
  }
  return signOriginRequest({
    kind: 'INBOUND_MESSAGE',
    routingKey: 'route-1',
    effectiveUrl: ORIGIN_TEST_URL,
    contentType: 'application/x-www-form-urlencoded',
    signature: '',
    parameters: form,
    rawBody: raw.toString(),
    serverReceivedAt: new Date('2026-10-22T12:00:00.000Z'),
  });
};

// Only I/O is simulated. This captures the actual INSERT projection; it does
// not emulate PostgreSQL constraints, locks, grants, rollback or authenticated origin.
export const receiptOriginFixture = (
  stored: InconnectMessagingWebhookReceiptEntity[] = [],
) => {
  const rows = stored;
  const connection = Object.assign(
    new InconnectMessagingProviderConnectionEntity(),
    {
      id: scope.providerConnectionId,
      workspaceId: scope.workspaceId,
      provider: 'TWILIO',
      channel: 'WHATSAPP',
      inboundRoutingKey: 'route-1',
      lifecycleStatus: 'ENABLED',
      encryptedCredentials: 'test-encrypted-credentials',
    },
  );
  const connections = [connection];
  const findConnections = jest.fn(async () => connections);
  const decrypt = jest.fn(() =>
    JSON.stringify({ authToken: ORIGIN_TEST_TOKEN }),
  );
  const registry = new InconnectMessagingProviderRegistry();
  const external = jest.fn(() => {
    throw new Error('External I/O forbidden');
  });
  const provider = new TwilioWhatsappMessagingProvider(
    registry,
    { create: external } as unknown as TwilioWhatsappClientFactory,
    {} as TwentyConfigService,
    { getHttpClient: external } as unknown as SecureHttpClientService,
    {} as InconnectMessagingProviderMediaDeliveryService,
  );
  provider.onModuleInit();
  let values: Record<string, unknown> = {};
  let normalizedMetadata: unknown;
  const execute = jest.fn(async () => {
    if (rows.length !== 0) return;
    rows.push(
      Object.assign(new InconnectMessagingWebhookReceiptEntity(), {
        ...values,
        id: identifier(27),
        normalizedMetadata,
        createdAt: new Date('2026-10-22T12:00:00.000Z'),
        updatedAt: new Date('2026-10-22T12:00:00.000Z'),
      }),
    );
  });
  const builder = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn(),
    setParameter: jest.fn(),
    orIgnore: jest.fn().mockReturnThis(),
    execute,
  };
  builder.values.mockImplementation((input: Record<string, unknown>) => {
    values = input;
    return builder;
  });
  builder.setParameter.mockImplementation((_name: string, input: unknown) => {
    normalizedMetadata = input;
    return builder;
  });
  const findOne = jest.fn(async () => rows[0] ?? null);
  const repository = {
    createQueryBuilder: jest.fn(() => builder),
    findOne,
    find: jest.fn(async () =>
      rows.filter((row) => row.processingState === 'RECEIVED'),
    ),
  };
  const transaction = jest.fn(
    async (
      callback: (manager: { getRepository: typeof getRepository }) => unknown,
    ) => callback({ getRepository }),
  );
  const getRepository = jest.fn((entity: unknown) => {
    expect(entity).toBe(InconnectMessagingWebhookReceiptEntity);
    return repository;
  });
  const add = jest.fn().mockResolvedValue(undefined);
  const makeReceiptService = () =>
    new InconnectMessagingWebhookReceiptService(
      { transaction } as unknown as DataSource,
      repository as unknown as Repository<InconnectMessagingWebhookReceiptEntity>,
      { add } as unknown as MessageQueueService,
    );
  const receiptService = makeReceiptService();
  const routing = new InconnectMessagingProviderConnectionRoutingService(
    {
      find: findConnections,
    } as unknown as Repository<InconnectMessagingProviderConnectionEntity>,
    { decryptVersionedOrThrow: decrypt } as unknown as SecretEncryptionService,
  );
  const ingress = new InconnectMessagingWebhookIngressService(
    registry,
    routing,
    receiptService,
  );
  return {
    rows,
    connection,
    connections,
    findConnections,
    decrypt,
    provider,
    external,
    repository,
    builder,
    transaction,
    execute,
    add,
    receiptService,
    makeReceiptService,
    ingress,
  };
};
