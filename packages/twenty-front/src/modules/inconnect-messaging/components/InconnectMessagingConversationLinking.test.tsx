import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingConversationLinking } from '@/inconnect-messaging/components/InconnectMessagingConversationLinking';
import { useInconnectMessagingConversationLinkCandidates } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';
import { getInconnectMessagingErrorDetails } from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import { InconnectMessagingContextValueKind } from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockLinkConversation = jest.fn();
const mockUseMutation = jest.fn();

jest.mock('@apollo/client/react', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));
jest.mock(
  '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates',
);
jest.mock('@/inconnect-messaging/utils/getInconnectMessagingErrorDetails');

const mockUseCandidates = jest.mocked(
  useInconnectMessagingConversationLinkCandidates,
);
const mockGetErrorDetails = jest.mocked(getInconnectMessagingErrorDetails);
const mockSubmitSearch = jest.fn();
const mockInvalidate = jest.fn();
const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();

const candidates = [
  {
    recordId: 'private-record-1',
    recordLabel: 'Ada Lovelace',
    fields: [
      {
        fieldMetadataId: 'field-1',
        label: 'Second backend field',
        valueKind: InconnectMessagingContextValueKind.TEXT,
        displayValue: 'Server value',
        ordinal: 9,
      },
      {
        fieldMetadataId: 'field-2',
        label: 'First ordinal value',
        valueKind: InconnectMessagingContextValueKind.TEXT,
        displayValue: null,
        ordinal: 1,
      },
    ],
  },
  {
    recordId: 'private-record-2',
    recordLabel: null,
    fields: [],
  },
];

const candidateState = (
  overrides: Partial<
    ReturnType<typeof useInconnectMessagingConversationLinkCandidates>
  > = {},
) => ({
  conversationId: 'conversation-1',
  submittedSearch: null,
  status: 'idle' as const,
  candidates: [],
  totalCount: null,
  hasNextPage: false,
  endCursor: null,
  loadingMore: false,
  loadMoreFailed: false,
  submitSearch: mockSubmitSearch,
  invalidate: mockInvalidate,
  loadMore: mockLoadMore,
  refresh: mockRefresh,
  ...overrides,
});

const renderLinking = (
  props: Partial<
    React.ComponentProps<typeof InconnectMessagingConversationLinking>
  > = {},
) => {
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);

  const defaultProps = {
    conversationId: 'conversation-1',
    onCancel: jest.fn(),
    onLinked: jest.fn(),
    onAlreadyLinked: jest.fn(),
    onUnavailable: jest.fn(),
  };
  const resolvedProps = {
    conversationId: props.conversationId ?? defaultProps.conversationId,
    onCancel: props.onCancel ?? defaultProps.onCancel,
    onLinked: props.onLinked ?? defaultProps.onLinked,
    onAlreadyLinked: props.onAlreadyLinked ?? defaultProps.onAlreadyLinked,
    onUnavailable: props.onUnavailable ?? defaultProps.onUnavailable,
  };

  return {
    ...render(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationLinking
          conversationId={resolvedProps.conversationId}
          onCancel={resolvedProps.onCancel}
          onLinked={resolvedProps.onLinked}
          onAlreadyLinked={resolvedProps.onAlreadyLinked}
          onUnavailable={resolvedProps.onUnavailable}
        />
      </I18nProvider>,
    ),
    props: resolvedProps,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMutation.mockReturnValue([mockLinkConversation, {}]);
  mockUseCandidates.mockReturnValue(candidateState());
  mockGetErrorDetails.mockReturnValue({
    code: null,
    subCode: null,
    message: null,
  });
});

describe('InconnectMessagingConversationLinking', () => {
  it('starts without a request or sender-derived prefill and ignores blank search', () => {
    renderLinking();

    expect(mockSubmitSearch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('CRM record search')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByText('Enter a search and select Search.')).toBeVisible();
  });

  it('submits only the explicit draft through the candidate controller', () => {
    renderLinking();

    fireEvent.change(screen.getByLabelText('CRM record search'), {
      target: { value: '  Ada  ' },
    });
    fireEvent.submit(
      screen.getByLabelText('CRM record search').closest('form')!,
    );

    expect(mockSubmitSearch).toHaveBeenCalledWith('  Ada  ');
  });

  it('invalidates visible results when the draft no longer matches the submitted search', () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    renderLinking();

    fireEvent.change(screen.getByLabelText('CRM record search'), {
      target: { value: 'Grace' },
    });

    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it('renders the backend order, safe fallbacks, and one accessible selection', () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
        totalCount: 2,
      }),
    );
    renderLinking();

    expect(screen.getByText('2 CRM records found')).toBeVisible();
    expect(screen.getByText('Ada Lovelace')).toBeVisible();
    expect(screen.getByText('Unlabeled record')).toBeVisible();
    expect(screen.queryByText('private-record-1')).not.toBeInTheDocument();
    expect(screen.queryByText('private-record-2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('No value')).toHaveTextContent('—');

    const fieldLabels = screen.getAllByText(/backend field|ordinal value/);
    expect(fieldLabels.map(({ textContent }) => textContent)).toEqual([
      'Second backend field',
      'First ordinal value',
    ]);

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);
    expect(radios[0]).toBeChecked();
    fireEvent.click(radios[1]);
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
    expect(mockLinkConversation).not.toHaveBeenCalled();
  });

  it('preserves results through confirmation and links with only Conversation and record IDs', async () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
        totalCount: 2,
      }),
    );
    mockLinkConversation.mockResolvedValue({
      data: { linkInconnectMessagingConversation: { state: 'LINKED' } },
    });
    const onLinked = jest.fn();
    renderLinking({ onLinked });

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', { name: 'Confirm CRM link' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Changing or removing this link is not currently available.',
      ),
    ).toBeVisible();
    expect(mockLinkConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('2 CRM records found')).toBeVisible();
    expect(screen.getAllByRole('radio')[0]).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link CRM record' }));
    });

    expect(mockLinkConversation).toHaveBeenCalledWith({
      variables: {
        conversationId: 'conversation-1',
        recordId: 'private-record-1',
      },
    });
    expect(mockInvalidate).toHaveBeenCalled();
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it('disables confirmation while linking and prevents double submit', async () => {
    let resolveLink!: (value: unknown) => void;
    const linkPromise = new Promise((resolve) => {
      resolveLink = resolve;
    });
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    mockLinkConversation.mockReturnValue(linkPromise);
    renderLinking();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const linkButton = screen.getByRole('button', {
      name: 'Link CRM record',
    });
    fireEvent.click(linkButton);
    fireEvent.click(screen.getByRole('button', { name: 'Linking CRM record' }));

    expect(
      screen.getByRole('button', { name: 'Linking CRM record' }),
    ).toBeDisabled();
    expect(mockLinkConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLink({
        data: { linkInconnectMessagingConversation: { state: 'LINKED' } },
      });
      await linkPromise;
    });
  });

  it('invalidates a stale target safely and refreshes the submitted search', async () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    mockLinkConversation.mockRejectedValue(new Error('private target detail'));
    mockGetErrorDetails.mockReturnValue({
      code: 'NOT_FOUND',
      subCode: null,
      message: 'Record not found',
    });
    renderLinking();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link CRM record' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The record is no longer available. Search again.',
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('heading', { name: 'Confirm CRM link' }),
    ).not.toBeInTheDocument();
  });

  it('revalidates an already-linked conflict without retrying', async () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    mockLinkConversation.mockRejectedValue(new Error('conflict'));
    mockGetErrorDetails.mockReturnValue({
      code: 'CONFLICT',
      subCode: null,
      message: 'CONVERSATION_ALREADY_LINKED',
    });
    const onAlreadyLinked = jest.fn();
    renderLinking({ onAlreadyLinked });

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link CRM record' }));
    });

    expect(mockLinkConversation).toHaveBeenCalledTimes(1);
    expect(onAlreadyLinked).toHaveBeenCalledTimes(1);
  });

  it('uses the existing unavailable flow after authorization loss', async () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    mockLinkConversation.mockRejectedValue(new Error('private auth detail'));
    mockGetErrorDetails.mockReturnValue({
      code: 'FORBIDDEN',
      subCode: null,
      message: 'Forbidden',
    });
    const onUnavailable = jest.fn();
    renderLinking({ onUnavailable });

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link CRM record' }));
    });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/private auth detail/i)).not.toBeInTheDocument();
  });

  it('does not apply a late completion after the linking surface unmounts', async () => {
    let resolveLink!: (value: unknown) => void;
    const linkPromise = new Promise((resolve) => {
      resolveLink = resolve;
    });
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
      }),
    );
    mockLinkConversation.mockReturnValue(linkPromise);
    const onLinked = jest.fn();
    const rendered = renderLinking({ onLinked });

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link CRM record' }));
    rendered.unmount();

    await act(async () => {
      resolveLink({
        data: { linkInconnectMessagingConversation: { state: 'LINKED' } },
      });
      await linkPromise;
    });

    expect(onLinked).not.toHaveBeenCalled();
  });

  it('loads more from the current result set and exposes safe list states', () => {
    mockUseCandidates.mockReturnValue(
      candidateState({
        submittedSearch: 'Ada',
        status: 'ready',
        candidates,
        totalCount: 8,
        hasNextPage: true,
      }),
    );
    const rendered = renderLinking();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(mockLoadMore).toHaveBeenCalledTimes(1);

    mockUseCandidates.mockReturnValue(
      candidateState({ submittedSearch: 'Nobody', status: 'ready' }),
    );
    rendered.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationLinking
          conversationId="conversation-1"
          onCancel={jest.fn()}
          onLinked={jest.fn()}
          onAlreadyLinked={jest.fn()}
          onUnavailable={jest.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('No matching records.')).toBeVisible();

    mockUseCandidates.mockReturnValue(
      candidateState({ submittedSearch: 'Error', status: 'error' }),
    );
    rendered.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationLinking
          conversationId="conversation-1"
          onCancel={jest.fn()}
          onLinked={jest.fn()}
          onAlreadyLinked={jest.fn()}
          onUnavailable={jest.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'CRM records could not be loaded. Try again.',
    );
  });
});
