import { act, renderHook } from '@testing-library/react';

import { useInconnectMessagingConversationLinkCandidates } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';

const mockRequestCandidates = jest.fn();
const mockFetchMore = jest.fn();
const mockUseLazyQuery = jest.fn();

jest.mock('@apollo/client/react', () => ({
  useLazyQuery: (...args: unknown[]) => mockUseLazyQuery(...args),
}));

const createDeferred = <TResult,>() => {
  let resolve!: (value: TResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const candidate = (recordId: string, recordLabel: string) => ({
  recordId,
  recordLabel,
  fields: [
    {
      fieldMetadataId: `field-${recordId}`,
      label: 'Name',
      valueKind: 'TEXT' as const,
      displayValue: recordLabel,
      ordinal: 0,
    },
  ],
});

const queryResult = (
  recordId: string,
  recordLabel: string,
  options?: { hasNextPage?: boolean; endCursor?: string; totalCount?: number },
) => ({
  data: {
    inconnectMessagingConversationLinkCandidates: {
      edges: [
        {
          cursor: `cursor-${recordId}`,
          node: candidate(recordId, recordLabel),
        },
      ],
      pageInfo: {
        hasNextPage: options?.hasNextPage ?? false,
        endCursor: options?.endCursor ?? `cursor-${recordId}`,
      },
      totalCount: options?.totalCount ?? 1,
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLazyQuery.mockReturnValue([
    mockRequestCandidates,
    { fetchMore: mockFetchMore },
  ]);
});

describe('useInconnectMessagingConversationLinkCandidates', () => {
  it('does not query until a non-blank search is submitted and uses network-only', async () => {
    mockRequestCandidates.mockResolvedValue(queryResult('record-1', 'Ada'));
    const { result } = renderHook(() =>
      useInconnectMessagingConversationLinkCandidates({
        conversationId: 'conversation-1',
        onUnavailable: jest.fn(),
      }),
    );

    expect(mockRequestCandidates).not.toHaveBeenCalled();

    await act(async () => result.current.submitSearch('   '));
    expect(mockRequestCandidates).not.toHaveBeenCalled();

    await act(async () => result.current.submitSearch('  Ada  '));

    expect(mockRequestCandidates).toHaveBeenCalledWith({
      variables: {
        conversationId: 'conversation-1',
        search: 'Ada',
        paging: { first: 20 },
      },
    });
    expect(mockUseLazyQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fetchPolicy: 'network-only',
        nextFetchPolicy: 'network-only',
      }),
    );
    expect(
      result.current.candidates.map(({ recordLabel }) => recordLabel),
    ).toEqual(['Ada']);
  });

  it('keeps search B when search A resolves late', async () => {
    const requestA = createDeferred<ReturnType<typeof queryResult>>();
    const requestB = createDeferred<ReturnType<typeof queryResult>>();
    mockRequestCandidates
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);
    const { result } = renderHook(() =>
      useInconnectMessagingConversationLinkCandidates({
        conversationId: 'conversation-1',
        onUnavailable: jest.fn(),
      }),
    );

    act(() => {
      void result.current.submitSearch('A');
      void result.current.submitSearch('B');
    });
    await act(async () => {
      requestB.resolve(queryResult('record-b', 'Result B'));
      await requestB.promise;
    });
    await act(async () => {
      requestA.resolve(queryResult('record-a', 'Private A'));
      await requestA.promise;
    });

    expect(result.current.submittedSearch).toBe('B');
    expect(
      result.current.candidates.map(({ recordLabel }) => recordLabel),
    ).toEqual(['Result B']);
  });

  it('clears immediately on Conversation switch and ignores the old response', async () => {
    const requestA = createDeferred<ReturnType<typeof queryResult>>();
    mockRequestCandidates.mockReturnValue(requestA.promise);
    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useInconnectMessagingConversationLinkCandidates({
          conversationId,
          onUnavailable: jest.fn(),
        }),
      { initialProps: { conversationId: 'conversation-a' } },
    );

    act(() => {
      void result.current.submitSearch('Private A');
    });
    rerender({ conversationId: 'conversation-b' });

    expect(result.current.status).toBe('idle');
    expect(result.current.candidates).toEqual([]);

    await act(async () => {
      requestA.resolve(queryResult('record-a', 'Private A'));
      await requestA.promise;
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.candidates).toEqual([]);
  });

  it('loads the next cursor with the current identity and rejects a stale page', async () => {
    mockRequestCandidates
      .mockResolvedValueOnce(
        queryResult('record-a', 'Result A', {
          hasNextPage: true,
          endCursor: 'cursor-a',
          totalCount: 2,
        }),
      )
      .mockResolvedValueOnce(queryResult('record-b', 'Result B'));
    const stalePage = createDeferred<ReturnType<typeof queryResult>>();
    mockFetchMore.mockReturnValue(stalePage.promise);
    const { result } = renderHook(() =>
      useInconnectMessagingConversationLinkCandidates({
        conversationId: 'conversation-1',
        onUnavailable: jest.fn(),
      }),
    );

    await act(async () => result.current.submitSearch('A'));
    act(() => {
      void result.current.loadMore();
    });

    expect(mockFetchMore).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          conversationId: 'conversation-1',
          search: 'A',
          paging: { first: 20, after: 'cursor-a' },
        },
      }),
    );

    await act(async () => result.current.submitSearch('B'));
    await act(async () => {
      stalePage.resolve(queryResult('record-stale', 'Stale page'));
      await stalePage.promise;
    });

    expect(result.current.submittedSearch).toBe('B');
    expect(
      result.current.candidates.map(({ recordLabel }) => recordLabel),
    ).toEqual(['Result B']);
  });
});
