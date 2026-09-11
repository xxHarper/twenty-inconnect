import Twilio from 'twilio';

import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';

const AUTH_TOKEN = 'test-auth-token';
const EFFECTIVE_URL =
  'https://crm.example.com/webhooks/inconnect-messaging/twilio/whatsapp/route-1/inbound';
const SERVER_RECEIVED_AT = new Date('2026-09-10T12:00:00.000Z');

const buildRequest = ({
  parameters,
  effectiveUrl = EFFECTIVE_URL,
  signatureUrl = effectiveUrl,
  authToken = AUTH_TOKEN,
  kind = 'INBOUND_MESSAGE',
}: {
  parameters: Record<string, string>;
  effectiveUrl?: string;
  signatureUrl?: string;
  authToken?: string;
  kind?: InconnectMessagingWebhookRequest['kind'];
}): InconnectMessagingWebhookRequest => ({
  kind,
  routingKey: 'route-1',
  effectiveUrl,
  signature: Twilio.getExpectedTwilioSignature(
    authToken,
    signatureUrl,
    parameters,
  ),
  contentType: 'application/x-www-form-urlencoded',
  rawBody: new URLSearchParams(parameters).toString(),
  parameters,
  serverReceivedAt: SERVER_RECEIVED_AT,
});

const inboundParameters = {
  AccountSid: 'AC123',
  MessageSid: 'SM123',
  From: 'whatsapp:+525512345678',
  To: 'whatsapp:+14155238886',
  WaId: '525512345678',
  Body: 'hola',
  NumMedia: '0',
};

describe('TwilioWhatsappMessagingProvider', () => {
  const registry = new InconnectMessagingProviderRegistry();
  const provider = new TwilioWhatsappMessagingProvider(registry);

  beforeAll(() => provider.onModuleInit());

  it('registers the real adapter and keeps outbound unsupported', async () => {
    expect(registry.resolve({ provider: 'TWILIO', channel: 'WHATSAPP' })).toBe(
      provider,
    );
    expect(provider.capabilities).toEqual(['NORMALIZE_WEBHOOK']);
    await expect(
      provider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        body: 'not sent',
      }),
    ).resolves.toMatchObject({
      kind: 'REJECTED_DEFINITIVE',
      error: { code: 'TWILIO_OUTBOUND_NOT_IMPLEMENTED', retryable: false },
    });
  });

  it('derives routing only from the route hint', () => {
    const request = buildRequest({
      parameters: { ...inboundParameters, workspaceId: 'attacker-workspace' },
    });

    expect(provider.getWebhookRoutingHints(request)).toEqual({
      inboundRoutingKey: 'route-1',
    });
  });

  it('accepts a valid Twilio signature', () => {
    const request = buildRequest({ parameters: inboundParameters });

    expect(
      provider.validateWebhookSignature({
        credentials: { authToken: AUTH_TOKEN },
        request,
      }),
    ).toBe(true);
  });

  it.each([
    ['invalid signature', { signature: 'invalid' }],
    [
      'modified URL',
      {
        effectiveUrl: `${EFFECTIVE_URL}/modified`,
      },
    ],
  ])('rejects %s', (_name, requestPatch) => {
    const request = {
      ...buildRequest({ parameters: inboundParameters }),
      ...requestPatch,
    };

    expect(
      provider.validateWebhookSignature({
        credentials: { authToken: AUTH_TOKEN },
        request,
      }),
    ).toBe(false);
  });

  it('rejects a modified payload', () => {
    const signedRequest = buildRequest({ parameters: inboundParameters });
    const request = {
      ...signedRequest,
      parameters: { ...signedRequest.parameters, Body: 'alterado' },
      rawBody: new URLSearchParams({
        ...inboundParameters,
        Body: 'alterado',
      }).toString(),
    };

    expect(
      provider.validateWebhookSignature({
        credentials: { authToken: AUTH_TOKEN },
        request,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with another credential', () => {
    const request = buildRequest({
      parameters: inboundParameters,
      authToken: 'wrong-auth-token',
    });

    expect(
      provider.validateWebhookSignature({
        credentials: { authToken: AUTH_TOKEN },
        request,
      }),
    ).toBe(false);
  });

  it('rejects missing provider credentials', () => {
    const request = buildRequest({ parameters: inboundParameters });

    expect(
      provider.validateWebhookSignature({ credentials: {}, request }),
    ).toBe(false);
  });

  it('normalizes inbound sender identity and server timestamps', () => {
    const request = buildRequest({ parameters: inboundParameters });

    expect(
      provider.normalizeWebhook({ request, payloadHash: 'hash' }),
    ).toMatchObject({
      kind: 'INBOUND_MESSAGE',
      idempotencyKey: 'SM123',
      providerMessageId: 'SM123',
      externalAddressNormalized: '+525512345678',
      waId: '525512345678',
      body: 'hola',
      messageType: 'TEXT',
      serverReceivedAt: '2026-09-10T12:00:00.000Z',
      providerOccurredAt: null,
      effectiveInboundAt: '2026-09-10T12:00:00.000Z',
      timestampSource: 'SERVER',
      providerMetadata: {
        from: 'whatsapp:+525512345678',
        waId: '525512345678',
      },
    });
  });

  it.each([
    ['image/jpeg', 'IMAGE'],
    ['audio/ogg', 'AUDIO'],
    ['video/mp4', 'VIDEO'],
    ['application/pdf', 'DOCUMENT'],
  ] as const)(
    'recognizes %s media as %s without downloading it',
    (contentType, type) => {
      const parameters = {
        ...inboundParameters,
        NumMedia: '1',
        MediaContentType0: contentType,
        MediaUrl0: 'https://api.twilio.com/provider-media/ME123',
      };
      const request = buildRequest({ parameters });
      const normalized = provider.normalizeWebhook({
        request,
        payloadHash: 'hash',
      });

      expect(normalized).toMatchObject({
        kind: 'INBOUND_MESSAGE',
        messageType: type,
        providerMetadata: {
          media: [
            {
              contentType,
              providerLocator: 'https://api.twilio.com/provider-media/ME123',
            },
          ],
        },
      });
    },
  );

  it('preserves structured location metadata', () => {
    const parameters = {
      ...inboundParameters,
      Latitude: '19.4326',
      Longitude: '-99.1332',
      Label: 'Oficina',
      Address: 'Ciudad de México',
    };
    const request = buildRequest({ parameters });

    expect(
      provider.normalizeWebhook({ request, payloadHash: 'hash' }),
    ).toMatchObject({
      kind: 'INBOUND_MESSAGE',
      messageType: 'LOCATION',
      providerMetadata: {
        location: {
          latitude: '19.4326',
          longitude: '-99.1332',
          label: 'Oficina',
          address: 'Ciudad de México',
        },
      },
    });
  });

  it.each([
    ['sent', 'SENT'],
    ['delivered', 'DELIVERED'],
    ['read', 'READ'],
    ['failed', 'FAILED'],
    ['undelivered', 'FAILED'],
  ] as const)(
    'normalizes status %s to %s',
    (originalStatus, normalizedStatus) => {
      const parameters = {
        MessageSid: 'SM-outbound',
        MessageStatus: originalStatus,
        ErrorCode: originalStatus === 'undelivered' ? '63016' : '',
        ErrorMessage: originalStatus === 'undelivered' ? 'Provider error' : '',
      };
      const request = buildRequest({
        parameters,
        kind: 'STATUS_CALLBACK',
      });

      expect(
        provider.normalizeWebhook({ request, payloadHash: 'hash' }),
      ).toMatchObject({
        kind: 'STATUS_CALLBACK',
        providerMessageId: 'SM-outbound',
        originalStatus,
        normalizedStatus,
        ...(originalStatus === 'undelivered'
          ? {
              error: {
                providerStatus: 'undelivered',
                providerErrorCode: '63016',
                providerErrorMessage: 'Provider error',
              },
            }
          : {}),
      });
    },
  );

  it('normalizes malformed payloads into a durable unsupported receipt', () => {
    const request = buildRequest({ parameters: { Body: 'missing identity' } });

    expect(
      provider.normalizeWebhook({ request, payloadHash: 'payload-hash' }),
    ).toEqual({
      kind: 'UNSUPPORTED',
      idempotencyKey: 'payload:payload-hash',
      requestedKind: 'INBOUND_MESSAGE',
      reason: 'MALFORMED_INBOUND',
      serverReceivedAt: '2026-09-10T12:00:00.000Z',
    });
  });
});
