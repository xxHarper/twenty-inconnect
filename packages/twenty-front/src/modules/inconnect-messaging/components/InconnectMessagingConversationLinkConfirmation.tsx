import { useLingui } from '@lingui/react/macro';
import { Button } from 'twenty-ui/input';

import { InconnectMessagingConversationLinkCandidateFields } from '@/inconnect-messaging/components/InconnectMessagingConversationLinkCandidate';
import {
  StyledConfirmationCard,
  StyledLinkingActions,
  StyledLinkingContent,
  StyledLinkingDescription,
  StyledLinkingError,
  StyledLinkingHeading,
  StyledLinkingStatus,
  StyledRecordLabel,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';
import { type InconnectMessagingConversationLinkCandidate } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';

type InconnectMessagingConversationLinkConfirmationProps = {
  candidate: InconnectMessagingConversationLinkCandidate;
  linking: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
};

export const InconnectMessagingConversationLinkConfirmation = ({
  candidate,
  linking,
  error,
  onBack,
  onConfirm,
}: InconnectMessagingConversationLinkConfirmationProps) => {
  const { t } = useLingui();

  return (
    <StyledLinkingContent>
      <StyledLinkingHeading>{t`Confirm CRM link`}</StyledLinkingHeading>
      <StyledLinkingDescription>{t`This conversation will be linked to this CRM record. The CRM record itself will not be changed.`}</StyledLinkingDescription>
      <StyledConfirmationCard>
        <StyledLinkingStatus>{t`Selected record`}</StyledLinkingStatus>
        <StyledRecordLabel>
          {candidate.recordLabel ?? t`Unlabeled record`}
        </StyledRecordLabel>
        <InconnectMessagingConversationLinkCandidateFields
          candidate={candidate}
        />
      </StyledConfirmationCard>
      <StyledLinkingDescription>{t`Changing or removing this link is not currently available.`}</StyledLinkingDescription>
      {error !== null && (
        <StyledLinkingError role="alert">{error}</StyledLinkingError>
      )}
      <StyledLinkingActions>
        <Button
          type="button"
          title={t`Back`}
          ariaLabel={t`Back`}
          variant="secondary"
          disabled={linking}
          onClick={onBack}
        />
        <Button
          type="button"
          title={linking ? t`Linking…` : t`Link CRM record`}
          ariaLabel={linking ? t`Linking CRM record` : t`Link CRM record`}
          variant="primary"
          accent="blue"
          disabled={linking}
          isLoading={linking}
          onClick={onConfirm}
        />
      </StyledLinkingActions>
    </StyledLinkingContent>
  );
};
