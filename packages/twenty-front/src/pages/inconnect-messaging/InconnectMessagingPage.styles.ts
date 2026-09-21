import { styled } from '@linaria/react';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledPage = styled.main`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`;

export const StyledBody = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
`;

export const StyledList = styled.aside`
  border-right: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  flex: 0 0 min(340px, 38%);
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    flex: 1;
  }
`;

export const StyledListHeader = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

export const StyledFilterScroll = styled.div`
  max-width: 100%;
  overflow-x: auto;
  padding-bottom: ${themeCssVariables.spacing[1]};
`;

export const StyledSearch = styled.input`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font: inherit;
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

export const StyledListScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

export const StyledItem = styled.button<{
  isSelected: boolean;
  isUnread: boolean;
}>`
  background: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.background.transparent.light
      : 'transparent'};
  border: 0;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font: inherit;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
  text-align: left;
  width: 100%;
  &:hover,
  &:focus-visible {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

export const StyledItemTop = styled.span`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  width: 100%;
`;

export const StyledItemState = styled.span`
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: ${themeCssVariables.spacing[1]};
`;

export const StyledItemMetadata = styled.span`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  min-width: 0;
`;

export const StyledAddress = styled.span<{ isUnread: boolean }>`
  font-weight: ${({ isUnread }) => (isUnread ? 700 : 500)};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const StyledUnreadIndicator = styled.span`
  background: ${themeCssVariables.color.blue};
  border-radius: 50%;
  display: inline-block;
  height: 8px;
  width: 8px;
`;

export const StyledSecondary = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

export const StyledCenter = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

export const StyledButton = styled.button`
  background: transparent;
  border: 0;
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  font: inherit;
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;
