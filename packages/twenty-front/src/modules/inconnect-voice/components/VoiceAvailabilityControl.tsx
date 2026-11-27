import { type useVoiceInboundRegistration } from '@/inconnect-voice/hooks/useVoiceInboundRegistration';
import { type VoiceInboundPreference } from '@/inconnect-voice/utils/voiceApi';
import { styled } from '@linaria/react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledAvailability = styled.div`
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  min-width: 0;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};
`;

const StyledSelector = styled.label`
  align-items: center;
  display: grid;
  min-width: 0;

  > * {
    grid-area: 1 / 1;
  }
`;

const StyledDot = styled.span`
  background: ${themeCssVariables.font.color.tertiary};
  border-radius: 50%;
  height: 7px;
  margin-left: ${themeCssVariables.spacing[2]};
  pointer-events: none;
  width: 7px;
  z-index: 1;

  &[data-state='available'] {
    background: ${themeCssVariables.color.green9};
  }

  &[data-state='unavailable'],
  &[data-state='busy'],
  &[data-state='ringing'] {
    background: ${themeCssVariables.color.yellow9};
  }
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font: inherit;
  font-size: ${themeCssVariables.font.size.sm};
  max-width: 100%;
  min-width: 0;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]}
    ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[6]};

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: 2px;
  }
`;

const StyledConnection = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  min-width: 0;
  overflow-wrap: anywhere;
`;

const labels = {
  available: msg({ id: 'voice.availability.available', message: 'Available' }),
  unavailable: msg({
    id: 'voice.availability.unavailable',
    message: 'Unavailable',
  }),
  offline: msg({ id: 'voice.availability.offline', message: 'Offline' }),
  busy: msg({ id: 'voice.availability.busy', message: 'Busy' }),
  ringing: msg({ id: 'voice.availability.ringing', message: 'Ringing' }),
};

const manualOptions: VoiceInboundPreference[] = [
  'available',
  'unavailable',
  'offline',
];

export const VoiceAvailabilityControl = ({
  inbound,
}: {
  inbound: ReturnType<typeof useVoiceInboundRegistration>;
}) => {
  const { _ } = useLingui();
  const effective = inbound.effective ?? 'offline';
  const automatic =
    effective === 'busy' ||
    effective === 'ringing' ||
    (effective === 'offline' && inbound.preference !== 'offline');
  const connecting =
    (inbound.state === 'connecting' ||
      inbound.changingPreference === 'available') &&
    effective === 'offline';
  const disconnecting =
    inbound.state === 'disconnecting' ||
    inbound.changingPreference === 'offline';
  const transition = connecting || disconnecting;
  const selection = transition
    ? 'transition'
    : automatic
      ? 'effective'
      : effective;
  const status = disconnecting
    ? _(
        msg({
          id: 'voice.availability.disconnecting',
          message: 'Disconnecting…',
        }),
      )
    : connecting
      ? _(msg({ id: 'voice.availability.connecting', message: 'Connecting…' }))
      : inbound.registered
        ? _(msg({ id: 'voice.availability.connected', message: 'Connected' }))
        : _(
            msg({
              id: 'voice.availability.disconnected',
              message: 'Disconnected',
            }),
          );
  const detail = inbound.registered
    ? _(
        msg({
          id: 'voice.availability.registered',
          message: 'Device registered for incoming calls',
        }),
      )
    : _(
        msg({
          id: 'voice.availability.unregistered',
          message: 'Device not registered for incoming calls',
        }),
      );
  const error = inbound.preferenceError || inbound.state === 'unavailable';

  return (
    <StyledAvailability>
      <StyledSelector>
        <StyledDot
          aria-hidden
          data-state={transition ? 'offline' : effective}
        />
        <StyledSelect
          aria-label={_(
            msg({
              id: 'voice.availability.label',
              message: 'Call availability',
            }),
          )}
          disabled={Boolean(inbound.changingPreference)}
          value={selection}
          onChange={(event) => {
            const choice = manualOptions.find(
              (option) => option === event.target.value,
            );
            if (choice) void inbound.changePreference(choice);
          }}
        >
          {manualOptions.map((option) => (
            <option key={option} value={option}>
              {_(labels[option])}
            </option>
          ))}
          {automatic && (
            <option value="effective" hidden disabled>
              {_(labels[effective])}
            </option>
          )}
          {transition && (
            <option value="transition" hidden disabled>
              {status}
            </option>
          )}
        </StyledSelect>
      </StyledSelector>
      <StyledConnection role="status" title={detail}>
        {error
          ? _(
              msg({
                id: 'voice.availability.error',
                message: 'Could not update reception',
              }),
            )
          : status}
      </StyledConnection>
    </StyledAvailability>
  );
};
