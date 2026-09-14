import { InconnectMessagingReadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-read.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = { workspace: { id: 'workspace-id' } } as never;

const conversation = {
  id: '30303030-1111-4111-8111-111111111111',
  externalAddressNormalized: '+525512345678',
  linkedRecordObjectMetadataId: '30303030-2222-4222-8222-222222222222',
  linkedRecordId: '30303030-3333-4333-8333-333333333333',
  lastInboundAt: new Date('2026-09-11T10:00:00.000Z'),
  createdAt: new Date('2026-09-11T09:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
};

const message = {
  id: '30303030-4444-4444-8444-444444444444',
  direction: 'INBOUND',
  type: 'IMAGE',
  body: 'caption',
  outboundState: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  providerMetadata: {
    provider: 'TWILIO',
    from: 'whatsapp:+525512345678',
    media: [
      {
        contentType: 'image/jpeg',
        providerLocator: 'https://api.twilio.com/private-media',
      },
    ],
    location: {
      latitude: '19.4326',
      longitude: '-99.1332',
      label: 'Oficina',
      address: 'Ciudad de México',
    },
  },
};

const buildService = ({ authorized = true } = {}) => {
  const authorizationService = {
    findAuthorizedConversation: jest
      .fn()
      .mockResolvedValue(authorized ? conversation : null),
  };
  const conversationQueryService = {
    getAuthorizedConversationPage: jest.fn().mockResolvedValue({
      edges: [{ cursor: 'conversation-cursor', node: conversation }],
      hasNextPage: false,
      totalCount: 1,
    }),
  };
  const messageQueryService = {
    getAuthorizedMessagePage: jest.fn().mockResolvedValue(
      authorized
        ? {
            edges: [
              {
                cursor: 'message-cursor',
                node: message,
                sortAt: message.createdAt,
              },
            ],
            hasNextPage: false,
            totalCount: 1,
          }
        : null,
    ),
  };

  return {
    service: new InconnectMessagingReadService(
      authorizationService as never,
      conversationQueryService as never,
      messageQueryService as never,
    ),
    conversationQueryService,
    messageQueryService,
  };
};

describe('InconnectMessagingReadService', () => {
  it('returns null for a direct unauthorized Conversation UUID', async () => {
    const { service } = buildService({ authorized: false });

    await expect(
      service.getConversation({ authContext, conversationId: conversation.id }),
    ).resolves.toBeNull();
  });

  it('maps only the safe Conversation fields after authorization', async () => {
    const { service } = buildService();

    await expect(
      service.getConversation({ authContext, conversationId: conversation.id }),
    ).resolves.toEqual({
      id: conversation.id,
      externalAddress: conversation.externalAddressNormalized,
      isLinked: true,
      linkedRecordObjectMetadataId: conversation.linkedRecordObjectMetadataId,
      linkedRecordId: conversation.linkedRecordId,
      lastInboundAt: conversation.lastInboundAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  });

  it('does not expose provider media locators or raw provider metadata', async () => {
    const { service } = buildService();
    const result = await service.getMessages({
      authContext,
      conversationId: conversation.id,
    });

    expect(result?.edges[0].node).toEqual({
      id: message.id,
      direction: 'INBOUND',
      type: 'IMAGE',
      body: 'caption',
      outboundState: null,
      displayAt: message.createdAt,
      createdAt: message.createdAt,
      media: [{ contentType: 'image/jpeg' }],
      location: {
        latitude: '19.4326',
        longitude: '-99.1332',
        label: 'Oficina',
        name: null,
        address: 'Ciudad de México',
      },
    });
    expect(JSON.stringify(result)).not.toContain('providerLocator');
    expect(JSON.stringify(result)).not.toContain('TWILIO');
  });

  it('returns null-equivalent history when the Conversation is unauthorized', async () => {
    const { service } = buildService({ authorized: false });

    await expect(
      service.getMessages({
        authContext,
        conversationId: conversation.id,
      }),
    ).resolves.toBeNull();
  });

  it('passes search and cursor pagination to the authorization-scoped query', async () => {
    const { service, conversationQueryService } = buildService();

    await service.getConversations({
      authContext,
      search: '5512',
      first: 20,
      after: 'opaque-cursor',
    });

    expect(
      conversationQueryService.getAuthorizedConversationPage,
    ).toHaveBeenCalledWith({
      authContext,
      search: '5512',
      first: 20,
      after: 'opaque-cursor',
    });
  });

  it('rejects page sizes outside the bounded contract', async () => {
    const { service } = buildService();

    await expect(
      service.getConversations({ authContext, first: 101 }),
    ).rejects.toThrow('Page size must be an integer between 1 and 100');
  });
});
