import { useCallback, useEffect } from 'react';
import { useMediaQuery } from 'react-responsive';

import { InconnectMessagingConversationContextPanel } from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel';
import { InconnectMessagingConversationView } from '@/inconnect-messaging/components/InconnectMessagingConversationView';
import { useModal } from '@/ui/layout/modal/hooks/useModal';

const CONTEXT_PANEL_MINIMUM_VIEWPORT = 1100;

type InconnectMessagingConversationWorkspaceProps = {
  conversationId: string;
  refreshNonce: number;
  conversationRefreshNonce: number;
  contextRefreshNonce: number;
  isMobile: boolean;
  realtimeUnavailable: boolean;
  onClose: () => void;
  onUnavailable: () => void;
  onMessageAccepted: () => void;
  onWorkStateChanged: () => void;
  onConversationLinked: (conversationId: string) => void;
};

export const InconnectMessagingConversationWorkspace = ({
  conversationId,
  refreshNonce,
  conversationRefreshNonce,
  contextRefreshNonce,
  isMobile,
  realtimeUnavailable,
  onClose,
  onUnavailable,
  onMessageAccepted,
  onWorkStateChanged,
  onConversationLinked,
}: InconnectMessagingConversationWorkspaceProps) => {
  const isCompactContextViewport = useMediaQuery({
    query: `(max-width: ${CONTEXT_PANEL_MINIMUM_VIEWPORT}px)`,
  });
  const usesContextModal = isMobile || isCompactContextViewport;
  const { openModal, closeModal } = useModal();
  const modalInstanceId = `inconnect-messaging-context-${conversationId}`;

  const closeContext = useCallback(() => {
    closeModal(modalInstanceId);
  }, [closeModal, modalInstanceId]);

  useEffect(() => closeContext, [closeContext]);

  const handleClose = useCallback(() => {
    closeContext();
    onClose();
  }, [closeContext, onClose]);

  const handleUnavailable = useCallback(() => {
    closeContext();
    onUnavailable();
  }, [closeContext, onUnavailable]);

  return (
    <>
      <InconnectMessagingConversationView
        conversationId={conversationId}
        refreshNonce={refreshNonce}
        conversationRefreshNonce={conversationRefreshNonce}
        onClose={handleClose}
        onUnavailable={handleUnavailable}
        showBack={isMobile}
        realtimeUnavailable={realtimeUnavailable}
        onMessageAccepted={onMessageAccepted}
        onWorkStateChanged={onWorkStateChanged}
        onShowContext={
          usesContextModal ? () => openModal(modalInstanceId) : undefined
        }
      />
      <InconnectMessagingConversationContextPanel
        conversationId={conversationId}
        refreshNonce={contextRefreshNonce}
        displayMode={usesContextModal ? 'modal' : 'desktop'}
        modalInstanceId={modalInstanceId}
        onUnavailable={handleUnavailable}
        onConversationLinked={onConversationLinked}
      />
    </>
  );
};
