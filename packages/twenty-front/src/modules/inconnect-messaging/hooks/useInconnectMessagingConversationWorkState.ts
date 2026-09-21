import { useLingui } from '@lingui/react/macro';
import { useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getInconnectMessagingErrorDetails } from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import {
  MarkInconnectMessagingConversationReadDocument,
  MarkInconnectMessagingConversationUnreadDocument,
  SetInconnectMessagingConversationFavoriteDocument,
  SetInconnectMessagingConversationPendingDocument,
} from '~/generated-metadata/graphql';

type WorkStateAction = 'favorite' | 'pending' | 'read' | 'unread';

type UseInconnectMessagingConversationWorkStateParams = {
  conversationId: string;
  isFavorite: boolean;
  isPending: boolean;
  isUnread: boolean;
  messagesReady: boolean;
  readThroughMessageId: string | null;
  refetchConversation: () => Promise<unknown>;
  onUnavailable: () => void;
  onWorkStateChanged: () => void;
};

export const useInconnectMessagingConversationWorkState = ({
  conversationId,
  isFavorite,
  isPending,
  isUnread,
  messagesReady,
  readThroughMessageId,
  refetchConversation,
  onUnavailable,
  onWorkStateChanged,
}: UseInconnectMessagingConversationWorkStateParams) => {
  const { t } = useLingui();
  const [pendingAction, setPendingAction] = useState<WorkStateAction | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibilityState, setVisibilityState] = useState(
    document.visibilityState,
  );
  const [manualUnreadSuppressed, setManualUnreadSuppressed] = useState(false);
  const [autoReadTarget, setAutoReadTarget] = useState<string | null>(null);
  const [autoReadPending, setAutoReadPending] = useState(false);
  const lifecycleController = useMemo(() => new AbortController(), []);
  const [setFavorite] = useMutation(
    SetInconnectMessagingConversationFavoriteDocument,
  );
  const [setPending] = useMutation(
    SetInconnectMessagingConversationPendingDocument,
  );
  const [markRead] = useMutation(
    MarkInconnectMessagingConversationReadDocument,
  );
  const [markUnread] = useMutation(
    MarkInconnectMessagingConversationUnreadDocument,
  );

  useEffect(() => {
    return () => {
      lifecycleController.abort();
    };
  }, [lifecycleController]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setVisibilityState(document.visibilityState);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleFailure = useCallback(
    (error: unknown) => {
      if (lifecycleController.signal.aborted) return;

      const { code } = getInconnectMessagingErrorDetails(error);

      if (['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(code ?? '')) {
        onUnavailable();

        return;
      }

      setErrorMessage(t`Could not update conversation. Try again.`);
    },
    [lifecycleController.signal, onUnavailable, t],
  );

  const refreshAfterMutation = useCallback(async () => {
    if (lifecycleController.signal.aborted) return;

    await refetchConversation().catch(() => undefined);

    if (lifecycleController.signal.aborted) return;

    onWorkStateChanged();
  }, [lifecycleController.signal, onWorkStateChanged, refetchConversation]);

  const runAction = useCallback(
    async ({
      action,
      mutation,
      onError,
    }: {
      action: WorkStateAction;
      mutation: () => Promise<unknown>;
      onError?: () => void;
    }) => {
      if (pendingAction !== null) return;

      setPendingAction(action);
      setErrorMessage(null);

      try {
        await mutation();
        await refreshAfterMutation();
      } catch (error) {
        onError?.();
        handleFailure(error);
      } finally {
        if (!lifecycleController.signal.aborted) setPendingAction(null);
      }
    },
    [
      handleFailure,
      lifecycleController.signal,
      pendingAction,
      refreshAfterMutation,
    ],
  );

  const toggleFavorite = useCallback(() => {
    void runAction({
      action: 'favorite',
      mutation: () =>
        setFavorite({ variables: { conversationId, favorite: !isFavorite } }),
    });
  }, [conversationId, isFavorite, runAction, setFavorite]);

  const togglePending = useCallback(() => {
    void runAction({
      action: 'pending',
      mutation: () =>
        setPending({ variables: { conversationId, pending: !isPending } }),
    });
  }, [conversationId, isPending, runAction, setPending]);

  const markConversationUnread = useCallback(() => {
    if (pendingAction !== null) return;

    setManualUnreadSuppressed(true);
    void runAction({
      action: 'unread',
      mutation: () => markUnread({ variables: { conversationId } }),
      onError: () => {
        setManualUnreadSuppressed(false);
      },
    });
  }, [conversationId, markUnread, pendingAction, runAction]);

  const markConversationRead = useCallback(() => {
    if (pendingAction !== null) return;

    const wasSuppressed = manualUnreadSuppressed;

    setManualUnreadSuppressed(false);
    void runAction({
      action: 'read',
      mutation: () => markRead({ variables: { conversationId } }),
      onError: () => {
        setManualUnreadSuppressed(wasSuppressed);
      },
    });
  }, [
    conversationId,
    manualUnreadSuppressed,
    markRead,
    pendingAction,
    runAction,
  ]);

  useEffect(() => {
    if (
      visibilityState !== 'visible' ||
      !messagesReady ||
      !isUnread ||
      manualUnreadSuppressed ||
      readThroughMessageId === null ||
      autoReadTarget === readThroughMessageId
    ) {
      return;
    }

    setAutoReadTarget(readThroughMessageId);
  }, [
    autoReadTarget,
    isUnread,
    manualUnreadSuppressed,
    messagesReady,
    readThroughMessageId,
    visibilityState,
  ]);

  useEffect(() => {
    if (autoReadTarget === null) return;

    let isCurrentAttempt = true;

    setAutoReadPending(true);

    void markRead({
      variables: {
        conversationId,
        throughMessageId: autoReadTarget,
      },
    })
      .then(async () => {
        if (!isCurrentAttempt || lifecycleController.signal.aborted) return;

        await refreshAfterMutation();
      })
      .catch((error) => {
        if (isCurrentAttempt) handleFailure(error);
      })
      .finally(() => {
        if (isCurrentAttempt && !lifecycleController.signal.aborted) {
          setAutoReadPending(false);
        }
      });

    return () => {
      isCurrentAttempt = false;
    };
  }, [
    autoReadTarget,
    conversationId,
    handleFailure,
    lifecycleController.signal,
    markRead,
    refreshAfterMutation,
  ]);

  return {
    errorMessage,
    isMutationPending: pendingAction !== null,
    isReadPending: autoReadPending || pendingAction !== null,
    markConversationRead,
    markConversationUnread,
    toggleFavorite,
    togglePending,
  };
};
