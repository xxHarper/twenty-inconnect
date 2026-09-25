import { useLingui } from '@lingui/react/macro';

import {
  StyledCandidateDetails,
  StyledCandidateField,
  StyledCandidateFields,
  StyledCandidateOption,
  StyledContextFieldLabel,
  StyledContextFieldValue,
  StyledRecordLabel,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';
import { type InconnectMessagingConversationLinkCandidate } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationLinkCandidates';

export const InconnectMessagingConversationLinkCandidateFields = ({
  candidate,
}: {
  candidate: InconnectMessagingConversationLinkCandidate;
}) => {
  const { t } = useLingui();

  return (
    <StyledCandidateFields>
      {candidate.fields.map((field) => (
        <StyledCandidateField
          key={field.fieldMetadataId}
          data-value-kind={field.valueKind}
        >
          <StyledContextFieldLabel>{field.label}</StyledContextFieldLabel>
          <StyledContextFieldValue>
            {field.displayValue ?? <span aria-label={t`No value`}>—</span>}
          </StyledContextFieldValue>
        </StyledCandidateField>
      ))}
    </StyledCandidateFields>
  );
};

type InconnectMessagingConversationLinkCandidateOptionProps = {
  candidate: InconnectMessagingConversationLinkCandidate;
  radioGroupName: string;
  selected: boolean;
  onSelect: () => void;
};

export const InconnectMessagingConversationLinkCandidateOption = ({
  candidate,
  radioGroupName,
  selected,
  onSelect,
}: InconnectMessagingConversationLinkCandidateOptionProps) => {
  const { t } = useLingui();

  return (
    <StyledCandidateOption>
      <input
        type="radio"
        name={radioGroupName}
        checked={selected}
        onChange={onSelect}
      />
      <StyledCandidateDetails>
        <StyledRecordLabel>
          {candidate.recordLabel ?? t`Unlabeled record`}
        </StyledRecordLabel>
        <InconnectMessagingConversationLinkCandidateFields
          candidate={candidate}
        />
      </StyledCandidateDetails>
    </StyledCandidateOption>
  );
};
