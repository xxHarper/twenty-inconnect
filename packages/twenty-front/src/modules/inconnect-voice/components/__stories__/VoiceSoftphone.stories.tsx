import { VoiceSoftphoneView } from '@/inconnect-voice/components/VoiceSoftphoneView';
import { type VoiceAudioSettings } from '@/inconnect-voice/utils/voiceAudioPreferences';
import { styled } from '@linaria/react';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';
import { IconsProvider } from 'twenty-ui/icon';
import { ThemeProvider, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledSurface = styled.div`
  background: ${themeCssVariables.background.secondary};
  color: ${themeCssVariables.font.color.primary};
  font-family: ${themeCssVariables.font.family};
  min-height: 100dvh;
`;

const microphone: MediaDeviceInfo = {
  deviceId: 'fixture-microphone',
  groupId: 'fixture',
  kind: 'audioinput',
  label: 'USB microphone with a long manufacturer and device name',
  toJSON: () => ({}),
};

const output: MediaDeviceInfo = {
  deviceId: 'fixture-headphones',
  groupId: 'fixture',
  kind: 'audiooutput',
  label: 'Bluetooth headphones with a long manufacturer and device name',
  toJSON: () => ({}),
};

const audioSettings: VoiceAudioSettings = {
  preferences: { input: microphone.deviceId, output: output.deviceId },
  effective: { input: microphone.deviceId, output: output.deviceId },
  devices: { input: [microphone], output: [output] },
  supported: { input: true, output: true },
  pending: { input: false, output: false },
  microphoneAccess: 'granted',
  issues: { output: 'fallback' },
};

type PreviewProps = {
  colorScheme: 'light' | 'dark';
  initialMinimized?: boolean;
  initialState: 'idle' | 'active' | 'reconnecting' | 'error';
};

const Preview = ({
  colorScheme,
  initialMinimized = false,
  initialState,
}: PreviewProps) => {
  const [minimized, setMinimized] = useState(initialMinimized);
  const [state, setState] = useState(initialState);
  const [muted, setMuted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [settings, setSettings] = useState(audioSettings);
  const [connectedAt, setConnectedAt] = useState(
    () => performance.now() - 83_000,
  );
  const busy = state === 'active' || state === 'reconnecting';
  const call = {
    idle: { status: 'Available', tone: 'neutral' },
    active: { status: 'Destination answered', tone: 'connected' },
    reconnecting: { status: 'Reconnecting…', tone: 'warning' },
    error: { status: 'Voice could not complete the call.', tone: 'danger' },
  } as const;

  return (
    <ThemeProvider colorScheme={colorScheme}>
      <IconsProvider>
        <StyledSurface>
          {visible && (
            <VoiceSoftphoneView
              status={call[state].status}
              tone={call[state].tone}
              minimized={minimized}
              mobile={false}
              busy={busy}
              ending={false}
              muted={muted}
              canMute={busy}
              canSwitchAudio={state === 'active'}
              canSendDigit={state === 'active'}
              callId={busy ? 'fixture-call' : undefined}
              lead={{
                name: 'María Elena Fernández de la Vega y Martínez de la Cruz',
                number: '+12025550123',
              }}
              timer={busy ? { connectedAt, endedAt: null } : undefined}
              awaitingConnectedTime={false}
              audioSettings={settings}
              onToggleMinimized={() => setMinimized((current) => !current)}
              onClose={() => setVisible(false)}
              onToggleMute={() => setMuted((current) => !current)}
              onHangUp={() => setState('idle')}
              onDial={() => {
                setConnectedAt(performance.now());
                setState('active');
              }}
              onDigit={() => 'sent'}
              onSelectAudioDevice={async (kind, id) => {
                setSettings((current) => ({
                  ...current,
                  preferences: { ...current.preferences, [kind]: id },
                  effective: { ...current.effective, [kind]: id },
                }));
              }}
              onRequestMicrophoneAccess={async () => undefined}
            />
          )}
        </StyledSurface>
      </IconsProvider>
    </ThemeProvider>
  );
};

const meta = {
  title: 'Modules/Voice/Softphone',
  component: Preview,
  parameters: { layout: 'fullscreen' },
  args: { initialState: 'active', colorScheme: 'light' },
} satisfies Meta<typeof Preview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Keypad: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Keypad' }),
    );
  },
};

export const Audio: Story = {
  args: { colorScheme: 'dark' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Audio' }),
    );
  },
};

export const Minimized: Story = {
  args: { initialMinimized: true, colorScheme: 'dark' },
};

export const Reconnecting: Story = {
  args: { initialState: 'reconnecting' },
};

export const Error: Story = {
  args: { initialState: 'error' },
};
