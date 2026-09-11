import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { type InconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

const request = {
  kind: 'INBOUND_MESSAGE' as const,
  routingKey: 'route-1',
  effectiveUrl: 'https://crm.example.com/webhooks/route-1/inbound',
  signature: 'signature',
  contentType: 'application/x-www-form-urlencoded',
  rawBody: 'MessageSid=SM123&workspaceId=attacker-workspace',
  parameters: {
    MessageSid: 'SM123',
    workspaceId: 'attacker-workspace',
  },
  serverReceivedAt: new Date('2026-09-10T12:00:00.000Z'),
};

const normalizedWebhook = {
  kind: 'INBOUND_MESSAGE' as const,
  idempotencyKey: 'SM123',
  providerMessageId: 'SM123',
  externalAddressNormalized: '+525512345678',
  waId: null,
  body: 'hola',
  messageType: 'TEXT' as const,
  serverReceivedAt: '2026-09-10T12:00:00.000Z',
  providerOccurredAt: null,
  effectiveInboundAt: '2026-09-10T12:00:00.000Z',
  timestampSource: 'SERVER' as const,
  providerMetadata: {},
};

describe('InconnectMessagingWebhookIngressService', () => {
  const validateWebhookSignature = jest.fn();
  const normalizeWebhook = jest.fn().mockReturnValue(normalizedWebhook);
  const provider: InconnectMessagingProvider = {
    key: { provider: 'TWILIO', channel: 'WHATSAPP' },
    capabilities: ['NORMALIZE_WEBHOOK'],
    dispatch: jest.fn(),
    getWebhookRoutingHints: jest.fn().mockReturnValue({
      inboundRoutingKey: 'route-1',
    }),
    validateWebhookSignature,
    normalizeWebhook,
  };
  const registry = new InconnectMessagingProviderRegistry();
  const resolveEnabledConnection = jest.fn();
  const computePayloadHash = jest.fn().mockReturnValue('payload-hash');
  const persistAndRequestProcessing = jest.fn();
  const service = new InconnectMessagingWebhookIngressService(
    registry,
    {
      resolveEnabledConnection,
    } as unknown as InconnectMessagingProviderConnectionRoutingService,
    {
      computePayloadHash,
      persistAndRequestProcessing,
    } as unknown as InconnectMessagingWebhookReceiptService,
  );

  beforeAll(() => registry.register(provider));

  beforeEach(() => {
    jest.clearAllMocks();
    validateWebhookSignature.mockReturnValue(true);
    normalizeWebhook.mockReturnValue(normalizedWebhook);
    const connection = Object.assign(
      new InconnectMessagingProviderConnectionEntity(),
      {
        id: 'connection-id',
        workspaceId: 'resolved-workspace',
      },
    );

    resolveEnabledConnection.mockResolvedValue({
      connection,
      credentials: { authToken: 'auth-token' },
    });
    persistAndRequestProcessing.mockResolvedValue({ id: 'receipt-id' });
  });

  it('uses the routed connection workspace and never trusts payload workspaceId', async () => {
    await service.acceptTwilioWhatsappWebhook(request);

    expect(resolveEnabledConnection).toHaveBeenCalledWith({
      providerKey: provider.key,
      routingHints: { inboundRoutingKey: 'route-1' },
    });
    expect(persistAndRequestProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'resolved-workspace',
        providerConnectionId: 'connection-id',
      }),
    );
    expect(persistAndRequestProcessing).not.toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'attacker-workspace' }),
    );
  });

  it('produces no durable or domain effect when the signature is invalid', async () => {
    validateWebhookSignature.mockReturnValue(false);

    await expect(
      service.acceptTwilioWhatsappWebhook(request),
    ).rejects.toMatchObject({ status: 403 });
    expect(normalizeWebhook).not.toHaveBeenCalled();
    expect(persistAndRequestProcessing).not.toHaveBeenCalled();
  });
});
