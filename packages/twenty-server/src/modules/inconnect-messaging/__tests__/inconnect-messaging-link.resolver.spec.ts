import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { InconnectMessagingLinkResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-link.resolver';

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({ getWorkspaceAuthContext: jest.fn() }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = { workspace: { id: 'workspace-id' } } as never;

describe('InconnectMessagingLinkResolver', () => {
  beforeEach(() => {
    jest.mocked(getWorkspaceAuthContext).mockReturnValue(authContext);
  });

  it('accepts only Conversation, search, and paging for candidate authority', async () => {
    const candidateService = {
      getCandidates: jest.fn().mockResolvedValue({ edges: [] }),
    };
    const resolver = new InconnectMessagingLinkResolver(
      candidateService as never,
      {} as never,
    );

    await resolver.inconnectMessagingConversationLinkCandidates(
      'conversation-id',
      'search text',
      { first: 10, after: 'cursor' },
    );

    expect(candidateService.getCandidates).toHaveBeenCalledWith({
      authContext,
      conversationId: 'conversation-id',
      search: 'search text',
      first: 10,
      after: 'cursor',
    });
    expect(resolver.inconnectMessagingConversationLinkCandidates).toHaveLength(
      3,
    );
  });

  it('accepts only Conversation and target record IDs for linking', async () => {
    const linkService = {
      linkConversation: jest.fn().mockResolvedValue({ state: 'LINKED' }),
    };
    const resolver = new InconnectMessagingLinkResolver(
      {} as never,
      linkService as never,
    );

    await resolver.linkInconnectMessagingConversation(
      'conversation-id',
      'record-id',
    );

    expect(linkService.linkConversation).toHaveBeenCalledWith({
      authContext,
      conversationId: 'conversation-id',
      recordId: 'record-id',
    });
    expect(resolver.linkInconnectMessagingConversation).toHaveLength(2);
  });
});
