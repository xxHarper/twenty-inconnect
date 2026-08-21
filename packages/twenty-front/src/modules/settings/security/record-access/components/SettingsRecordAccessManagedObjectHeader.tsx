import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';

import { IconChevronDown, IconChevronRight, IconTrash } from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledHeaderButton = styled.button`
  align-items: center;
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[3]} 0 ${themeCssVariables.spacing[3]}
    ${themeCssVariables.spacing[4]};
  text-align: left;
`;

const StyledHeaderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledObjectTitle = styled.div`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledObjectSummary = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

const StyledHeaderActions = styled.div`
  align-items: center;
  display: flex;
  padding: 0 ${themeCssVariables.spacing[3]};
`;

type SettingsRecordAccessManagedObjectHeaderProps = {
  isExpanded: boolean;
  objectLabel: string;
  ownerFieldLabel?: string;
  policyCount: number;
  onToggle: () => void;
  onRequestRemove: () => void;
};

export const SettingsRecordAccessManagedObjectHeader = ({
  isExpanded,
  objectLabel,
  ownerFieldLabel,
  policyCount,
  onToggle,
  onRequestRemove,
}: SettingsRecordAccessManagedObjectHeaderProps) => {
  const { t } = useLingui();

  return (
    <StyledHeader>
      <StyledHeaderButton
        type="button"
        aria-expanded={isExpanded}
        aria-label={
          isExpanded ? t`Collapse ${objectLabel}` : t`Expand ${objectLabel}`
        }
        onClick={onToggle}
      >
        <StyledHeaderText>
          <StyledObjectTitle>{objectLabel}</StyledObjectTitle>
          <StyledObjectSummary>
            {t`Role policies`} ({policyCount})
            {ownerFieldLabel ? ` / ${ownerFieldLabel}` : ''}
          </StyledObjectSummary>
        </StyledHeaderText>
        {isExpanded ? (
          <IconChevronDown size={16} />
        ) : (
          <IconChevronRight size={16} />
        )}
      </StyledHeaderButton>
      <StyledHeaderActions>
        <LightIconButton
          Icon={IconTrash}
          accent="tertiary"
          onClick={onRequestRemove}
          aria-label={t`Remove managed object`}
        />
      </StyledHeaderActions>
    </StyledHeader>
  );
};
