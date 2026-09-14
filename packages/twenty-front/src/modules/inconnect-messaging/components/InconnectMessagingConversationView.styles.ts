import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledView = styled.section`
  background: ${themeCssVariables.background.primary};
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

export const StyledHeader = styled.header`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  min-height: ${themeCssVariables.spacing[12]};
  padding: 0 ${themeCssVariables.spacing[4]};
`;

export const StyledHeading = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const StyledSubtle = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

export const StyledScroll = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  min-height: 0;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[5]};
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

export const StyledDate = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[3]};
  text-align: center;
`;

export const StyledFooter = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

export const StyledButton = styled.button`
  background: transparent;
  border: 0;
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  font: inherit;
  padding: ${themeCssVariables.spacing[2]};
`;
