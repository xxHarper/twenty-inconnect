import { RootStackingContextZIndices } from '@/ui/layout/constants/RootStackingContextZIndices';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledPanel = styled.aside`
  --voice-panel-bottom: ${themeCssVariables.spacing[4]};
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.lg};
  bottom: var(--voice-panel-bottom);
  box-shadow: ${themeCssVariables.boxShadow.strong};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  max-height: calc(
    100dvh - var(--voice-panel-bottom) - ${themeCssVariables.spacing[2]}
  );
  max-width: calc(100% - ${themeCssVariables.spacing[4]} * 2);
  overflow: hidden;
  position: fixed;
  right: ${themeCssVariables.spacing[4]};
  width: 320px;
  z-index: ${RootStackingContextZIndices.VoiceSoftphone};

  &[data-minimized='true'] {
    width: 264px;
  }

  &[data-mobile='true'] {
    --voice-panel-bottom: calc(64px + env(safe-area-inset-bottom));
  }

  @media (max-height: 400px) {
    &[data-mobile='true'] {
      --voice-panel-bottom: max(
        ${themeCssVariables.spacing[2]},
        env(safe-area-inset-bottom)
      );
    }
  }

  @media print {
    display: none;
  }
`;

export const StyledHeader = styled.header`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex: 0 0 auto;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

export const StyledHeaderGroup = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

export const StyledSummary = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: ${themeCssVariables.spacing[4]} ${themeCssVariables.spacing[3]};
  text-align: center;

  &[data-global-idle='true'] {
    flex: 0 0 auto;
    overflow: visible;
    padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  }

  [data-minimized='true'] & {
    align-items: center;
    display: grid;
    gap: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
    grid-template-columns: minmax(0, 1fr) auto;
    padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
    text-align: left;
  }

  @media (max-height: 400px) {
    gap: ${themeCssVariables.spacing[1]};
    padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  }
`;

export const StyledIdentity = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;

  [data-minimized='true'] & {
    align-items: flex-start;
    grid-column: 1;
  }
`;

export const StyledAvatar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.blue};
  border-radius: ${themeCssVariables.border.radius.rounded};
  color: ${themeCssVariables.accent.accent11};
  display: flex;
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  height: ${themeCssVariables.spacing[11]};
  justify-content: center;
  margin-bottom: ${themeCssVariables.spacing[1]};
  width: ${themeCssVariables.spacing[11]};

  @media (max-height: 400px) {
    display: none;
  }
`;

export const StyledName = styled.strong`
  display: block;
  font-size: ${themeCssVariables.font.size.lg};
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:focus-visible {
    border-radius: ${themeCssVariables.border.radius.xs};
    outline: 2px solid ${themeCssVariables.border.color.blue};
  }

  [data-minimized='true'] & {
    font-size: ${themeCssVariables.font.size.md};
  }

  @media (max-height: 400px) {
    font-size: ${themeCssVariables.font.size.md};
  }
`;

export const StyledNumber = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};

  &[data-inbound='true'] {
    font-size: ${themeCssVariables.font.size.md};
    font-variant-numeric: tabular-nums;
  }
`;

export const StyledStatus = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: center;

  &[data-completed='true'] {
    color: ${themeCssVariables.color.green11};
    font-weight: ${themeCssVariables.font.weight.medium};
  }

  > svg {
    flex: 0 0 auto;
  }

  [data-minimized='true'] & {
    grid-column: 1;
    justify-content: flex-start;
  }
`;

export const StyledStatusDot = styled.span`
  background: ${themeCssVariables.font.color.tertiary};
  border-radius: ${themeCssVariables.border.radius.rounded};
  flex: 0 0 auto;
  height: ${themeCssVariables.spacing[1.5]};
  width: ${themeCssVariables.spacing[1.5]};

  &[data-tone='waiting'] {
    background: ${themeCssVariables.color.blue9};
  }

  &[data-tone='connected'] {
    background: ${themeCssVariables.color.green9};
  }

  &[data-tone='warning'] {
    background: ${themeCssVariables.color.orange9};
  }

  &[data-tone='danger'] {
    background: ${themeCssVariables.font.color.danger};
  }
`;

export const StyledTimer = styled.div`
  font-size: ${themeCssVariables.font.size.xxl};
  font-variant-numeric: tabular-nums;
  font-weight: ${themeCssVariables.font.weight.semiBold};

  &[data-completed='true'] {
    font-size: ${themeCssVariables.font.size.xxl};
    line-height: 1.2;
  }

  [data-minimized='true'] & {
    font-size: ${themeCssVariables.font.size.lg};
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  @media (max-height: 400px) {
    font-size: ${themeCssVariables.font.size.lg};
  }
`;

export const StyledTimerLabel = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  display: block;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-bottom: ${themeCssVariables.spacing[1]};
`;

export const StyledDrawer = styled.div`
  background: ${themeCssVariables.background.secondary};
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: ${themeCssVariables.spacing[3]};
`;

export const StyledActions = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: grid;
  flex: 0 0 auto;
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};

  &[data-expanded-call='true'] {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
`;

export const StyledAction = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  font: inherit;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  justify-content: center;
  min-height: 48px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: ${themeCssVariables.spacing[1]};
  text-align: center;

  &:hover:not(:disabled) {
    background: ${themeCssVariables.background.tertiary};
    cursor: pointer;
  }

  &[aria-pressed='true'],
  &[aria-pressed='true']:hover {
    background: ${themeCssVariables.background.transparent.blue};
    border-color: ${themeCssVariables.border.color.blue};
    color: ${themeCssVariables.accent.accent11};
  }

  &.hang-up {
    background: ${themeCssVariables.color.red11};
    border-color: ${themeCssVariables.color.red11};
    color: ${themeCssVariables.background.primary};
  }

  &.hang-up:hover:not(:disabled) {
    background: ${themeCssVariables.color.red12};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.55;
  }

  [data-minimized='true'] & {
    flex-direction: row;
    min-height: 36px;
  }

  @media (max-height: 400px) {
    min-height: 40px;
  }
`;

export const StyledActionLabel = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const StyledIncomingActionIcon = styled.span`
  align-items: center;
  background: ${themeCssVariables.color.red11};
  border-radius: 50%;
  color: ${themeCssVariables.background.primary};
  display: inline-flex;
  height: ${themeCssVariables.spacing[12]};
  justify-content: center;
  width: ${themeCssVariables.spacing[12]};

  &[data-intent='accept'] {
    background: ${themeCssVariables.color.green11};
  }
`;

export const StyledIncomingAction = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font: inherit;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
  overflow-wrap: anywhere;
  padding: ${themeCssVariables.spacing[1]};
  text-align: center;

  &:hover {
    background: ${themeCssVariables.background.secondary};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: -2px;
  }
`;
