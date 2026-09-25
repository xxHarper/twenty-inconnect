import { useLingui } from '@lingui/react/macro';
import { Button } from 'twenty-ui/input';

import { InconnectMessagingConversationLinkCandidateOption } from '@/inconnect-messaging/components/InconnectMessagingConversationLinkCandidate';
import {
  StyledCandidateCount,
  StyledCandidateList,
  StyledLinkingActions,
  StyledLinkingError,
  StyledLinkingStatus,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';
import type {
  InconnectMessagingConversationLinkCandidate,
  useInconnectMessagingConversationLinkCandidates,
} from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';

type CandidateRequest = ReturnType<
  typeof useInconnectMessagingConversationLinkCandidates
>;

type InconnectMessagingConversationLinkSearchResultsProps = {
  conversationId: string;
  request: CandidateRequest;
  selectedCandidate: InconnectMessagingConversationLinkCandidate | null;
  onSelect: (candidate: InconnectMessagingConversationLinkCandidate) => void;
  onContinue: () => void;
};

export const InconnectMessagingConversationLinkSearchResults = ({
  conversationId,
  request,
  selectedCandidate,
  onSelect,
  onContinue,
}: InconnectMessagingConversationLinkSearchResultsProps) => {
  const { t } = useLingui();

  if (request.status === 'idle') {
    return (
      <StyledLinkingStatus>{t`Enter a search and select Search.`}</StyledLinkingStatus>
    );
  }

  if (request.status === 'loading') {
    return (
      <StyledLinkingStatus role="status">{t`Searching CRM records…`}</StyledLinkingStatus>
    );
  }

  if (request.status === 'error') {
    return (
      <StyledLinkingError role="alert">{t`CRM records could not be loaded. Try again.`}</StyledLinkingError>
    );
  }

  if (request.candidates.length === 0) {
    return (
      <StyledLinkingStatus role="status">{t`No matching records.`}</StyledLinkingStatus>
    );
  }

  return (
    <>
      {request.totalCount !== null && (
        <StyledCandidateCount>{t`${request.totalCount} CRM records found`}</StyledCandidateCount>
      )}
      <StyledCandidateList role="radiogroup" aria-label={t`CRM records`}>
        {request.candidates.map((candidate) => (
          <InconnectMessagingConversationLinkCandidateOption
            key={candidate.recordId}
            candidate={candidate}
            radioGroupName={`inconnect-link-candidate-${conversationId}`}
            selected={selectedCandidate?.recordId === candidate.recordId}
            onSelect={() => onSelect(candidate)}
          />
        ))}
      </StyledCandidateList>
      <StyledLinkingActions>
        {request.hasNextPage && (
          <Button
            type="button"
            title={request.loadingMore ? t`Loading…` : t`Load more`}
            ariaLabel={request.loadingMore ? t`Loading more` : t`Load more`}
            variant="secondary"
            disabled={request.loadingMore}
            isLoading={request.loadingMore}
            onClick={() => void request.loadMore()}
          />
        )}
        <Button
          type="button"
          title={t`Continue`}
          ariaLabel={t`Continue`}
          variant="primary"
          accent="blue"
          disabled={selectedCandidate === null}
          onClick={onContinue}
        />
      </StyledLinkingActions>
      {request.loadMoreFailed && (
        <StyledLinkingError role="alert">{t`More CRM records could not be loaded. Try again.`}</StyledLinkingError>
      )}
    </>
  );
};
