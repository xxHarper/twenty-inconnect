import { InconnectMessagingSendCapabilitiesService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send-capabilities.service';

const getAuthorizedContext = jest.fn();
const service = new InconnectMessagingSendCapabilitiesService({
  getAuthorizedContext,
} as never);
const listTemplates = jest.fn();
const outboundMediaCapabilities = {
  maximumAttachments: 1,
  supportedMimeTypesByType: {
    IMAGE: ['image/jpeg', 'image/png'],
    STICKER: ['image/webp'],
    AUDIO: ['audio/mpeg'],
    VIDEO: ['video/mp4'],
    DOCUMENT: ['application/pdf'],
    CONTACT: ['text/vcard'],
  },
  captionSupportedTypes: ['IMAGE'],
};

const buildAvailableContext = ({
  capabilities,
  lastInboundAt,
}: {
  capabilities: string[];
  lastInboundAt: Date;
}) => ({
  availability: 'AVAILABLE',
  conversation: { lastInboundAt },
  credentials: { secret: 'server-only' },
  provider: {
    capabilities,
    listTemplates,
    outboundMediaCapabilities,
  },
});

describe('InconnectMessagingSendCapabilitiesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when SEND authorization fails', async () => {
    getAuthorizedContext.mockResolvedValue(null);

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toBeNull();
  });

  it('returns structural template capability without fetching templates', async () => {
    getAuthorizedContext.mockResolvedValue(
      buildAvailableContext({
        capabilities: ['DISPATCH_FREEFORM', 'DISPATCH_TEMPLATE'],
        lastInboundAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toMatchObject({
      canSend: true,
      canSendFreeform: true,
      canSendTemplate: true,
      sessionWindowState: 'OPEN',
      freeformUnavailableReason: null,
      templateUnavailableReason: null,
    });
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it('blocks free-form but permits structural template capability outside the session window', async () => {
    getAuthorizedContext.mockResolvedValue(
      buildAvailableContext({
        capabilities: ['DISPATCH_FREEFORM', 'DISPATCH_TEMPLATE'],
        lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      }),
    );

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toMatchObject({
      canSend: true,
      canSendFreeform: false,
      canSendMedia: false,
      canSendTemplate: true,
      sessionWindowState: 'CLOSED',
      freeformUnavailableReason: 'SESSION_WINDOW_CLOSED',
    });
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it('returns safe provider-neutral outbound media hints without fetching templates', async () => {
    getAuthorizedContext.mockResolvedValue(
      buildAvailableContext({
        capabilities: [
          'DISPATCH_FREEFORM',
          'DISPATCH_MEDIA',
          'DISPATCH_TEMPLATE',
        ],
        lastInboundAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toMatchObject({
      canSendMedia: true,
      maxMediaItems: 1,
      mediaTypes: expect.arrayContaining([
        {
          type: 'IMAGE',
          mimeTypes: ['image/jpeg', 'image/png'],
          maxBytes: 5 * 1024 * 1024,
          captionSupported: true,
        },
        {
          type: 'STICKER',
          mimeTypes: ['image/webp'],
          maxBytes: 100 * 1024,
          captionSupported: false,
        },
      ]),
    });
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it('isolates send capabilities from a failing template catalog', async () => {
    listTemplates.mockRejectedValue(new Error('Twilio Content unavailable'));
    getAuthorizedContext.mockResolvedValue(
      buildAvailableContext({
        capabilities: [
          'DISPATCH_FREEFORM',
          'DISPATCH_MEDIA',
          'DISPATCH_TEMPLATE',
        ],
        lastInboundAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toMatchObject({
      canSendFreeform: true,
      canSendTemplate: true,
      canSendMedia: true,
      maxMediaItems: 1,
      mediaTypes: expect.any(Array),
    });
    expect(listTemplates).not.toHaveBeenCalled();
  });
});
