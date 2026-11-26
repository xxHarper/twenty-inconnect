import { InputHint } from '@/ui/input/components/InputHint';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledKeypad = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  grid-template-columns: repeat(3, minmax(0, 1fr));

  &[data-dial='true'] {
    gap: ${themeCssVariables.spacing[1.5]};
  }
`;

const StyledKey = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  display: grid;
  font: inherit;
  grid-template-rows: 1fr 1em;
  justify-items: center;
  min-height: 50px;
  min-width: 0;
  padding: ${themeCssVariables.spacing[1]};

  [data-dial='true'] & {
    min-height: 42px;
  }

  &:hover:not(:disabled) {
    background: ${themeCssVariables.background.tertiary};
    cursor: pointer;
  }

  &:active:not(:disabled) {
    background: ${themeCssVariables.background.transparent.blue};
    border-color: ${themeCssVariables.border.color.blue};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.55;
  }
`;

const StyledDigit = styled.span`
  font-size: ${themeCssVariables.font.size.xl};
  font-variant-numeric: tabular-nums;
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledLetters = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xxs};
  letter-spacing: 0.08em;
`;

const keys = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', ''],
  ['#', ''],
] as const;

type VoiceKeypadProps =
  | {
      mode?: 'dtmf';
      enabled: boolean;
      onDigit: (digit: string) => 'unavailable' | 'failed' | 'sent';
    }
  | {
      mode: 'dial';
      enabled: boolean;
      onDigit: (digit: string) => void;
    };

export const VoiceKeypad = (props: VoiceKeypadProps) => {
  const { t } = useLingui();
  const { enabled } = props;
  const isDial = props.mode === 'dial';
  const [failed, setFailed] = useState(false);

  return (
    <>
      <StyledKeypad
        role="group"
        aria-label={t`Phone keypad`}
        data-dial={isDial}
      >
        {keys.map(([tone, letters]) => {
          const digit =
            isDial && tone === '*' ? '+' : isDial && tone === '#' ? '⌫' : tone;
          return (
            <StyledKey
              key={digit}
              type="button"
              aria-label={
                digit === '*'
                  ? t`Star`
                  : digit === '#'
                    ? t`Pound`
                    : digit === '⌫'
                      ? t`Delete last digit`
                      : digit
              }
              disabled={!enabled}
              onClick={() => {
                if (props.mode === 'dial') props.onDigit(digit);
                else setFailed(props.onDigit(digit) === 'failed');
              }}
            >
              <StyledDigit>{digit}</StyledDigit>
              <StyledLetters aria-hidden>{letters}</StyledLetters>
            </StyledKey>
          );
        })}
      </StyledKeypad>
      {!isDial && !enabled && (
        <InputHint>{t`The keypad is available when the destination is connected.`}</InputHint>
      )}
      {!isDial && failed && enabled && (
        <InputHint
          danger
          role="status"
        >{t`The tone could not be sent. Try again.`}</InputHint>
      )}
    </>
  );
};
