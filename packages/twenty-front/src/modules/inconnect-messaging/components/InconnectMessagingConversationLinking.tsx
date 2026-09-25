import { useLingui } from '@lingui/react/macro';
import { useMutation } from '@apollo/client/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from 'twenty-ui/input';

import { InconnectMessagingConversationLinkConfirmation } from '@/inconnect-messaging/components/InconnectMessagingConversationLinkConfirmation';
import { InconnectMessagingConversationLinkSearchResults } from '@/inconnect-messaging/components/InconnectMessagingConversationLinkSearchResults';
import {
  StyledLinkingActions,
  StyledLinkingContent,
  StyledLinkingDescription,
  StyledLinkingError,
  StyledLinkingForm,
  StyledLinkingHeading,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';
import {
  type InconnectMessagingConversationLinkCandidate,
  useInconnectMessagingConversationLinkCandidates,
} from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';
import { getInconnectMessagingErrorDetails } from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import { TextInput } from '@/ui/input/components/TextInput';
import {
  LinkInconnectMessagingConversationDocument,
  type LinkInconnectMessagingConversationMutation,
  type LinkInconnectMessagingConversationMutationVariables,
} from '~/generated-metadata/graphql';

type InconnectMessagingConversationLinkingProps = {
  conversationId: string;
  onCancel: () => void;
  onLinked: () => void;
  onAlreadyLinked: () => void;
  onUnavailable: () => void;
};

type LinkingMode = 'SEARCH' | 'CONFIRM' | 'LINKING';

export const InconnectMessagingConversationLinking = ({
  conversationId,
  onCancel,
  onLinked,
  onAlreadyLinked,
  onUnavailable,
}: InconnectMessagingConversationLinkingProps) => {
  const { t } = useLingui();
  const [linkConversation] = useMutation<
    LinkInconnectMessagingConversationMutation,
    LinkInconnectMessagingConversationMutationVariables
  >(LinkInconnectMessagingConversationDocument);
  const [mode, setMode] = useState<LinkingMode>('SEARCH');
  const [searchDraft, setSearchDraft] = useState('');
  const [selectedCandidate, setSelectedCandidate] =
    useState<InconnectMessagingConversationLinkCandidate | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Async mutation results need synchronous identity and lifecycle guards.
  // oxlint-disable-next-line twenty/no-state-useref
  const activeConversationIdRef = useRef(conversationId);
  // oxlint-disable-next-line twenty/no-state-useref
  const mountedRef = useRef(true);
  // oxlint-disable-next-line twenty/no-state-useref
  const linkInFlightRef = useRef(false);
  const candidateRequest = useInconnectMessagingConversationLinkCandidates({
    conversationId,
    onUnavailable,
  });

  activeConversationIdRef.current = conversationId;

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleSearchDraftChange = (nextDraft: string) => {
    setSearchDraft(nextDraft);
    setLinkError(null);

    if (
      candidateRequest.submittedSearch !== null &&
      nextDraft.trim() !== candidateRequest.submittedSearch
    ) {
      setSelectedCandidate(null);
      candidateRequest.invalidate();
    }
  };

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      searchDraft.trim().length === 0 ||
      candidateRequest.status === 'loading'
    ) {
      return;
    }

    setSelectedCandidate(null);
    setLinkError(null);
    void candidateRequest.submitSearch(searchDraft);
  };

  const handleConfirm = async () => {
    if (
      selectedCandidate === null ||
      linkInFlightRef.current ||
      mode === 'LINKING'
    ) {
      return;
    }

    const requestedConversationId = conversationId;
    const requestedRecordId = selectedCandidate.recordId;

    linkInFlightRef.current = true;
    setMode('LINKING');
    setLinkError(null);

    try {
      const result = await linkConversation({
        variables: {
          conversationId: requestedConversationId,
          recordId: requestedRecordId,
        },
      });

      if (
        !mountedRef.current ||
        activeConversationIdRef.current !== requestedConversationId
      ) {
        return;
      }

      if (result.error) {
        throw result.error;
      }

      if (result.data?.linkInconnectMessagingConversation == null) {
        onUnavailable();
        return;
      }

      candidateRequest.invalidate();
      setSelectedCandidate(null);
      setSearchDraft('');
      onLinked();
    } catch (error) {
      if (
        !mountedRef.current ||
        activeConversationIdRef.current !== requestedConversationId
      ) {
        return;
      }

      const { code, message } = getInconnectMessagingErrorDetails(error);

      if (code === 'CONFLICT' && message === 'CONVERSATION_ALREADY_LINKED') {
        candidateRequest.invalidate();
        setSelectedCandidate(null);
        setSearchDraft('');
        onAlreadyLinked();
        return;
      }

      if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') {
        candidateRequest.invalidate();
        setSelectedCandidate(null);
        onUnavailable();
        return;
      }

      if (code === 'NOT_FOUND') {
        setMode('SEARCH');
        setSelectedCandidate(null);
        setLinkError(t`The record is no longer available. Search again.`);
        void candidateRequest.refresh();
        return;
      }

      setMode('CONFIRM');
      setLinkError(t`The CRM record could not be linked. Try again.`);
    } finally {
      linkInFlightRef.current = false;
    }
  };

  if (mode === 'CONFIRM' || mode === 'LINKING') {
    if (selectedCandidate === null) {
      return null;
    }

    return (
      <InconnectMessagingConversationLinkConfirmation
        candidate={selectedCandidate}
        linking={mode === 'LINKING'}
        error={linkError}
        onBack={() => {
          setLinkError(null);
          setMode('SEARCH');
        }}
        onConfirm={() => void handleConfirm()}
      />
    );
  }

  return (
    <StyledLinkingContent>
      <StyledLinkingHeading>{t`Search CRM records`}</StyledLinkingHeading>
      <StyledLinkingDescription>{t`Search for the CRM record you want to link to this conversation.`}</StyledLinkingDescription>
      <StyledLinkingForm onSubmit={handleSearch}>
        <TextInput
          autoFocus
          fullWidth
          label={t`CRM record search`}
          type="search"
          value={searchDraft}
          disabled={candidateRequest.status === 'loading'}
          onChange={handleSearchDraftChange}
        />
        <StyledLinkingActions>
          <Button
            type="button"
            title={t`Cancel`}
            ariaLabel={t`Cancel`}
            variant="secondary"
            onClick={onCancel}
          />
          <Button
            type="submit"
            title={t`Search`}
            ariaLabel={t`Search`}
            variant="primary"
            accent="blue"
            disabled={
              searchDraft.trim().length === 0 ||
              candidateRequest.status === 'loading'
            }
            isLoading={candidateRequest.status === 'loading'}
          />
        </StyledLinkingActions>
      </StyledLinkingForm>

      {linkError !== null && (
        <StyledLinkingError role="alert">{linkError}</StyledLinkingError>
      )}
      <InconnectMessagingConversationLinkSearchResults
        conversationId={conversationId}
        request={candidateRequest}
        selectedCandidate={selectedCandidate}
        onSelect={(candidate) => {
          setLinkError(null);
          setSelectedCandidate(candidate);
        }}
        onContinue={() => {
          setLinkError(null);
          setMode('CONFIRM');
        }}
      />
    </StyledLinkingContent>
  );
};
