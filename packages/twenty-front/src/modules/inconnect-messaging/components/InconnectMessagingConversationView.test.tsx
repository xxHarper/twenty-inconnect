import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingConversationView } from '@/inconnect-messaging/components/InconnectMessagingConversationView';
import { InconnectMessagingConversationDocument } from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockFetchMore = jest.fn();
const mockRefetchConversation = jest.fn();
const mockRefetchMessages = jest.fn();
const mockOnUnavailable = jest.fn();
let mockConversation: {
  id: string;
  externalAddress: string;
  isLinked: boolean;
  lastInboundAt: null;
  createdAt: string;
} | null = {
  id: 'conversation-1',
  externalAddress: '+15550001111',
  isLinked: true,
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
} | null;

jest.mock('@apollo/client/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
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
  mockFetchMore.mockResolvedValue({
    data: {
      inconnectMessagingMessages: { pageInfo: { endCursor: 'cursor-2' } },
    },
  });
  mockConversation = {
    id: 'conversation-1',
    externalAddress: '+15550001111',
    isLinked: true,
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
  };
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
        />
      </I18nProvider>,
    );
    expect(mockRefetchConversation).toHaveBeenCalled();
    expect(mockRefetchMessages).toHaveBeenCalled();
  });
});
