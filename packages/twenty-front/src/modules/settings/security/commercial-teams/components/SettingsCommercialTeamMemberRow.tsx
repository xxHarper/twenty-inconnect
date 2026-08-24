import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';

import type { InconnectCommercialTeamSettingsMember } from '@/settings/security/commercial-teams/types/InconnectCommercialTeamSettings';
import { IconAlertTriangle, IconTrash } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledRow = styled.div`
  align-items: center;
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[3]} 0;
`;

const StyledIdentity = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
`;

const StyledName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledDetail = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledWarning = styled(StyledDetail)`
  align-items: center;
  color: ${themeCssVariables.color.orange};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

type SettingsCommercialTeamMemberRowProps = {
  member: InconnectCommercialTeamSettingsMember;
  canMove?: boolean;
  canRemove?: boolean;
  onMove?: () => void;
  onRemove?: () => void;
};

export const SettingsCommercialTeamMemberRow = ({
  member,
  canMove = false,
  canRemove = false,
  onMove,
  onRemove,
}: SettingsCommercialTeamMemberRowProps) => {
  const { t } = useLingui();

  return (
    <StyledRow>
      <StyledIdentity>
        <StyledName>{member.displayName}</StyledName>
        {member.email && <StyledDetail>{member.email}</StyledDetail>}
        {!member.isAssignable && (
          <StyledWarning>
            <IconAlertTriangle size={14} />
            {t`Member is no longer assignable.`}
          </StyledWarning>
        )}
      </StyledIdentity>
      <StyledActions>
        {canMove && member.isAssignable && onMove && (
          <Button
            title={t`Move`}
            variant="secondary"
            size="small"
            onClick={onMove}
          />
        )}
        {canRemove && onRemove && (
          <Button
            title={t`Remove`}
            Icon={IconTrash}
            variant="secondary"
            size="small"
            onClick={onRemove}
          />
        )}
      </StyledActions>
    </StyledRow>
  );
};
