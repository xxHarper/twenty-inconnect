import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingAuthorizedProviderContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorized-provider-context.service';
import { InconnectMessagingTemplateCatalogService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-template-catalog.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const conversation = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId,
  providerConnectionId: '33333333-3333-4333-8333-333333333333',
  lastInboundAt: new Date(),
};

const buildService = () => {
  const connectionRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: conversation.providerConnectionId,
      workspaceId,
      provider: 'FAKE',
      channel: 'WHATSAPP',
      lifecycleStatus: 'ENABLED',
      encryptedCredentials: 'encrypted',
    }),
  };
  const dataSource = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === InconnectMessagingProviderConnectionEntity) {
        return connectionRepository;
      }

      throw new Error('Unexpected repository');
    }),
  };
  const authorizationService = {
    findAuthorizedConversationForSend: jest
      .fn()
      .mockResolvedValue(conversation),
  };
  const provider = {
    capabilities: ['DISPATCH_FREEFORM', 'DISPATCH_MEDIA', 'DISPATCH_TEMPLATE'],
    outboundMediaCapabilities: {
      maximumAttachments: 1,
      supportedMimeTypesByType: {
        IMAGE: ['image/jpeg'],
        STICKER: [],
        AUDIO: [],
        VIDEO: [],
        DOCUMENT: [],
        CONTACT: [],
      },
      captionSupportedTypes: ['IMAGE'],
    },
    listTemplates: jest.fn().mockResolvedValue([
      {
        providerReference: 'approved-provider-reference',
        displayName: 'Approved reminder',
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
      {
        providerReference: 'draft-provider-reference',
        displayName: 'Draft',
        language: 'es',
        availability: 'UNAVAILABLE',
        content: { kind: 'TEXT', body: 'Draft' },
        variables: [],
      },
      {
        providerReference: 'unsupported-provider-reference',
        displayName: 'Unsupported',
        language: 'es',
        availability: 'AVAILABLE',
        content: { kind: 'CARD', body: 'Card' },
        variables: [],
      },
    ]),
  };
  const providerRegistry = {
    resolve: jest.fn().mockReturnValue(provider),
  };
  const encryption = {
    decryptVersionedOrThrow: jest
      .fn()
      .mockReturnValue(JSON.stringify({ secret: 'not-public' })),
  };
  const authorizedProviderContextService =
    new InconnectMessagingAuthorizedProviderContextService(
      dataSource as never,
      authorizationService as never,
      providerRegistry as never,
      encryption as never,
    );
  const service = new InconnectMessagingTemplateCatalogService(
    authorizedProviderContextService,
  );

  return {
    service,
    authorizationService,
    connectionRepository,
    provider,
    providerRegistry,
  };
};

describe('InconnectMessagingTemplateCatalogService', () => {
  it('authorizes the Conversation and derives its Provider Connection', async () => {
    const fixture = buildService();
    const result = await fixture.service.getTemplates({
      authContext: { workspace: { id: workspaceId } } as never,
      conversationId: conversation.id,
    });

    expect(
      fixture.authorizationService.findAuthorizedConversationForSend,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: conversation.id }),
    );
    expect(fixture.connectionRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: conversation.providerConnectionId,
        workspaceId,
        lifecycleStatus: 'ENABLED',
      },
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      displayName: 'Approved reminder',
      language: 'es',
      body: 'Hola {{1}}',
      variables: [{ key: '1', required: true, maxLength: 1600 }],
    });
    expect(fixture.provider.listTemplates).toHaveBeenCalledWith({
      credentials: { secret: 'not-public' },
    });
    expect(JSON.stringify(result)).not.toContain('provider-reference');
    expect(JSON.stringify(result)).not.toContain('not-public');
  });

  it('returns null without SEND authorization and does not inspect a connection', async () => {
    const fixture = buildService();

    fixture.authorizationService.findAuthorizedConversationForSend.mockResolvedValue(
      null,
    );
    await expect(
      fixture.service.getTemplates({
        authContext: { workspace: { id: workspaceId } } as never,
        conversationId: conversation.id,
      }),
    ).resolves.toBeNull();
    expect(fixture.connectionRepository.findOne).not.toHaveBeenCalled();
  });

  it('does not cross workspace boundaries while resolving a Conversation', async () => {
    const fixture = buildService();

    fixture.authorizationService.findAuthorizedConversationForSend.mockResolvedValue(
      null,
    );
    await expect(
      fixture.service.getTemplates({
        authContext: {
          workspace: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        } as never,
        conversationId: conversation.id,
      }),
    ).resolves.toBeNull();
    expect(fixture.connectionRepository.findOne).not.toHaveBeenCalled();
  });

  it('fails closed when the provider has no template capability', async () => {
    const fixture = buildService();

    fixture.provider.capabilities.splice(2, 1);
    const catalog = await fixture.service.getAuthorizedCatalog({
      authContext: { workspace: { id: workspaceId } } as never,
      conversationId: conversation.id,
    });

    expect(catalog).toMatchObject({
      supportsTemplates: false,
      templates: [],
    });
    expect(fixture.provider.listTemplates).not.toHaveBeenCalled();
  });

  it('fails closed when catalog retrieval is unavailable', async () => {
    const fixture = buildService();

    fixture.provider.listTemplates.mockRejectedValue(
      new Error('provider down'),
    );
    await expect(
      fixture.service.getAuthorizedCatalog({
        authContext: { workspace: { id: workspaceId } } as never,
        conversationId: conversation.id,
      }),
    ).resolves.toMatchObject({
      catalogAvailable: false,
      templates: [],
      outboundMediaCapabilities: {
        maximumAttachments: 1,
      },
    });
    expect(fixture.provider.listTemplates).toHaveBeenCalledTimes(1);
  });
});
