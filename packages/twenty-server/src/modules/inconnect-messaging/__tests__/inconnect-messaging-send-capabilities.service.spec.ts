import { InconnectMessagingSendCapabilitiesService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-send-capabilities.service';

const getCatalog = jest.fn();
const service = new InconnectMessagingSendCapabilitiesService({
  getAuthorizedCatalog: getCatalog,
} as never);

describe('InconnectMessagingSendCapabilitiesService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when SEND authorization fails', async () => {
    getCatalog.mockResolvedValue(null);

    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toBeNull();
  });

  it('enables free-form and templates while the session window is open', async () => {
    const lastInboundAt = new Date(Date.now() - 60_000);

    getCatalog.mockResolvedValue({
      conversation: { lastInboundAt },
      supportsFreeform: true,
      supportsTemplates: true,
      catalogAvailable: true,
      templates: [{ id: 'template-id' }],
    });
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
  });

  it('blocks free-form but permits templates outside the session window', async () => {
    getCatalog.mockResolvedValue({
      conversation: {
        lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
      supportsFreeform: true,
      supportsTemplates: true,
      catalogAvailable: true,
      templates: [{ id: 'template-id' }],
    });
    await expect(
      service.getCapabilities({
        authContext: {} as never,
        conversationId: 'conversation-id',
      }),
    ).resolves.toMatchObject({
      canSend: true,
      canSendFreeform: false,
      canSendTemplate: true,
      sessionWindowState: 'CLOSED',
      freeformUnavailableReason: 'SESSION_WINDOW_CLOSED',
    });
  });
});
