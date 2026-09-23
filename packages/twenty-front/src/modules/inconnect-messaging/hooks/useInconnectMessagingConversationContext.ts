import { useLazyQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';

import { getInconnectMessagingErrorDetails } from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import {
  InconnectMessagingConversationContextDocument,
  type InconnectMessagingConversationContextQuery,
} from '~/generated-metadata/graphql';

export type InconnectMessagingConversationContext = NonNullable<
  InconnectMessagingConversationContextQuery['inconnectMessagingConversationContext']
>;

type InconnectMessagingConversationContextRequestState = {
  conversationId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  context: InconnectMessagingConversationContext | null;
};

type StoredInconnectMessagingConversationContextRequestState =
  InconnectMessagingConversationContextRequestState & {
    refreshNonce: number;
  };

type UseInconnectMessagingConversationContextProps = {
  conversationId: string | null;
  refreshNonce: number;
  onUnavailable: () => void;
};

const UNAVAILABLE_ERROR_CODES = new Set([
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
]);

export const useInconnectMessagingConversationContext = ({
  conversationId,
  refreshNonce,
  onUnavailable,
}: UseInconnectMessagingConversationContextProps): InconnectMessagingConversationContextRequestState => {
  const [requestContext] = useLazyQuery(
    InconnectMessagingConversationContextDocument,
    {
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
    },
  );
  const [requestState, setRequestState] =
    useState<StoredInconnectMessagingConversationContextRequestState>({
      conversationId: null,
      refreshNonce: -1,
      status: 'idle',
      context: null,
    });

  useEffect(() => {
    const requestController = new AbortController();

    if (conversationId === null) {
      setRequestState({
        conversationId: null,
        refreshNonce,
        status: 'idle',
        context: null,
      });

      return;
    }

    setRequestState({
      conversationId,
      refreshNonce,
      status: 'loading',
      context: null,
    });

    void requestContext({
      variables: { conversationId },
    })
      .then((result) => {
        if (requestController.signal.aborted) {
          return;
        }

        if (result.error) {
          const { code } = getInconnectMessagingErrorDetails(result.error);

          setRequestState({
            conversationId,
            refreshNonce,
            status: UNAVAILABLE_ERROR_CODES.has(code ?? '')
              ? 'unavailable'
              : 'error',
            context: null,
          });

          if (UNAVAILABLE_ERROR_CODES.has(code ?? '')) {
            onUnavailable();
          }

          return;
        }

        const context = result.data?.inconnectMessagingConversationContext;

        if (context == null) {
          setRequestState({
            conversationId,
            refreshNonce,
            status: 'unavailable',
            context: null,
          });
          onUnavailable();

          return;
        }

        setRequestState({
          conversationId,
          refreshNonce,
          status: 'ready',
          context,
        });
      })
      .catch((error: unknown) => {
        if (requestController.signal.aborted) {
          return;
        }

        const { code } = getInconnectMessagingErrorDetails(error);
        const isUnavailable = UNAVAILABLE_ERROR_CODES.has(code ?? '');

        setRequestState({
          conversationId,
          refreshNonce,
          status: isUnavailable ? 'unavailable' : 'error',
          context: null,
        });

        if (isUnavailable) {
          onUnavailable();
        }
      });

    return () => requestController.abort();
  }, [conversationId, onUnavailable, refreshNonce, requestContext]);

  if (conversationId === null) {
    return { conversationId: null, status: 'idle', context: null };
  }

  if (
    requestState.conversationId !== conversationId ||
    requestState.refreshNonce !== refreshNonce
  ) {
    return { conversationId, status: 'loading', context: null };
  }

  return {
    conversationId: requestState.conversationId,
    status: requestState.status,
    context: requestState.context,
  };
};
