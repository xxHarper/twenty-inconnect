import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@apollo/client/react';
import { print, type ExecutionResult } from 'graphql';
import { useCallback, useEffect, useState } from 'react';
import { IconMessageCircle } from 'twenty-ui/icon';
import { SegmentedControl, type SegmentedControlOption } from 'twenty-ui/input';
import { useDebounce, useDebouncedCallback } from 'use-debounce';

import { InconnectMessagingConversationListItem } from '@/inconnect-messaging/components/InconnectMessagingConversationListItem';
import { useListenToBrowserEvent } from '@/browser-event/hooks/useListenToBrowserEvent';
import { InconnectMessagingConversationWorkspace } from '@/inconnect-messaging/components/InconnectMessagingConversationWorkspace';
import { mergeInconnectMessagingEdges } from '@/inconnect-messaging/utils/mergeInconnectMessagingEdges';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { SSE_CLIENT_RECONNECTED_EVENT_NAME } from '@/sse-db-event/constants/SseClientReconnectedEventName';
import { sseClientState } from '@/sse-db-event/states/sseClientState';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import {
  InconnectMessagingConversationsDocument,
  InconnectMessagingConversationWorkStateFilter,
  OnInconnectMessagingEventDocument,
  PermissionFlagType,
  type OnInconnectMessagingEventSubscription,
} from '~/generated-metadata/graphql';

import {
  StyledPage,
  StyledBody,
  StyledList,
  StyledListHeader,
  StyledFilterScroll,
  StyledSearch,
  StyledListScroll,
  StyledSecondary,
  StyledCenter,
  StyledButton,
} from '~/pages/inconnect-messaging/InconnectMessagingPage.styles';

const PAGE_SIZE = 30;

export const InconnectMessagingPage = () => {
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const hasMessagingPermission = useHasPermissionFlag(
    PermissionFlagType.INCONNECT_MESSAGING,
  );
  const sseClient = useAtomStateValue(sseClientState);
  const [searchInput, setSearchInput] = useState('');
  const [search] = useDebounce(searchInput, 300);
  const [workState, setWorkState] =
    useState<InconnectMessagingConversationWorkStateFilter>(
      InconnectMessagingConversationWorkStateFilter.ALL,
    );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [contextRefreshNonce, setContextRefreshNonce] = useState(0);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [moreConversationsError, setMoreConversationsError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { data, loading, error, fetchMore, refetch } = useQuery(
    InconnectMessagingConversationsDocument,
    {
      variables: {
        search: search || null,
        workState,
        paging: { first: PAGE_SIZE },
      },
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
          } else if (hint.eventType === 'CONVERSATION_UPDATED') {
            scheduleRefresh(true, hint.conversationId === selectedId);
          } else if (
            (hint.eventType === 'MESSAGE_STATUS_CHANGED' ||
              hint.eventType === 'MESSAGE_UPDATED') &&
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
    if (selectedId !== null) {
      setContextRefreshNonce((current) => current + 1);
    }
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
          workState,
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
  const handleMessageAccepted = useCallback(
    () => scheduleRefresh(true, true),
    [scheduleRefresh],
  );
  const handleWorkStateChanged = useCallback(
    () => scheduleRefresh(true, false),
    [scheduleRefresh],
  );

  const workStateOptions = [
    {
      label: t`All`,
      value: InconnectMessagingConversationWorkStateFilter.ALL,
    },
    {
      label: t`Unread`,
      value: InconnectMessagingConversationWorkStateFilter.UNREAD,
    },
    {
      label: t`Favorites`,
      value: InconnectMessagingConversationWorkStateFilter.FAVORITES,
    },
    {
      label: t`Pending`,
      value: InconnectMessagingConversationWorkStateFilter.PENDING,
    },
  ] satisfies SegmentedControlOption<InconnectMessagingConversationWorkStateFilter>[];

  const emptyState = search
    ? t`No conversations match your search in this view.`
    : workState === InconnectMessagingConversationWorkStateFilter.UNREAD
      ? t`No unread conversations.`
      : workState === InconnectMessagingConversationWorkStateFilter.FAVORITES
        ? t`No favorite conversations.`
        : workState === InconnectMessagingConversationWorkStateFilter.PENDING
          ? t`No pending conversations.`
          : t`No conversations yet.`;

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
              <StyledFilterScroll>
                <SegmentedControl
                  ariaLabel={t`Conversation view`}
                  itemWidth="content"
                  onChange={(nextWorkState) => {
                    setMoreConversationsError(false);
                    setWorkState(nextWorkState);
                  }}
                  options={workStateOptions}
                  role="tablist"
                  value={workState}
                />
              </StyledFilterScroll>
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
                <StyledCenter>{emptyState}</StyledCenter>
              ) : (
                connection?.edges.map(({ node }) => (
                  <InconnectMessagingConversationListItem
                    key={node.id}
                    conversation={node}
                    isSelected={selectedId === node.id}
                    onSelect={() => {
                      setSelectionUnavailable(false);
                      setSelectedId(node.id);
                    }}
                  />
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
          <InconnectMessagingConversationWorkspace
            key={selectedId}
            conversationId={selectedId}
            refreshNonce={refreshNonce}
            contextRefreshNonce={contextRefreshNonce}
            isMobile={isMobile}
            onClose={closeSelection}
            onUnavailable={handleUnavailable}
            realtimeUnavailable={!sseClient || subscriptionError}
            onMessageAccepted={handleMessageAccepted}
            onWorkStateChanged={handleWorkStateChanged}
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
