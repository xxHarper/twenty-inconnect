import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { InconnectMessagingContextResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-context.resolver';

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({ getWorkspaceAuthContext: jest.fn() }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = { workspace: { id: 'workspace-id' } } as never;

describe('InconnectMessagingContextResolver', () => {
  beforeEach(() => {
    jest.mocked(getWorkspaceAuthContext).mockReturnValue(authContext);
  });

  it('accepts only conversationId for runtime context authority', async () => {
    const contextService = {
      getConversationContext: jest.fn().mockResolvedValue({
        state: 'UNASSIGNED',
        object: null,
        record: null,
        fields: [],
      }),
    };
    const resolver = new InconnectMessagingContextResolver(
      contextService as never,
      {} as never,
    );

    await resolver.inconnectMessagingConversationContext('conversation-id');

    expect(contextService.getConversationContext).toHaveBeenCalledWith({
      authContext,
      conversationId: 'conversation-id',
    });
    expect(resolver.inconnectMessagingConversationContext).toHaveLength(1);
  });

  it('derives management workspace and accepts only the ordered field IDs', async () => {
    const configurationService = {
      getConfiguration: jest.fn().mockResolvedValue({}),
      replaceConfiguration: jest.fn().mockResolvedValue({}),
    };
    const resolver = new InconnectMessagingContextResolver(
      {} as never,
      configurationService as never,
    );

    await resolver.inconnectMessagingContextConfiguration();
    await resolver.replaceInconnectMessagingContextConfiguration([
      'field-a',
      'field-b',
    ]);

    expect(configurationService.getConfiguration).toHaveBeenCalledWith({
      authContext,
    });
    expect(configurationService.replaceConfiguration).toHaveBeenCalledWith({
      authContext,
      fieldMetadataIds: ['field-a', 'field-b'],
    });
    expect(resolver.replaceInconnectMessagingContextConfiguration).toHaveLength(
      1,
    );
  });
});
