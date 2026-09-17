import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingPage } from '~/pages/inconnect-messaging/InconnectMessagingPage';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockFetchMore = jest.fn();
const mockRefetch = jest.fn();
const mockUseHasPermissionFlag = jest.fn();
let mockIsMobile = false;
let mockSseClient: { subscribe: jest.Mock } | null = null;

jest.mock('@apollo/client/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
jest.mock('@/settings/roles/hooks/useHasPermissionFlag', () => ({
  useHasPermissionFlag: () => mockUseHasPermissionFlag(),
}));
jest.mock('@/ui/utilities/responsive/hooks/useIsMobile', () => ({
  useIsMobile: () => mockIsMobile,
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockSseClient,
}));
jest.mock('@/ui/layout/page/components/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
jest.mock(
  '@/inconnect-messaging/components/InconnectMessagingConversationView',
  () => ({
    InconnectMessagingConversationView: ({
      conversationId,
      refreshNonce,
      onClose,
    }: {
      conversationId: string;
      refreshNonce: number;
      onClose: () => void;
    }) => (
      <div>
        <span>{`Selected ${conversationId} refresh ${refreshNonce}`}</span>
        <button onClick={onClose}>Back to conversations</button>
      </div>
    ),
  }),
);
jest.mock('use-debounce', () => ({
  useDebounce: (value: string) => [value],
  useDebouncedCallback: (callback: () => void, delay: number) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(callback, delay);
    };
    debounced.cancel = () => {
      if (timer) clearTimeout(timer);
    };
    return debounced;
  },
}));

const conversation = {
  id: 'conversation-1',
  externalAddress: '+15550001111',
  isLinked: false,
  lastInboundAt: '2026-09-14T12:00:00.000Z',
  createdAt: '2026-09-14T12:00:00.000Z',
};

const setConversations = (
  edges = [{ cursor: 'cursor-1', node: conversation }],
  hasNextPage = false,
) => {
  mockUseQuery.mockReturnValue({
    data: {
      inconnectMessagingConversations: {
        edges,
        pageInfo: { hasNextPage, endCursor: 'cursor-1' },
      },
    },
    loading: false,
    error: undefined,
    fetchMore: mockFetchMore,
    refetch: mockRefetch,
  });
};

const renderPage = () => {
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);
  return render(
    <I18nProvider i18n={i18n}>
      <InconnectMessagingPage />
    </I18nProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRefetch.mockResolvedValue({});
  mockIsMobile = false;
  mockSseClient = null;
  mockUseHasPermissionFlag.mockReturnValue(true);
  setConversations();
});

describe('InconnectMessagingPage', () => {
  it('shows authorized conversations and selects one', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+15550001111/ }));
    expect(
      screen.getByText('Selected conversation-1 refresh 0'),
    ).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows an empty state and searches through the query variables', () => {
    setConversations([]);
    renderPage();
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'Alex' },
    });
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        variables: { search: 'Alex', paging: { first: 30 } },
      }),
    );
    expect(
      screen.getByText('No conversations match your search.'),
    ).toBeInTheDocument();
  });

  it('requests the next authorized cursor page', async () => {
    setConversations(undefined, true);
    renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load more conversations' }),
      );
    });
    expect(mockFetchMore).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { search: null, paging: { first: 30, after: 'cursor-1' } },
      }),
    );
  });

  it('hides messaging for a user without the functional flag', () => {
    mockUseHasPermissionFlag.mockReturnValue(false);
    renderPage();
    expect(screen.queryByText('+15550001111')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Messaging is unavailable.',
    );
  });

  it('uses a back control on a narrow layout', () => {
    mockIsMobile = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+15550001111/ }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to conversations' }),
    );
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('coalesces duplicate creation hints and refetches the selected conversation', () => {
    jest.useFakeTimers();
    let next:
      | ((result: {
          data: {
            onInconnectMessagingEvent: {
              eventId: string;
              eventType: string;
              conversationId: string;
            };
          };
        }) => void)
      | undefined;
    mockSseClient = {
      subscribe: jest.fn((_query, handlers) => {
        next = handlers.next;
        return jest.fn();
      }),
    };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+15550001111/ }));
    act(() => {
      next?.({
        data: {
          onInconnectMessagingEvent: {
            eventId: 'one',
            eventType: 'MESSAGE_CREATED',
            conversationId: 'conversation-1',
          },
        },
      });
      next?.({
        data: {
          onInconnectMessagingEvent: {
            eventId: 'one',
            eventType: 'MESSAGE_CREATED',
            conversationId: 'conversation-1',
          },
        },
      });
      jest.advanceTimersByTime(150);
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Selected conversation-1 refresh 1'),
    ).toBeInTheDocument();
    jest.useRealTimers();
  });

  it.each(['MESSAGE_STATUS_CHANGED', 'MESSAGE_UPDATED'])(
    'refreshes only the selected conversation for a %s hint',
    (eventType) => {
      jest.useFakeTimers();
      let next:
        | ((result: {
            data: {
              onInconnectMessagingEvent: {
                eventId: string;
                eventType: string;
                conversationId: string;
              };
            };
          }) => void)
        | undefined;
      mockSseClient = {
        subscribe: jest.fn((_query, handlers) => {
          next = handlers.next;
          return jest.fn();
        }),
      };
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+15550001111/ }));
      act(() => {
        next?.({
          data: {
            onInconnectMessagingEvent: {
              eventId: 'two',
              eventType,
              conversationId: 'conversation-1',
            },
          },
        });
        jest.advanceTimersByTime(150);
      });
      expect(mockRefetch).not.toHaveBeenCalled();
      expect(
        screen.getByText('Selected conversation-1 refresh 1'),
      ).toBeInTheDocument();
      jest.useRealTimers();
    },
  );

  it('refetches on reconnect', () => {
    jest.useFakeTimers();
    renderPage();
    act(() => {
      window.dispatchEvent(new Event('sse-client-reconnected'));
      jest.advanceTimersByTime(150);
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
