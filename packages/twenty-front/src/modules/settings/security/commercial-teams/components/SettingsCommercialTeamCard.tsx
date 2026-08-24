import { styled } from '@linaria/react';
import { plural } from '@lingui/core/macro';
import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { SettingsCommercialTeamMemberRow } from '@/settings/security/commercial-teams/components/SettingsCommercialTeamMemberRow';
import type {
  InconnectCommercialTeamSettingsMember,
  InconnectCommercialTeamSettingsTeam,
} from '@/settings/security/commercial-teams/types/InconnectCommercialTeamSettings';
import {
  IconChevronDown,
  IconChevronRight,
  IconPencil,
  IconPlus,
  IconTrash,
} from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledHeaderButton = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  flex: 1;
  justify-content: space-between;
  min-width: 0;
  padding: 0;
  text-align: left;
`;

const StyledHeaderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledTitle = styled.div`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledSummary = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledHeaderActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledContent = styled(CardContent)`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[4]};
`;

const StyledSection = styled.div`
  display: flex;
  flex-direction: column;
`;

const StyledSectionHeader = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-bottom: ${themeCssVariables.spacing[1]};
`;

const StyledEmpty = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[2]} 0;
`;

const StyledSectionAction = styled.div`
  margin-top: ${themeCssVariables.spacing[2]};
`;

type SettingsCommercialTeamCardProps = {
  team: InconnectCommercialTeamSettingsTeam;
  onRename: () => void;
  onDelete: () => void;
  onAssignCoordinator: () => void;
  onAddExecutive: () => void;
  onMoveExecutive: (member: InconnectCommercialTeamSettingsMember) => void;
  onRemoveExecutive: (member: InconnectCommercialTeamSettingsMember) => void;
};

export const SettingsCommercialTeamCard = ({
  team,
  onRename,
  onDelete,
  onAssignCoordinator,
  onAddExecutive,
  onMoveExecutive,
  onRemoveExecutive,
}: SettingsCommercialTeamCardProps) => {
  const { t } = useLingui();
  const [isExpanded, setIsExpanded] = useState(true);
  const coordinatorCount = team.coordinator ? 1 : 0;
  const coordinatorSummary = plural(coordinatorCount, {
    one: '# coordinator',
    other: '# coordinators',
  });
  const executiveSummary = plural(team.executives.length, {
    one: '# executive',
    other: '# executives',
  });

  return (
    <Card rounded fullWidth>
      <StyledHeader>
        <StyledHeaderButton
          type="button"
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? t`Collapse ${team.name}` : t`Expand ${team.name}`
          }
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
        >
          <StyledHeaderText>
            <StyledTitle>{team.name}</StyledTitle>
            <StyledSummary>
              {coordinatorSummary} / {executiveSummary}
            </StyledSummary>
          </StyledHeaderText>
          {isExpanded ? (
            <IconChevronDown size={16} />
          ) : (
            <IconChevronRight size={16} />
          )}
        </StyledHeaderButton>
        <StyledHeaderActions>
          <Button
            title={t`Rename`}
            Icon={IconPencil}
            variant="secondary"
            size="small"
            onClick={onRename}
          />
          <Button
            title={t`Delete`}
            Icon={IconTrash}
            variant="secondary"
            size="small"
            onClick={onDelete}
          />
        </StyledHeaderActions>
      </StyledHeader>

      <AnimatedExpandableContainer
        isExpanded={isExpanded}
        dimension="height"
        mode="scroll-height"
      >
        <StyledContent>
          <StyledSection>
            <StyledSectionHeader>{t`Coordinator`}</StyledSectionHeader>
            {team.coordinator ? (
              <SettingsCommercialTeamMemberRow member={team.coordinator} />
            ) : (
              <StyledEmpty>{t`No coordinator assigned`}</StyledEmpty>
            )}
            <StyledSectionAction>
              <Button
                title={
                  team.coordinator
                    ? t`Change coordinator`
                    : t`Assign coordinator`
                }
                variant="secondary"
                size="small"
                onClick={onAssignCoordinator}
              />
            </StyledSectionAction>
          </StyledSection>

          <StyledSection>
            <StyledSectionHeader>
              {t`Executives`} ({team.executives.length})
            </StyledSectionHeader>
            {team.executives.length === 0 ? (
              <StyledEmpty>{t`No executives assigned`}</StyledEmpty>
            ) : (
              team.executives.map((member) => (
                <SettingsCommercialTeamMemberRow
                  key={member.membershipId}
                  member={member}
                  canMove
                  canRemove
                  onMove={() => onMoveExecutive(member)}
                  onRemove={() => onRemoveExecutive(member)}
                />
              ))
            )}
            <StyledSectionAction>
              <Button
                title={t`Add executive`}
                Icon={IconPlus}
                variant="secondary"
                size="small"
                onClick={onAddExecutive}
              />
            </StyledSectionAction>
          </StyledSection>
        </StyledContent>
      </AnimatedExpandableContainer>
    </Card>
  );
};
