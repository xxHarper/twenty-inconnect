import { useLazyQuery } from '@apollo/client/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getInconnectMessagingErrorDetails } from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import {
  InconnectMessagingConversationLinkCandidatesDocument,
  type InconnectMessagingConversationLinkCandidatesQuery,
  type InconnectMessagingConversationLinkCandidatesQueryVariables,
} from '~/generated-metadata/graphql';

const CANDIDATE_PAGE_SIZE = 20;
const UNAVAILABLE_ERROR_CODES = new Set([
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
]);

export type InconnectMessagingConversationLinkCandidate =
  InconnectMessagingConversationLinkCandidatesQuery['inconnectMessagingConversationLinkCandidates']['edges'][number]['node'];

type CandidateRequestState = {
  conversationId: string;
  submittedSearch: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  candidates: InconnectMessagingConversationLinkCandidate[];
  totalCount: number | null;
  hasNextPage: boolean;
  endCursor: string | null;
  loadingMore: boolean;
  loadMoreFailed: boolean;
};

type UseInconnectMessagingConversationLinkCandidatesProps = {
  conversationId: string;
  onUnavailable: () => void;
};

const createIdleState = (conversationId: string): CandidateRequestState => ({
  conversationId,
  submittedSearch: null,
  status: 'idle',
  candidates: [],
  totalCount: null,
  hasNextPage: false,
  endCursor: null,
  loadingMore: false,
  loadMoreFailed: false,
});

export const useInconnectMessagingConversationLinkCandidates = ({
  conversationId,
  onUnavailable,
}: UseInconnectMessagingConversationLinkCandidatesProps) => {
  const [requestCandidates, { fetchMore }] = useLazyQuery<
    InconnectMessagingConversationLinkCandidatesQuery,
    InconnectMessagingConversationLinkCandidatesQueryVariables
  >(InconnectMessagingConversationLinkCandidatesDocument, {
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
  });
  // Request identity must update synchronously without becoming rendered state.
  // oxlint-disable-next-line twenty/no-state-useref
  const conversationIdRef = useRef(conversationId);
  // oxlint-disable-next-line twenty/no-state-useref
  const requestGenerationRef = useRef(0);
  // oxlint-disable-next-line twenty/no-state-useref
  const loadingMoreRef = useRef(false);
  // oxlint-disable-next-line twenty/no-state-useref
  const onUnavailableRef = useRef(onUnavailable);
  const [requestState, setRequestState] = useState<CandidateRequestState>(() =>
    createIdleState(conversationId),
  );

  conversationIdRef.current = conversationId;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    requestGenerationRef.current += 1;
    loadingMoreRef.current = false;
    setRequestState(createIdleState(conversationId));
  }, [conversationId]);

  const handleRequestError = useCallback(
    (error: unknown, requestedConversationId: string, generation: number) => {
      if (
        conversationIdRef.current !== requestedConversationId ||
        requestGenerationRef.current !== generation
      ) {
        return;
      }

      const { code } = getInconnectMessagingErrorDetails(error);

      setRequestState((current) => ({
        ...current,
        status: 'error',
        candidates: [],
        totalCount: null,
        hasNextPage: false,
        endCursor: null,
        loadingMore: false,
      }));

      if (UNAVAILABLE_ERROR_CODES.has(code ?? '')) {
        onUnavailableRef.current();
      }
    },
    [],
  );

  const submitSearch = useCallback(
    async (search: string) => {
      const normalizedSearch = search.trim();

      if (normalizedSearch.length === 0) {
        requestGenerationRef.current += 1;
        setRequestState(createIdleState(conversationId));
        return;
      }

      const requestedConversationId = conversationId;
      const generation = requestGenerationRef.current + 1;

      requestGenerationRef.current = generation;
      loadingMoreRef.current = false;
      setRequestState({
        conversationId: requestedConversationId,
        submittedSearch: normalizedSearch,
        status: 'loading',
        candidates: [],
        totalCount: null,
        hasNextPage: false,
        endCursor: null,
        loadingMore: false,
        loadMoreFailed: false,
      });

      try {
        const result = await requestCandidates({
          variables: {
            conversationId: requestedConversationId,
            search: normalizedSearch,
            paging: { first: CANDIDATE_PAGE_SIZE },
          },
        });

        if (
          conversationIdRef.current !== requestedConversationId ||
          requestGenerationRef.current !== generation
        ) {
          return;
        }

        if (result.error) {
          handleRequestError(result.error, requestedConversationId, generation);
          return;
        }

        const connection =
          result.data?.inconnectMessagingConversationLinkCandidates;

        if (connection === undefined) {
          handleRequestError(
            new Error('Candidate query returned no data'),
            requestedConversationId,
            generation,
          );
          return;
        }

        setRequestState({
          conversationId: requestedConversationId,
          submittedSearch: normalizedSearch,
          status: 'ready',
          candidates: connection.edges.map(({ node }) => node),
          totalCount: connection.totalCount,
          hasNextPage: connection.pageInfo.hasNextPage === true,
          endCursor: connection.pageInfo.endCursor ?? null,
          loadingMore: false,
          loadMoreFailed: false,
        });
      } catch (error) {
        handleRequestError(error, requestedConversationId, generation);
      }
    },
    [conversationId, handleRequestError, requestCandidates],
  );

  const invalidate = useCallback(() => {
    requestGenerationRef.current += 1;
    loadingMoreRef.current = false;
    setRequestState(createIdleState(conversationId));
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (
      requestState.status !== 'ready' ||
      requestState.submittedSearch === null ||
      !requestState.hasNextPage ||
      requestState.endCursor === null ||
      loadingMoreRef.current
    ) {
      return;
    }

    const requestedConversationId = conversationId;
    const submittedSearch = requestState.submittedSearch;
    const generation = requestGenerationRef.current;

    loadingMoreRef.current = true;
    setRequestState((current) => ({
      ...current,
      loadingMore: true,
      loadMoreFailed: false,
    }));

    try {
      const result = await fetchMore({
        variables: {
          conversationId: requestedConversationId,
          search: submittedSearch,
          paging: {
            first: CANDIDATE_PAGE_SIZE,
            after: requestState.endCursor,
          },
        },
        updateQuery: (_previous, { fetchMoreResult }) => fetchMoreResult,
      });

      if (
        conversationIdRef.current !== requestedConversationId ||
        requestGenerationRef.current !== generation
      ) {
        return;
      }

      const connection =
        result.data?.inconnectMessagingConversationLinkCandidates;

      if (connection === undefined) {
        throw new Error('Candidate pagination returned no data');
      }

      setRequestState((current) => {
        if (
          current.conversationId !== requestedConversationId ||
          current.submittedSearch !== submittedSearch
        ) {
          return current;
        }

        return {
          ...current,
          candidates: [
            ...current.candidates,
            ...connection.edges.map(({ node }) => node),
          ],
          totalCount: connection.totalCount,
          hasNextPage: connection.pageInfo.hasNextPage === true,
          endCursor: connection.pageInfo.endCursor ?? null,
          loadingMore: false,
          loadMoreFailed: false,
        };
      });
    } catch (error) {
      if (
        conversationIdRef.current !== requestedConversationId ||
        requestGenerationRef.current !== generation
      ) {
        return;
      }

      const { code } = getInconnectMessagingErrorDetails(error);

      setRequestState((current) => ({
        ...current,
        loadingMore: false,
        loadMoreFailed: true,
      }));

      if (UNAVAILABLE_ERROR_CODES.has(code ?? '')) {
        onUnavailableRef.current();
      }
    } finally {
      if (
        conversationIdRef.current === requestedConversationId &&
        requestGenerationRef.current === generation
      ) {
        loadingMoreRef.current = false;
      }
    }
  }, [conversationId, fetchMore, requestState]);

  const refresh = useCallback(() => {
    if (requestState.submittedSearch !== null) {
      return submitSearch(requestState.submittedSearch);
    }
  }, [requestState.submittedSearch, submitSearch]);

  const state =
    requestState.conversationId === conversationId
      ? requestState
      : createIdleState(conversationId);

  return {
    ...state,
    submitSearch,
    invalidate,
    loadMore,
    refresh,
  };
};
