import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingConversationView } from '@/inconnect-messaging/components/InconnectMessagingConversationView';
import {
  InconnectMessagingConversationDocument,
  MarkInconnectMessagingConversationReadDocument,
  MarkInconnectMessagingConversationUnreadDocument,
  SetInconnectMessagingConversationFavoriteDocument,
  SetInconnectMessagingConversationPendingDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockFetchMore = jest.fn();
const mockRefetchConversation = jest.fn();
const mockRefetchMessages = jest.fn();
const mockOnUnavailable = jest.fn();
const mockOnWorkStateChanged = jest.fn();
const mockSetFavorite = jest.fn();
const mockSetPending = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkUnread = jest.fn();
let mockConversation: {
  id: string;
  externalAddress: string;
  isLinked: boolean;
  isFavorite: boolean;
  isUnread: boolean;
  isPending: boolean;
  lastInboundAt: null;
  createdAt: string;
} | null = {
  id: 'conversation-1',
  externalAddress: '+15550001111',
  isLinked: true,
  isFavorite: false,
  isUnread: false,
  isPending: false,
  lastInboundAt: null,
  createdAt: '2026-09-14T12:00:00.000Z',
};
let mockMessages: {
  edges: {
    cursor: string;
    node: {
      id: string;
      direction: string;
      type: string;
      body: string;
      outboundState: null;
      displayAt: string;
      location: null;
      media: never[];
    };
  }[];
  pageInfo: { hasNextPage: boolean; endCursor: string };
  readThroughMessageId: string | null;
} | null;

jest.mock('@apollo/client/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));
jest.mock(
  '@/inconnect-messaging/components/InconnectMessagingComposer',
  () => ({
    InconnectMessagingComposer: () => <div>Composer</div>,
  }),
);

beforeEach(() => {
  jest.clearAllMocks();
  mockRefetchConversation.mockResolvedValue({});
  mockRefetchMessages.mockResolvedValue({});
  mockSetFavorite.mockResolvedValue({});
  mockSetPending.mockResolvedValue({});
  mockMarkRead.mockResolvedValue({});
  mockMarkUnread.mockResolvedValue({});
  mockFetchMore.mockResolvedValue({
    data: {
      inconnectMessagingMessages: { pageInfo: { endCursor: 'cursor-2' } },
    },
  });
  mockConversation = {
    id: 'conversation-1',
    externalAddress: '+15550001111',
    isLinked: true,
    isFavorite: false,
    isUnread: false,
    isPending: false,
    lastInboundAt: null,
    createdAt: '2026-09-14T12:00:00.000Z',
  };
  mockMessages = {
    edges: [
      {
        cursor: 'cursor-1',
        node: {
          id: 'message-1',
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'Authorized text',
          outboundState: null,
          displayAt: '2026-09-14T12:00:00.000Z',
          location: null,
          media: [],
        },
      },
    ],
    pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
    readThroughMessageId: 'message-1',
  };
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  mockUseMutation.mockImplementation((mutation: unknown) => {
    if (mutation === SetInconnectMessagingConversationFavoriteDocument) {
      return [mockSetFavorite, { loading: false }];
    }
    if (mutation === SetInconnectMessagingConversationPendingDocument) {
      return [mockSetPending, { loading: false }];
    }
    if (mutation === MarkInconnectMessagingConversationUnreadDocument) {
      return [mockMarkUnread, { loading: false }];
    }
    if (mutation === MarkInconnectMessagingConversationReadDocument) {
      return [mockMarkRead, { loading: false }];
    }

    throw new Error('Unexpected mutation');
  });
  mockUseQuery.mockImplementation((query: unknown) =>
    query === InconnectMessagingConversationDocument
      ? {
          data: { inconnectMessagingConversation: mockConversation },
          loading: false,
          error: undefined,
          refetch: mockRefetchConversation,
        }
      : {
          data: { inconnectMessagingMessages: mockMessages },
          loading: false,
          error: undefined,
          fetchMore: mockFetchMore,
          refetch: mockRefetchMessages,
        },
  );
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);
});

const renderView = (refreshNonce = 0) =>
  render(
    <I18nProvider i18n={i18n}>
      <InconnectMessagingConversationView
        conversationId="conversation-1"
        refreshNonce={refreshNonce}
        onClose={jest.fn()}
        onUnavailable={mockOnUnavailable}
        showBack={false}
        realtimeUnavailable={false}
        onMessageAccepted={jest.fn()}
        onWorkStateChanged={mockOnWorkStateChanged}
      />
    </I18nProvider>,
  );

describe('InconnectMessagingConversationView', () => {
  it('renders authorized text and uses the older-message cursor', async () => {
    renderView();
    expect(screen.getByText('Authorized text')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load older messages' }),
      );
    });
    expect(mockFetchMore).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          conversationId: 'conversation-1',
          paging: { first: 30, after: 'cursor-1' },
        },
      }),
    );
  });

  it('merges fetchMore read targets without losing or regressing the safe snapshot', async () => {
    renderView();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load older messages' }),
      );
    });

    const updateQuery = mockFetchMore.mock.calls[0][0].updateQuery;
    const currentConnection = mockMessages!;
    const olderConnection = {
      ...currentConnection,
      edges: [
        {
          ...currentConnection.edges[0],
          cursor: 'cursor-older',
          node: { ...currentConnection.edges[0].node, id: 'message-delayed' },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: 'cursor-older' },
      readThroughMessageId: 'message-delayed',
    };

    const firstSafeTarget = updateQuery(
      {
        inconnectMessagingMessages: {
          ...currentConnection,
          readThroughMessageId: null,
        },
      },
      { fetchMoreResult: { inconnectMessagingMessages: olderConnection } },
    );

    expect(
      firstSafeTarget.inconnectMessagingMessages.readThroughMessageId,
    ).toBe('message-delayed');

    const preservedNewerTarget = updateQuery(
      {
        inconnectMessagingMessages: {
          ...currentConnection,
          readThroughMessageId: 'message-newer',
        },
      },
      { fetchMoreResult: { inconnectMessagingMessages: olderConnection } },
    );

    expect(
      preservedNewerTarget.inconnectMessagingMessages.readThroughMessageId,
    ).toBe('message-newer');
  });

  it('auto-reads a delayed inbound only after fetchMore presents its safe target', async () => {
    mockConversation = { ...mockConversation!, isUnread: true };
    mockMessages = { ...mockMessages!, readThroughMessageId: null };
    const view = renderView();

    expect(mockMarkRead).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load older messages' }),
      );
    });

    const updateQuery = mockFetchMore.mock.calls[0][0].updateQuery;
    const delayedMessage = {
      ...mockMessages!.edges[0],
      cursor: 'cursor-delayed',
      node: { ...mockMessages!.edges[0].node, id: 'message-delayed' },
    };
    const mergedResult = updateQuery(
      { inconnectMessagingMessages: mockMessages },
      {
        fetchMoreResult: {
          inconnectMessagingMessages: {
            ...mockMessages!,
            edges: [delayedMessage],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-delayed' },
            readThroughMessageId: 'message-delayed',
          },
        },
      },
    );

    mockMessages = mergedResult.inconnectMessagingMessages;
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={0}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith({
        variables: {
          conversationId: 'conversation-1',
          throughMessageId: 'message-delayed',
        },
      });
    });
  });

  it('clears old content when the authorized lookup becomes null', () => {
    const view = renderView();
    expect(screen.getByText('Authorized text')).toBeInTheDocument();
    mockConversation = null;
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={1}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText('Authorized text')).not.toBeInTheDocument();
    expect(mockOnUnavailable).toHaveBeenCalled();
  });

  it('refetches both authorized reads on a realtime refresh', () => {
    const view = renderView();
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={1}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    expect(mockRefetchConversation).toHaveBeenCalled();
    expect(mockRefetchMessages).toHaveBeenCalled();
  });

  it('toggles Favorite and Pending without sending a member identity', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    await waitFor(() => {
      expect(mockSetFavorite).toHaveBeenCalledWith({
        variables: { conversationId: 'conversation-1', favorite: true },
      });
    });
    await waitFor(() => expect(mockOnWorkStateChanged).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Mark pending' }));
    await waitFor(() => {
      expect(mockSetPending).toHaveBeenCalledWith({
        variables: { conversationId: 'conversation-1', pending: true },
      });
    });

    expect(JSON.stringify(mockSetFavorite.mock.calls)).not.toContain(
      'workspaceMember',
    );
    expect(JSON.stringify(mockSetPending.mock.calls)).not.toContain(
      'workspaceMember',
    );
  });

  it('unsets Favorite and clears shared Pending', async () => {
    mockConversation = {
      ...mockConversation!,
      isFavorite: true,
      isPending: true,
    };
    renderView();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from favorites' }),
    );
    await waitFor(() => {
      expect(mockSetFavorite).toHaveBeenCalledWith({
        variables: { conversationId: 'conversation-1', favorite: false },
      });
    });
    await waitFor(() => expect(mockOnWorkStateChanged).toHaveBeenCalled());
    mockOnWorkStateChanged.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Clear pending' }));
    await waitFor(() => {
      expect(mockSetPending).toHaveBeenCalledWith({
        variables: { conversationId: 'conversation-1', pending: false },
      });
    });
  });

  it('marks a visible unread Conversation through the server-provided Message snapshot', async () => {
    mockConversation = { ...mockConversation!, isUnread: true };
    renderView();

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith({
        variables: {
          conversationId: 'conversation-1',
          throughMessageId: 'message-1',
        },
      });
    });
    expect(mockMarkRead).not.toHaveBeenCalledWith({
      variables: { conversationId: 'conversation-1' },
    });
  });

  it('does not auto-read in a hidden tab and resumes when visible', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    mockConversation = { ...mockConversation!, isUnread: true };
    renderView();

    expect(mockMarkRead).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledTimes(1));
  });

  it('does not auto-read a new inbound until its refreshed snapshot is loaded', async () => {
    const view = renderView();

    mockConversation = { ...mockConversation!, isUnread: true };
    mockMessages = {
      ...mockMessages!,
      readThroughMessageId: null,
    };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={1}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    expect(mockMarkRead).not.toHaveBeenCalled();

    mockMessages = {
      ...mockMessages,
      readThroughMessageId: 'message-2',
      edges: [
        ...mockMessages!.edges,
        {
          cursor: 'cursor-2',
          node: { ...mockMessages!.edges[0].node, id: 'message-2' },
        },
      ],
    };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={2}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith({
        variables: {
          conversationId: 'conversation-1',
          throughMessageId: 'message-2',
        },
      });
    });
  });

  it('keeps manual Unread suppressed until explicit Mark Read', async () => {
    const view = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as unread' }));
    await waitFor(() => expect(mockMarkUnread).toHaveBeenCalledTimes(1));

    mockConversation = { ...mockConversation!, isUnread: true };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={1}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    expect(mockMarkRead).not.toHaveBeenCalled();

    mockMessages = {
      ...mockMessages!,
      readThroughMessageId: 'message-2',
      edges: [
        ...mockMessages!.edges,
        {
          ...mockMessages!.edges[0],
          cursor: 'cursor-2',
          node: { ...mockMessages!.edges[0].node, id: 'message-2' },
        },
      ],
    };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={2}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    expect(mockMarkRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith({
        variables: { conversationId: 'conversation-1' },
      });
    });
  });

  it('shows a safe error and restores actions after an ordinary mutation failure', async () => {
    mockSetFavorite.mockRejectedValue(new Error('internal provider detail'));
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update conversation. Try again.',
    );
    expect(
      screen.getByRole('button', { name: 'Add to favorites' }),
    ).toBeEnabled();
    expect(
      screen.queryByText('internal provider detail'),
    ).not.toBeInTheDocument();
    expect(mockOnUnavailable).not.toHaveBeenCalled();
  });

  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'])(
    'uses the unavailable flow for a %s mutation failure',
    async (code) => {
      mockSetPending.mockRejectedValue(
        new CombinedGraphQLErrors({
          data: null,
          errors: [
            {
              message: 'sensitive internal detail',
              extensions: { code },
            },
          ],
        }),
      );
      renderView();

      fireEvent.click(screen.getByRole('button', { name: 'Mark pending' }));

      await waitFor(() => expect(mockOnUnavailable).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByText('sensitive internal detail'),
      ).not.toBeInTheDocument();
    },
  );

  it('resumes auto-read after leaving and re-entering a manually unread Conversation', async () => {
    const view = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as unread' }));
    await waitFor(() => expect(mockMarkUnread).toHaveBeenCalledTimes(1));
    view.unmount();

    mockMarkRead.mockClear();
    mockConversation = { ...mockConversation!, isUnread: true };
    renderView();

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith({
        variables: {
          conversationId: 'conversation-1',
          throughMessageId: 'message-1',
        },
      });
    });
  });

  it('ignores an older auto-read completion after a newer snapshot succeeds', async () => {
    let resolveOlder: (() => void) | undefined;
    let resolveNewer: (() => void) | undefined;

    mockMarkRead.mockImplementation(
      ({ variables }: { variables: { throughMessageId?: string } }) =>
        new Promise((resolve) => {
          if (variables.throughMessageId === 'message-1') {
            resolveOlder = () => resolve({});
          } else {
            resolveNewer = () => resolve({});
          }
        }),
    );
    mockConversation = { ...mockConversation!, isUnread: true };
    const view = renderView();
    await waitFor(() => expect(resolveOlder).toBeDefined());

    mockMessages = {
      ...mockMessages!,
      readThroughMessageId: 'message-2',
      edges: [
        ...mockMessages!.edges,
        {
          cursor: 'cursor-2',
          node: { ...mockMessages!.edges[0].node, id: 'message-2' },
        },
      ],
    };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-1"
          refreshNonce={0}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(resolveNewer).toBeDefined());

    await act(async () => resolveNewer?.());
    await waitFor(() =>
      expect(mockRefetchConversation).toHaveBeenCalledTimes(1),
    );
    await act(async () => resolveOlder?.());
    expect(mockRefetchConversation).toHaveBeenCalledTimes(1);
  });

  it('does not let an auto-read result update a newly selected Conversation', async () => {
    let resolveAutoRead: (() => void) | undefined;

    mockMarkRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAutoRead = () => resolve({});
        }),
    );
    mockConversation = { ...mockConversation!, isUnread: true };
    const firstView = renderView();
    await waitFor(() => expect(resolveAutoRead).toBeDefined());
    firstView.unmount();

    mockConversation = {
      ...mockConversation!,
      id: 'conversation-2',
      isUnread: false,
    };
    mockOnWorkStateChanged.mockClear();
    mockRefetchConversation.mockClear();

    render(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationView
          conversationId="conversation-2"
          refreshNonce={0}
          onClose={jest.fn()}
          onUnavailable={mockOnUnavailable}
          showBack={false}
          realtimeUnavailable={false}
          onMessageAccepted={jest.fn()}
          onWorkStateChanged={mockOnWorkStateChanged}
        />
      </I18nProvider>,
    );

    await act(async () => resolveAutoRead?.());
    expect(mockRefetchConversation).not.toHaveBeenCalled();
    expect(mockOnWorkStateChanged).not.toHaveBeenCalled();
  });
});
