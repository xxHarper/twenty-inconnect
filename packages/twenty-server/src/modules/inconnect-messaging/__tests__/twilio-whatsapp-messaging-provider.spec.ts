import Twilio from 'twilio';

import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { TwilioWhatsappClientFactory } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-client.factory';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';

const AUTH_TOKEN = 'test-auth-token';
const EFFECTIVE_URL =
  'https://crm.example.com/webhooks/inconnect-messaging/twilio/whatsapp/route-1/inbound';
const SERVER_RECEIVED_AT = new Date('2026-09-10T12:00:00.000Z');
const CONTENT_SID = 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
  const createMessage = jest.fn();
  const listContent = jest.fn();
  const clientFactory = {
    create: jest.fn().mockReturnValue({
      messages: { create: createMessage },
      content: {
        v2: { contentAndApprovals: { list: listContent } },
      },
    }),
  } as unknown as TwilioWhatsappClientFactory;
  const configService = {
    get: jest.fn().mockReturnValue('https://crm.example.com'),
  } as unknown as TwentyConfigService;
  const provider = new TwilioWhatsappMessagingProvider(
    registry,
    clientFactory,
    configService,
  );

  beforeAll(() => provider.onModuleInit());

  it('registers the outbound WhatsApp capability', () => {
    expect(registry.resolve({ provider: 'TWILIO', channel: 'WHATSAPP' })).toBe(
      provider,
    );
    expect(provider.capabilities).toEqual([
      'NORMALIZE_WEBHOOK',
      'DISPATCH_FREEFORM',
      'DISPATCH_TEMPLATE',
    ]);
  });

  it('lists only approved textual WhatsApp templates through the normalized contract', async () => {
    listContent.mockResolvedValueOnce([
      {
        sid: CONTENT_SID,
        friendlyName: 'appointment_reminder',
        language: 'es',
        variables: { '1': 'Customer' },
        types: { 'twilio/text': { body: 'Hola {{1}}' } },
        approvalRequests: { whatsapp: { status: 'approved' } },
      },
      {
        sid: 'HXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        friendlyName: 'draft',
        language: 'es',
        variables: {},
        types: { 'twilio/text': { body: 'Draft' } },
        approvalRequests: { whatsapp: { status: 'pending' } },
      },
      {
        sid: 'HXcccccccccccccccccccccccccccccccc',
        friendlyName: 'rich_card',
        language: 'es',
        variables: {},
        types: { 'twilio/card': { body: 'Card' } },
        approvalRequests: { whatsapp: { status: 'approved' } },
      },
    ]);

    await expect(
      provider.listTemplates({
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
      }),
    ).resolves.toEqual([
      {
        providerReference: CONTENT_SID,
        displayName: 'appointment_reminder',
        language: 'es',
        availability: 'AVAILABLE',
        content: { kind: 'TEXT', body: 'Hola {{1}}' },
        variables: [
          {
            key: '1',
            required: true,
            maxLength: 1600,
            allowsNewlines: false,
          },
        ],
      },
    ]);
    expect(listContent).toHaveBeenCalledWith({
      channelEligibility: ['whatsapp:approved'],
      contentType: ['twilio/text'],
      limit: 1000,
    });
  });

  it('uses the persisted sender and canonical destination with mocked Twilio SDK', async () => {
    createMessage.mockResolvedValueOnce({
      sid: 'SM-outbound',
      status: 'queued',
    });
    await expect(
      provider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        callbackRoutingKey: 'route-1',
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
        content: { kind: 'FREEFORM_TEXT', body: 'hola' },
      }),
    ).resolves.toMatchObject({
      kind: 'ACCEPTED',
      providerMessageId: 'SM-outbound',
    });
    expect(createMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+525512345678',
      body: 'hola',
      statusCallback:
        'https://crm.example.com/webhooks/inconnect-messaging/twilio/whatsapp/route-1/status/message-id',
    });
    expect(clientFactory.create).toHaveBeenCalledWith('AC123', AUTH_TOKEN);
  });

  it('normalizes an uncertain SDK failure without exposing details', async () => {
    createMessage.mockRejectedValueOnce(new Error('secret provider failure'));

    await expect(
      provider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        callbackRoutingKey: 'route-1',
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
        content: { kind: 'FREEFORM_TEXT', body: 'hola' },
      }),
    ).resolves.toEqual({
      kind: 'UNKNOWN',
      error: {
        code: 'PROVIDER_OUTCOME_UNKNOWN',
        message: 'Provider outcome is ambiguous',
        retryable: false,
      },
    });
  });

  it('dispatches a template using only its server-side provider reference', async () => {
    createMessage.mockResolvedValueOnce({
      sid: 'SM-template',
      status: 'queued',
    });

    await expect(
      provider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        callbackRoutingKey: 'route-1',
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
        content: {
          kind: 'TEMPLATE',
          templateProviderReference: CONTENT_SID,
          variables: { '1': 'Ana' },
        },
      }),
    ).resolves.toMatchObject({
      kind: 'ACCEPTED',
      providerMessageId: 'SM-template',
    });
    expect(createMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+525512345678',
      contentSid: CONTENT_SID,
      contentVariables: JSON.stringify({ '1': 'Ana' }),
      statusCallback:
        'https://crm.example.com/webhooks/inconnect-messaging/twilio/whatsapp/route-1/status/message-id',
    });
  });

  it('treats an explicit Twilio 4xx response as a definitive rejection', async () => {
    createMessage.mockRejectedValueOnce(
      new Twilio.RestException({
        statusCode: 400,
        body: { message: 'sensitive provider detail' },
      }),
    );

    await expect(
      provider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        callbackRoutingKey: 'route-1',
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
        content: { kind: 'FREEFORM_TEXT', body: 'hola' },
      }),
    ).resolves.toEqual({
      kind: 'REJECTED_DEFINITIVE',
      error: {
        code: 'PROVIDER_REJECTED',
        message: 'Provider rejected the message',
        retryable: false,
      },
    });
  });

  it('fails before submission when the callback URL is unavailable', async () => {
    const unsafeConfig = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as TwentyConfigService;
    const unsafeProvider = new TwilioWhatsappMessagingProvider(
      registry,
      clientFactory,
      unsafeConfig,
    );
    const callsBefore = createMessage.mock.calls.length;

    await expect(
      unsafeProvider.dispatch({
        workspaceId: 'workspace-id',
        providerConnectionId: 'connection-id',
        messageId: 'message-id',
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        callbackRoutingKey: 'route-1',
        credentials: { accountSid: 'AC123', authToken: AUTH_TOKEN },
        content: { kind: 'FREEFORM_TEXT', body: 'hola' },
      }),
    ).resolves.toMatchObject({ kind: 'FAILED_BEFORE_SUBMIT' });
    expect(createMessage).toHaveBeenCalledTimes(callsBefore);
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

  it('preserves the signed local message hint for callback reconciliation', () => {
    const localMessageIdHint = '66666666-6666-4666-8666-666666666666';
    const request = {
      ...buildRequest({
        parameters: { MessageSid: 'SM-outbound', MessageStatus: 'delivered' },
        kind: 'STATUS_CALLBACK',
        effectiveUrl: `https://crm.example.com/webhooks/inconnect-messaging/twilio/whatsapp/route-1/status/${localMessageIdHint}`,
      }),
      localMessageIdHint,
    };

    expect(
      provider.validateWebhookSignature({
        credentials: { authToken: AUTH_TOKEN },
        request,
      }),
    ).toBe(true);
    expect(
      provider.normalizeWebhook({ request, payloadHash: 'hash' }),
    ).toMatchObject({
      kind: 'STATUS_CALLBACK',
      localMessageIdHint,
    });
  });

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
