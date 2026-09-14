import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@apollo/client/react';
import { print, type ExecutionResult } from 'graphql';
import { useCallback, useEffect, useState } from 'react';
import { IconMessageCircle } from 'twenty-ui/icon';
import { useDebounce, useDebouncedCallback } from 'use-debounce';

import { useListenToBrowserEvent } from '@/browser-event/hooks/useListenToBrowserEvent';
import { InconnectMessagingConversationView } from '@/inconnect-messaging/components/InconnectMessagingConversationView';
import { mergeInconnectMessagingEdges } from '@/inconnect-messaging/utils/mergeInconnectMessagingEdges';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { SSE_CLIENT_RECONNECTED_EVENT_NAME } from '@/sse-db-event/constants/SseClientReconnectedEventName';
import { sseClientState } from '@/sse-db-event/states/sseClientState';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import {
  InconnectMessagingConversationsDocument,
  OnInconnectMessagingEventDocument,
  PermissionFlagType,
  type OnInconnectMessagingEventSubscription,
} from '~/generated-metadata/graphql';

import {
  StyledPage,
  StyledBody,
  StyledList,
  StyledListHeader,
  StyledSearch,
  StyledListScroll,
  StyledItem,
  StyledItemTop,
  StyledAddress,
  StyledSecondary,
  StyledCenter,
  StyledButton,
} from '~/pages/inconnect-messaging/InconnectMessagingPage.styles';

const PAGE_SIZE = 30;

export const InconnectMessagingPage = () => {
  const { t, i18n } = useLingui();
  const isMobile = useIsMobile();
  const hasMessagingPermission = useHasPermissionFlag(
    PermissionFlagType.INCONNECT_MESSAGING,
  );
  const sseClient = useAtomStateValue(sseClientState);
  const [searchInput, setSearchInput] = useState('');
  const [search] = useDebounce(searchInput, 300);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [moreConversationsError, setMoreConversationsError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { data, loading, error, fetchMore, refetch } = useQuery(
    InconnectMessagingConversationsDocument,
    {
      variables: { search: search || null, paging: { first: PAGE_SIZE } },
      skip: !hasMessagingPermission,
      fetchPolicy: 'network-only',
      notifyOnNetworkStatusChange: true,
    },
  );

  const debouncedRefetchList = useDebouncedCallback(() => {
    void refetch().catch(() => undefined);
  }, 150);
  const debouncedRefreshSelected = useDebouncedCallback(() => {
    setRefreshNonce((current) => current + 1);
  }, 150);

  const scheduleRefresh = useCallback(
    (refreshList: boolean, refreshSelected: boolean) => {
      if (refreshList) debouncedRefetchList();
      if (refreshSelected) debouncedRefreshSelected();
    },
    [debouncedRefetchList, debouncedRefreshSelected],
  );

  useEffect(() => {
    if (!sseClient || !hasMessagingPermission) return;
    setSubscriptionError(false);
    const dispose = sseClient.subscribe<OnInconnectMessagingEventSubscription>(
      { query: print(OnInconnectMessagingEventDocument) },
      {
        next: (
          result: ExecutionResult<OnInconnectMessagingEventSubscription>,
        ) => {
          const hint = result.data?.onInconnectMessagingEvent;
          if (!hint) return;
          if (hint.eventType === 'MESSAGE_CREATED') {
            scheduleRefresh(true, hint.conversationId === selectedId);
          } else if (
            hint.eventType === 'MESSAGE_STATUS_CHANGED' &&
            hint.conversationId === selectedId
          ) {
            scheduleRefresh(false, true);
          }
        },
        error: () => setSubscriptionError(true),
        complete: () => setSubscriptionError(true),
      },
    );
    return () => dispose();
  }, [sseClient, hasMessagingPermission, scheduleRefresh, selectedId]);

  const handleReconnect = useCallback(() => {
    setSubscriptionError(false);
    scheduleRefresh(true, selectedId !== null);
  }, [scheduleRefresh, selectedId]);
  useListenToBrowserEvent({
    eventName: SSE_CLIENT_RECONNECTED_EVENT_NAME,
    onBrowserEvent: handleReconnect,
  });

  useEffect(
    () => () => {
      debouncedRefetchList.cancel();
      debouncedRefreshSelected.cancel();
    },
    [debouncedRefetchList, debouncedRefreshSelected],
  );

  const connection = data?.inconnectMessagingConversations;
  const loadMore = async () => {
    if (
      !connection?.pageInfo.hasNextPage ||
      !connection.pageInfo.endCursor ||
      loading ||
      loadingMore
    )
      return;
    setLoadingMore(true);
    setMoreConversationsError(false);
    try {
      await fetchMore({
        variables: {
          search: search || null,
          paging: { first: PAGE_SIZE, after: connection.pageInfo.endCursor },
        },
        updateQuery: (previous, { fetchMoreResult }) => ({
          inconnectMessagingConversations: mergeInconnectMessagingEdges(
            previous.inconnectMessagingConversations,
            fetchMoreResult.inconnectMessagingConversations,
          ),
        }),
      });
    } catch {
      setMoreConversationsError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const closeSelection = useCallback(() => setSelectedId(null), []);
  const handleUnavailable = useCallback(() => {
    setSelectedId(null);
    setSelectionUnavailable(true);
  }, []);

  if (!hasMessagingPermission) {
    return (
      <StyledCenter role="alert">{t`Messaging is unavailable.`}</StyledCenter>
    );
  }

  return (
    <StyledPage>
      <PageHeader title={t`Messaging`} Icon={IconMessageCircle} />
      <StyledBody>
        {(!isMobile || !selectedId) && (
          <StyledList aria-label={t`Conversations`}>
            <StyledListHeader>
              <strong>{t`Conversations`}</strong>
              <StyledSearch
                type="search"
                aria-label={t`Search conversations`}
                placeholder={t`Search conversations`}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {(!sseClient || subscriptionError) && (
                <StyledSecondary role="status">{t`Live updates are temporarily unavailable. Reopen this page to refresh.`}</StyledSecondary>
              )}
              {selectionUnavailable && (
                <StyledSecondary role="alert">{t`Conversation is unavailable or you no longer have access.`}</StyledSecondary>
              )}
            </StyledListHeader>
            <StyledListScroll>
              {loading && !connection ? (
                <StyledCenter role="status">{t`Loading conversations…`}</StyledCenter>
              ) : error ? (
                <StyledCenter role="alert">{t`Could not load conversations.`}</StyledCenter>
              ) : connection?.edges.length === 0 ? (
                <StyledCenter>
                  {search
                    ? t`No conversations match your search.`
                    : t`No conversations yet.`}
                </StyledCenter>
              ) : (
                connection?.edges.map(({ node }) => (
                  <StyledItem
                    key={node.id}
                    type="button"
                    isSelected={selectedId === node.id}
                    aria-pressed={selectedId === node.id}
                    onClick={() => {
                      setSelectionUnavailable(false);
                      setSelectedId(node.id);
                    }}
                  >
                    <StyledItemTop>
                      <StyledAddress>{node.externalAddress}</StyledAddress>
                      <StyledSecondary>
                        {node.lastInboundAt &&
                          new Intl.DateTimeFormat(i18n.locale, {
                            dateStyle: 'short',
                          }).format(new Date(node.lastInboundAt))}
                      </StyledSecondary>
                    </StyledItemTop>
                    <StyledSecondary>
                      {node.isLinked ? t`Linked conversation` : t`Unassigned`}
                    </StyledSecondary>
                  </StyledItem>
                ))
              )}
              {connection?.pageInfo.hasNextPage && (
                <StyledButton
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loading || loadingMore}
                >{t`Load more conversations`}</StyledButton>
              )}
              {moreConversationsError && (
                <StyledCenter role="alert">{t`Could not load more conversations. Try again.`}</StyledCenter>
              )}
            </StyledListScroll>
          </StyledList>
        )}
        {selectedId ? (
          <InconnectMessagingConversationView
            key={selectedId}
            conversationId={selectedId}
            refreshNonce={refreshNonce}
            onClose={closeSelection}
            onUnavailable={handleUnavailable}
            showBack={isMobile}
            realtimeUnavailable={!sseClient || subscriptionError}
          />
        ) : (
          !isMobile && (
            <StyledCenter>
              {selectionUnavailable
                ? t`Conversation is unavailable or you no longer have access.`
                : t`Select a conversation to read its messages.`}
            </StyledCenter>
          )
        )}
      </StyledBody>
    </StyledPage>
  );
};
