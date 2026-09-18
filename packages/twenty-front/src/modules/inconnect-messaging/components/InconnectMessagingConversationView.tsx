import { useLingui } from '@lingui/react/macro';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { IconArrowLeft } from 'twenty-ui/icon';

import { InconnectMessagingMessageBubble } from '@/inconnect-messaging/components/InconnectMessagingMessageBubble';
import { InconnectMessagingComposer } from '@/inconnect-messaging/components/InconnectMessagingComposer';
import { mergeInconnectMessagingEdges } from '@/inconnect-messaging/utils/mergeInconnectMessagingEdges';
import {
  InconnectMessagingConversationDocument,
  InconnectMessagingMessagesDocument,
} from '~/generated-metadata/graphql';

import {
  StyledView,
  StyledHeader,
  StyledHeading,
  StyledSubtle,
  StyledScroll,
  StyledCenter,
  StyledDate,
  StyledFooter,
  StyledButton,
} from '@/inconnect-messaging/components/InconnectMessagingConversationView.styles';

const PAGE_SIZE = 30;

type InconnectMessagingConversationViewProps = {
  conversationId: string;
  refreshNonce: number;
  onClose: () => void;
  onUnavailable: () => void;
  showBack: boolean;
  realtimeUnavailable: boolean;
  onMessageAccepted: () => void;
};

export const InconnectMessagingConversationView = ({
  conversationId,
  refreshNonce,
  onClose,
  onUnavailable,
  showBack,
  realtimeUnavailable,
  onMessageAccepted,
}: InconnectMessagingConversationViewProps) => {
  const { t, i18n } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollHeightBeforeMore, setScrollHeightBeforeMore] = useState<
    number | null
  >(null);
  const [cursorBeforeMore, setCursorBeforeMore] = useState<string | null>(null);
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState(false);
  const [previousRefreshNonce, setPreviousRefreshNonce] =
    useState(refreshNonce);
  const {
    data: conversationData,
    loading: conversationLoading,
    error: conversationError,
    refetch: refetchConversation,
  } = useQuery(InconnectMessagingConversationDocument, {
    variables: { id: conversationId },
    fetchPolicy: 'network-only',
  });
  const {
    data: messageData,
    loading: messagesLoading,
    error: messagesError,
    fetchMore,
    refetch: refetchMessages,
  } = useQuery(InconnectMessagingMessagesDocument, {
    variables: { conversationId, paging: { first: PAGE_SIZE } },
    fetchPolicy: 'network-only',
  });

  useEffect(() => {
    if (previousRefreshNonce === refreshNonce) return;
    setPreviousRefreshNonce(refreshNonce);
    void refetchConversation().catch(() => undefined);
    void refetchMessages().catch(() => undefined);
  }, [
    refreshNonce,
    previousRefreshNonce,
    refetchConversation,
    refetchMessages,
  ]);

  useEffect(() => {
    if (
      conversationData?.inconnectMessagingConversation === null ||
      messageData?.inconnectMessagingMessages === null
    ) {
      onUnavailable();
    }
  }, [conversationData, messageData, onUnavailable]);

  const connection = messageData?.inconnectMessagingMessages;
  const messages = connection?.edges.map(({ node }) => node).reverse() ?? [];

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !connection) return;
    if (
      scrollHeightBeforeMore !== null &&
      cursorBeforeMore !== connection.pageInfo.endCursor
    ) {
      element.scrollTop += element.scrollHeight - scrollHeightBeforeMore;
      setScrollHeightBeforeMore(null);
      setCursorBeforeMore(null);
    } else if (
      scrollHeightBeforeMore === null &&
      (!initialScrollDone || stickToBottom)
    ) {
      element.scrollTop = element.scrollHeight;
      setInitialScrollDone(true);
    }
  }, [
    connection,
    conversationLoading,
    scrollHeightBeforeMore,
    cursorBeforeMore,
    initialScrollDone,
    stickToBottom,
  ]);

  const loadOlder = async () => {
    if (
      !connection?.pageInfo.hasNextPage ||
      !connection.pageInfo.endCursor ||
      messagesLoading ||
      loadingOlder
    )
      return;
    setLoadingOlder(true);
    setStickToBottom(false);
    setOlderMessagesError(false);
    setScrollHeightBeforeMore(scrollRef.current?.scrollHeight ?? null);
    setCursorBeforeMore(connection.pageInfo.endCursor);
    try {
      const result = await fetchMore({
        variables: {
          conversationId,
          paging: { first: PAGE_SIZE, after: connection.pageInfo.endCursor },
        },
        updateQuery: (previous, { fetchMoreResult }) => ({
          inconnectMessagingMessages:
            previous.inconnectMessagingMessages &&
            fetchMoreResult?.inconnectMessagingMessages
              ? mergeInconnectMessagingEdges(
                  previous.inconnectMessagingMessages,
                  fetchMoreResult.inconnectMessagingMessages,
                )
              : null,
        }),
      });
      if (
        !result.data?.inconnectMessagingMessages ||
        result.data.inconnectMessagingMessages.pageInfo.endCursor ===
          connection.pageInfo.endCursor
      ) {
        setScrollHeightBeforeMore(null);
        setCursorBeforeMore(null);
      }
    } catch {
      setScrollHeightBeforeMore(null);
      setCursorBeforeMore(null);
      setOlderMessagesError(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  const conversation = conversationData?.inconnectMessagingConversation;
  const isUnavailable =
    Boolean(conversationError) ||
    Boolean(messagesError) ||
    (!conversation && !conversationLoading) ||
    (!connection && !messagesLoading);

  return (
    <StyledView aria-label={t`Conversation`}>
      <StyledHeader>
        {showBack && (
          <StyledButton
            type="button"
            onClick={onClose}
            aria-label={t`Back to conversations`}
          >
            <IconArrowLeft size={18} />
          </StyledButton>
        )}
        {conversation && (
          <StyledHeading>
            <strong>{conversation.externalAddress}</strong>
            <StyledSubtle>
              {conversation.isLinked ? t`Linked conversation` : t`Unassigned`}
            </StyledSubtle>
          </StyledHeading>
        )}
      </StyledHeader>
      {isUnavailable ? (
        <StyledCenter role="alert">{t`Conversation is unavailable or you no longer have access.`}</StyledCenter>
      ) : conversationLoading || (messagesLoading && !connection) ? (
        <StyledCenter role="status">{t`Loading conversation…`}</StyledCenter>
      ) : (
        <StyledScroll
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            setStickToBottom(
              element.scrollHeight - element.scrollTop - element.clientHeight <
                80,
            );
            if (element.scrollTop < 80 && !olderMessagesError) void loadOlder();
          }}
        >
          {olderMessagesError && (
            <StyledCenter role="alert">{t`Could not load older messages. Try again.`}</StyledCenter>
          )}
          {connection?.pageInfo.hasNextPage && (
            <StyledButton
              type="button"
              onClick={() => void loadOlder()}
            >{t`Load older messages`}</StyledButton>
          )}
          {messages.length === 0 && (
            <StyledCenter>{t`No messages yet`}</StyledCenter>
          )}
          {messages.map((message, index) => {
            const date = new Date(message.displayAt);
            const previousDate =
              index > 0 ? new Date(messages[index - 1].displayAt) : null;
            const showDate =
              !previousDate ||
              date.toDateString() !== previousDate.toDateString();
            return (
              <div key={message.id}>
                {showDate && (
                  <StyledDate>
                    <time dateTime={message.displayAt}>
                      {new Intl.DateTimeFormat(i18n.locale, {
                        dateStyle: 'medium',
                      }).format(date)}
                    </time>
                  </StyledDate>
                )}
                <InconnectMessagingMessageBubble message={message} />
              </div>
            );
          })}
        </StyledScroll>
      )}
      {!isUnavailable && (
        <StyledFooter>
          {realtimeUnavailable && (
            <div role="status">{t`Live updates are temporarily unavailable.`}</div>
          )}
          <InconnectMessagingComposer
            key={conversationId}
            conversationId={conversationId}
            refreshNonce={refreshNonce}
            onAccepted={onMessageAccepted}
            onUnavailable={onUnavailable}
          />
        </StyledFooter>
      )}
    </StyledView>
  );
};
