import { type VoiceAudio } from '@/inconnect-voice/utils/createVoiceAudio';
import {
  DEFAULT_DEVICE,
  type VoiceAudioKind,
  type VoiceAudioSettings as AudioSettings,
} from '@/inconnect-voice/utils/voiceAudioPreferences';
import { InputHint } from '@/ui/input/components/InputHint';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { IconHeadphones, useIcons } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledField = styled.label`
  display: grid;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
`;

const StyledLabel = styled.span`
  align-items: center;
  display: flex;
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font: inherit;
  min-width: 0;
  padding: ${themeCssVariables.spacing[2]};
  text-overflow: ellipsis;
  width: 100%;

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: 1px;
  }
`;

type VoiceAudioSettingsProps = {
  settings: AudioSettings;
  busy: boolean;
  canSwitch: boolean;
  onSelect: VoiceAudio['select'];
  onRequestAccess: VoiceAudio['checkMicrophone'];
};

export const VoiceAudioSettings = ({
  settings,
  busy,
  canSwitch,
  onSelect,
  onRequestAccess,
}: VoiceAudioSettingsProps) => {
  const { t } = useLingui();
  const { getIcon } = useIcons();
  const MicrophoneIcon = getIcon('IconMicrophone');
  const systemDefault = t`System default`;
  const issueLabels = {
    denied: t`The browser denied access to this audio device. Check the site permissions.`,
    unavailable: t`The audio device is unavailable.`,
    unsupported: t`This browser uses the system default for this control.`,
    failed: t`The audio device could not be activated.`,
    fallback: t`Audio switched to an available device.`,
    lost: t`The selected device was disconnected. Select an available device if audio does not return.`,
  };
  const permission = settings.microphoneAccess;
  const accessLabel =
    permission === 'checking'
      ? t`Waiting for microphone access…`
      : permission === 'unconfirmed'
        ? t`Allow microphone access to see available devices.`
        : permission === 'granted'
          ? null
          : issueLabels[permission];

  const kinds: VoiceAudioKind[] = ['input', 'output'];

  return (
    <>
      {!busy && settings.supported.input && accessLabel && (
        <>
          <InputHint role="status">{accessLabel}</InputHint>
          <Button
            size="small"
            type="button"
            variant="secondary"
            title={t`Allow microphone access`}
            ariaLabel={t`Allow microphone access`}
            disabled={permission === 'checking'}
            onClick={() => void onRequestAccess().catch(() => undefined)}
          />
        </>
      )}
      {kinds.map((kind) => {
        const devices = settings.devices[kind];
        const issue = settings.issues[kind];
        const supported = settings.supported[kind];
        const selected = !supported
          ? DEFAULT_DEVICE
          : busy
            ? settings.effective[kind]
            : settings.preferences[kind];
        const label = kind === 'input' ? t`Microphone` : t`Audio output`;
        const Icon = kind === 'input' ? MicrophoneIcon : IconHeadphones;
        const selectionIsListed =
          selected === DEFAULT_DEVICE ||
          devices.some((entry) => entry.deviceId === selected);

        return (
          <StyledField key={kind}>
            <StyledLabel>
              <Icon size={themeCssVariables.icon.size.md} aria-hidden />
              {label}
            </StyledLabel>
            <StyledSelect
              aria-label={label}
              value={selectionIsListed ? (selected ?? '') : ''}
              disabled={
                !supported || settings.pending[kind] || (busy && !canSwitch)
              }
              onChange={(event) =>
                void onSelect(kind, event.currentTarget.value)
              }
            >
              {!selectionIsListed && (
                <option value="" disabled>
                  {busy
                    ? t`Current device unavailable`
                    : t`Saved device unavailable`}
                </option>
              )}
              <option value={DEFAULT_DEVICE}>{systemDefault}</option>
              {devices
                .filter((entry) => entry.deviceId !== DEFAULT_DEVICE)
                .map((entry, index) => (
                  <option key={entry.deviceId} value={entry.deviceId}>
                    {entry.label || t`Audio device ${index + 1}`}
                  </option>
                ))}
            </StyledSelect>
            {!supported && <InputHint>{issueLabels.unsupported}</InputHint>}
            {supported && settings.pending[kind] && (
              <InputHint role="status">{t`Switching audio device…`}</InputHint>
            )}
            {supported && issue && !settings.pending[kind] && (
              <InputHint role="status">{issueLabels[issue]}</InputHint>
            )}
          </StyledField>
        );
      })}
      {!busy && <InputHint>{t`Selections apply to the next call.`}</InputHint>}
    </>
  );
};
