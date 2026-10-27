import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledPoolPage = styled.main`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: auto;
`;
export const StyledPoolContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
`;
export const StyledPoolSection = styled.section`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  padding: 16px;
  h2 {
    font-size: 16px;
    margin-top: 0;
  }
  p {
    line-height: 1.5;
  }
`;
export const StyledPoolControls = styled.div`
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  input,
  select,
  button {
    background: ${themeCssVariables.background.secondary};
    border: 1px solid ${themeCssVariables.border.color.medium};
    border-radius: ${themeCssVariables.border.radius.sm};
    color: inherit;
    font: inherit;
    min-height: 32px;
    padding: 4px 10px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;
export const StyledPoolTableScroll = styled.div`
  margin: 16px 0;
  max-height: 440px;
  overflow: auto;
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    border-bottom: 1px solid ${themeCssVariables.border.color.light};
    padding: 10px;
    text-align: left;
  }
  th {
    background: ${themeCssVariables.background.secondary};
    position: sticky;
    top: 0;
  }
  input {
    accent-color: ${themeCssVariables.font.color.primary};
  }
`;
export const StyledPoolNotice = styled.p`
  background: ${themeCssVariables.background.secondary};
  border-radius: ${themeCssVariables.border.radius.sm};
  margin: 0;
  overflow-wrap: anywhere;
  padding: 12px;
`;
