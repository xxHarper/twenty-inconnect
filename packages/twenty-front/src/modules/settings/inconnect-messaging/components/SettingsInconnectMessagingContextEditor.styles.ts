import { styled } from '@linaria/react';

import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledFieldList = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
`;

export const StyledAvailableFieldList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

export const StyledFieldRow = styled.li<{ divider: boolean }>`
  align-items: center;
  border-bottom: ${({ divider }) =>
    divider ? `1px solid ${themeCssVariables.border.color.light}` : 'none'};
  box-sizing: border-box;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-height: ${themeCssVariables.spacing[10]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

export const StyledFieldPosition = styled.span`
  color: ${themeCssVariables.font.color.light};
  flex: 0 0 ${themeCssVariables.spacing[5]};
  font-variant-numeric: tabular-nums;
`;

export const StyledFieldDetails = styled.div`
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

export const StyledFieldLabel = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const StyledFieldKind = styled.span`
  color: ${themeCssVariables.font.color.light};
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.sm};
`;

export const StyledFieldActions = styled.div`
  align-items: center;
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[1]};
`;

export const StyledEmptyState = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

export const StyledLimitMessage = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  margin-top: ${themeCssVariables.spacing[2]};
`;
