import { act, renderHook } from '@testing-library/react';

import { useInconnectMessagingConversationContext } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationContext';

const mockRequestContext = jest.fn();
const mockUseLazyQuery = jest.fn();

jest.mock('@apollo/client/react', () => ({
  useLazyQuery: (...args: unknown[]) => mockUseLazyQuery(...args),
}));

const createDeferred = <TResult,>() => {
  let resolve!: (value: TResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const linkedContext = (recordLabel: string) => ({
  data: {
    inconnectMessagingConversationContext: {
      state: 'LINKED',
      object: { objectMetadataId: 'object-id', label: 'Customer' },
      record: { recordId: 'record-id', recordLabel },
      fields: [],
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLazyQuery.mockReturnValue([mockRequestContext, {}]);
});

describe('useInconnectMessagingConversationContext', () => {
  it('does not query without a selected Conversation', () => {
    const onUnavailable = jest.fn();
    const { result } = renderHook(() =>
      useInconnectMessagingConversationContext({
        conversationId: null,
        refreshNonce: 0,
        onUnavailable,
      }),
    );

    expect(result.current.status).toBe('idle');
    expect(mockRequestContext).not.toHaveBeenCalled();
  });

  it('clears A immediately and ignores its late result after selecting B', async () => {
    const requestA = createDeferred<ReturnType<typeof linkedContext>>();
    const requestB = createDeferred<ReturnType<typeof linkedContext>>();
    mockRequestContext
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);
    const onUnavailable = jest.fn();

    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useInconnectMessagingConversationContext({
          conversationId,
          refreshNonce: 0,
          onUnavailable,
        }),
      { initialProps: { conversationId: 'conversation-a' } },
    );

    expect(result.current.status).toBe('loading');
    expect(result.current.context).toBeNull();

    rerender({ conversationId: 'conversation-b' });

    expect(result.current.status).toBe('loading');
    expect(result.current.context).toBeNull();

    await act(async () => {
      requestA.resolve(linkedContext('Private A'));
      await requestA.promise;
    });

    expect(result.current.status).toBe('loading');
    expect(result.current.context).toBeNull();

    await act(async () => {
      requestB.resolve(linkedContext('Current B'));
      await requestB.promise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.context?.record?.recordLabel).toBe('Current B');
  });

  it('uses network-only and obtains a new result when re-entering a Conversation', async () => {
    mockRequestContext
      .mockResolvedValueOnce(linkedContext('Old authorization snapshot'))
      .mockResolvedValueOnce(linkedContext('Current authorized value'));

    const onUnavailable = jest.fn();
    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useInconnectMessagingConversationContext({
          conversationId,
          refreshNonce: 0,
          onUnavailable,
        }),
      { initialProps: { conversationId: 'conversation-a' as string | null } },
    );

    await act(async () => Promise.resolve());
    expect(result.current.context?.record?.recordLabel).toBe(
      'Old authorization snapshot',
    );

    rerender({ conversationId: null });
    expect(result.current.context).toBeNull();
    rerender({ conversationId: 'conversation-a' });
    expect(result.current.status).toBe('loading');
    expect(result.current.context).toBeNull();

    await act(async () => Promise.resolve());
    expect(result.current.context?.record?.recordLabel).toBe(
      'Current authorized value',
    );
    expect(mockRequestContext).toHaveBeenCalledTimes(2);
    expect(mockUseLazyQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fetchPolicy: 'network-only',
        nextFetchPolicy: 'network-only',
      }),
    );
  });

  it('refetches only the selected Conversation when the reconnect nonce changes', async () => {
    const reconnectRequest = createDeferred<ReturnType<typeof linkedContext>>();
    mockRequestContext
      .mockResolvedValueOnce(linkedContext('Current value'))
      .mockReturnValueOnce(reconnectRequest.promise);
    const onUnavailable = jest.fn();

    const { result, rerender } = renderHook(
      ({ refreshNonce }) =>
        useInconnectMessagingConversationContext({
          conversationId: 'conversation-a',
          refreshNonce,
          onUnavailable,
        }),
      { initialProps: { refreshNonce: 0 } },
    );

    await act(async () => Promise.resolve());
    rerender({ refreshNonce: 1 });

    expect(result.current.status).toBe('loading');
    expect(result.current.context).toBeNull();

    await act(async () => {
      reconnectRequest.resolve(linkedContext('Refreshed value'));
      await reconnectRequest.promise;
    });

    expect(mockRequestContext).toHaveBeenCalledTimes(2);
    expect(mockRequestContext).toHaveBeenLastCalledWith({
      variables: { conversationId: 'conversation-a' },
    });
    expect(result.current.context?.record?.recordLabel).toBe('Refreshed value');
  });

  it('clears context and reuses the unavailable flow for a safe null result', async () => {
    mockRequestContext.mockResolvedValue({
      data: { inconnectMessagingConversationContext: null },
    });
    const onUnavailable = jest.fn();

    const { result } = renderHook(() =>
      useInconnectMessagingConversationContext({
        conversationId: 'conversation-a',
        refreshNonce: 0,
        onUnavailable,
      }),
    );

    await act(async () => Promise.resolve());

    expect(result.current.status).toBe('unavailable');
    expect(result.current.context).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('clears context on an ordinary failure without exposing error details', async () => {
    mockRequestContext.mockRejectedValue(
      new Error('private SQL and authorization detail'),
    );
    const onUnavailable = jest.fn();

    const { result } = renderHook(() =>
      useInconnectMessagingConversationContext({
        conversationId: 'conversation-a',
        refreshNonce: 0,
        onUnavailable,
      }),
    );

    await act(async () => Promise.resolve());

    expect(result.current.status).toBe('error');
    expect(result.current.context).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
