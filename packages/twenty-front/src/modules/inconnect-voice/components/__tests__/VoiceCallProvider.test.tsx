import { isCookieAuthActiveState } from '@/auth/states/isCookieAuthActiveState';
import {
  type CurrentUser,
  currentUserState,
} from '@/auth/states/currentUserState';
import { currentUserWorkspaceState } from '@/auth/states/currentUserWorkspaceState';
import {
  type CurrentWorkspaceMember,
  currentWorkspaceMemberState,
} from '@/auth/states/currentWorkspaceMemberState';
import {
  type CurrentWorkspace,
  currentWorkspaceState,
} from '@/auth/states/currentWorkspaceState';
import { VoiceCallProvider } from '@/inconnect-voice/components/VoiceCallProvider';
import { VoiceCallContext } from '@/inconnect-voice/contexts/VoiceCallContext';
import { useVoiceLeadDetails } from '@/inconnect-voice/hooks/useVoiceLeadDetails';
import {
  createVoiceSession,
  getVoiceCallProgress,
  getVoiceStatus,
} from '@/inconnect-voice/utils/voiceApi';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Device, Logger } from '@twilio/voice-sdk';
import { EventEmitter } from 'events';
import { createStore, Provider } from 'jotai';
import { useContext } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

jest.mock('@/inconnect-voice/hooks/useVoiceLeadDetails', () => ({
  useVoiceLeadDetails: jest.fn(),
}));
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue',
  () => ({
    useAtomFamilySelectorValue: () => ({ id: 'lead-object' }),
  }),
);
jest.mock('@/inconnect-voice/utils/voiceApi', () => ({
  createVoiceSession: jest.fn(),
  getVoiceCallProgress: jest.fn(),
  getVoiceStatus: jest.fn(),
  VoiceApiError: Error,
}));
jest.mock('@twilio/voice-sdk', () => ({
  Call: {
    State: {
      Closed: 'closed',
      Open: 'open',
      Ringing: 'ringing',
      Reconnecting: 'reconnecting',
    },
  },
  Device: jest.fn(),
  Logger: { setLevel: jest.fn() },
}));

const destination = '+12015550123';
const originalLead = '00000000-0000-4000-8000-000000000001';
const anotherLead = '00000000-0000-4000-8000-000000000002';

const Lead = ({ recordId }: { recordId: string }) => {
  const open = useContext(VoiceCallContext);
  return (
    <button
      onClick={() =>
        open?.({
          objectMetadataId: 'lead-object',
          objectNameSingular: 'lead',
          recordId,
        })
      }
    >
      Call lead
    </button>
  );
};

const makeCall = () => {
  const events = new EventEmitter();
  let muted = false;
  let status = 'connecting';
  return Object.assign(events, {
    status: () => status,
    sendDigits: jest.fn(),
    setStatus: (next: string) => {
      status = next;
    },
    isMuted: () => muted,
    mute: jest.fn((value: boolean) => {
      muted = value;
      events.emit('mute', muted);
    }),
    disconnect: jest.fn(() => events.emit('disconnect')),
  });
};

describe('VoiceCallProvider', () => {
  const mediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  );

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] }),
      },
    });
    jest.mocked(getVoiceStatus).mockResolvedValue('ready');
    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'reserved',
        result: null,
        answeredAt: null,
        endedAt: null,
        durationSeconds: null,
        observedAt: Date.now(),
      }));
    jest.mocked(createVoiceSession).mockImplementation(async (recordId) => ({
      token: `token-for-${recordId}`,
      destination,
      intentId: recordId === originalLead ? anotherLead : originalLead,
      intentExpiresAt: Date.now() + 45_000,
    }));
    jest
      .mocked(useVoiceLeadDetails)
      .mockImplementation((_object, recordId) => ({
        status: 'valid',
        number: destination,
        name: recordId === originalLead ? 'Original lead' : 'Another lead',
      }));
  });

  afterEach(() => {
    localStorage.clear();
    if (mediaDevices)
      Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    jest.useRealTimers();
  });

  const setup = () => {
    const first = makeCall();
    const second = makeCall();
    const device = Object.assign(new EventEmitter(), {
      connect: jest
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      destroy: jest.fn(),
      updateToken: jest.fn(),
    });
    jest.mocked(Device).mockImplementation(() => device as unknown as Device);

    const store = createStore();
    store.set(isCookieAuthActiveState.atom, true);
    store.set(currentWorkspaceState.atom, {
      id: 'workspace-a',
    } as CurrentWorkspace);
    store.set(currentUserState.atom, { id: 'user-a' } as CurrentUser);
    store.set(currentWorkspaceMemberState.atom, {
      id: 'member-a',
    } as CurrentWorkspaceMember);
    store.set(currentUserWorkspaceState.atom, {
      permissionFlags: [],
      objectsPermissions: [],
      isImpersonating: false,
    });

    const app = (
      <Provider store={store}>
        <I18nProvider i18n={i18n}>
          <MemoryRouter
            initialEntries={['/lead']}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <VoiceCallProvider>
              <nav>
                <Link to="/leads">Leads</Link>
                <Link to="/other">Other lead</Link>
                <Link to="/messages">Messaging</Link>
              </nav>
              <Routes>
                <Route
                  path="/lead"
                  element={<Lead recordId={originalLead} />}
                />
                <Route path="/leads" element={<h1>Lead list</h1>} />
                <Route
                  path="/other"
                  element={<Lead recordId={anotherLead} />}
                />
                <Route path="/messages" element={<h1>Inbox</h1>} />
              </Routes>
            </VoiceCallProvider>
          </MemoryRouter>
        </I18nProvider>
      </Provider>
    );
    const view = render(app);
    return { first, second, device, store, view };
  };

  const openPhone = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Call lead' }));
    const getDialButton = () =>
      screen.getByRole('button', { name: 'Place call' });
    await waitFor(() => expect(getDialButton()).toBeEnabled());
    return getDialButton();
  };

  it('requires destination evidence for the timer, keeps it across routes and reuses the device', async () => {
    jest.useFakeTimers();
    const { first, second, device, view } = setup();
    const dialButton = await openPhone();
    expect(Device).not.toHaveBeenCalled();
    expect(screen.getByText('Original lead')).toBeVisible();
    await act(async () => {
      fireEvent.click(dialButton);
      fireEvent.click(dialButton);
    });
    expect(createVoiceSession).toHaveBeenCalledTimes(1);
    expect(device.connect).toHaveBeenCalledWith({
      params: { intentId: anotherLead },
    });
    act(() => {
      first.emit('ringing');
    });
    expect(screen.getByText('Waiting for destination…')).toBeVisible();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    act(() => {
      first.emit('accept');
    });
    expect(screen.getByText('Browser connected to Twilio')).toBeVisible();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'ringing',
        result: null,
        answeredAt: null,
        endedAt: null,
        durationSeconds: null,
        observedAt: Date.now(),
      }));
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(screen.getByText('Destination ringing…')).toBeVisible();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    const answeredAt = new Date(Date.now() + 2_000).toISOString();
    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'answered',
        result: null,
        answeredAt,
        endedAt: null,
        durationSeconds: null,
        observedAt: Date.now(),
      }));
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(screen.getByText('Destination answered')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Minimize softphone' }));
    expect(screen.getByText('Original lead')).toBeVisible();
    const compactControls = within(
      screen.getByRole('group', { name: 'Call controls' }),
    );
    expect(compactControls.getAllByRole('button')).toEqual([
      compactControls.getByRole('button', { name: 'Mute' }),
      compactControls.getByRole('button', { name: 'Hang up' }),
    ]);
    fireEvent.click(screen.getByRole('link', { name: 'Leads' }));
    await screen.findByRole('heading', { name: 'Lead list' });
    fireEvent.click(screen.getByRole('link', { name: 'Other lead' }));
    await openPhoneDuringCall();
    expect(screen.getByText('Original lead')).toBeVisible();
    expect(screen.queryByText('Another lead')).not.toBeInTheDocument();
    expect(createVoiceSession).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('link', { name: 'Messaging' }));
    await screen.findByRole('heading', { name: 'Inbox' });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize softphone' }));
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(screen.getByRole('timer')).toHaveTextContent('00:03');
    act(() => {
      first.emit('reconnecting');
    });
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    act(() => {
      first.emit('reconnected');
    });
    expect(screen.getByRole('timer')).toHaveTextContent('00:03');
    fireEvent.click(screen.getByRole('button', { name: /^Mute$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Unmute$/ }));
    expect(first.mute.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(screen.getByRole('button', { name: 'Expand softphone' }));
    first.disconnect.mockImplementationOnce(() => true);
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(screen.getByText('Ending call…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hang up' })).toBeDisabled();
    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'finished',
        result: 'answered',
        answeredAt: null,
        endedAt: new Date().toISOString(),
        durationSeconds: 4,
        observedAt: Date.now(),
      }));
    await act(async () => {
      first.emit('disconnect');
    });
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(first.eventNames()).toEqual([]);
    expect(screen.getByText('Completed')).toBeVisible();
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(screen.getByRole('timer')).toHaveTextContent('00:04');
    expect(device.destroy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Other lead' }));
    const nextDialButton = await openPhone();
    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'reserved',
        result: null,
        answeredAt: null,
        endedAt: null,
        durationSeconds: null,
        observedAt: Date.now(),
      }));
    await act(async () => fireEvent.click(nextDialButton));
    expect(createVoiceSession).toHaveBeenLastCalledWith(
      anotherLead,
      expect.any(AbortSignal),
    );
    expect(Device).toHaveBeenCalledTimes(1);
    expect(device.updateToken).toHaveBeenCalledWith(`token-for-${anotherLead}`);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    act(() => {
      second.emit('accept');
    });
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Mute$/ })).toBeEnabled();

    view.unmount();
    expect(second.eventNames()).toEqual([]);
    expect(device.listenerCount('error')).toBe(0);
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it('sends only clicked tones to the authorized open call and keeps the keypad across routes', async () => {
    jest.useFakeTimers();
    const { first, device } = setup();
    const dialButton = await openPhone();
    await act(async () => fireEvent.click(dialButton));
    const keypad = screen.getByRole('button', { name: 'Keypad' });
    expect(Logger.setLevel).toHaveBeenCalledWith('silent', false);
    expect(keypad).toBeDisabled();
    expect(keypad).toHaveAttribute('aria-pressed', 'false');
    first.setStatus('open');
    act(() => first.emit('accept'));
    expect(keypad).toBeDisabled();

    jest
      .mocked(getVoiceCallProgress)
      .mockImplementation(async (_recordId, id) => ({
        id,
        status: 'answered',
        result: null,
        answeredAt: new Date().toISOString(),
        endedAt: null,
        durationSeconds: null,
        observedAt: Date.now(),
      }));
    await act(async () => jest.advanceTimersByTime(2_000));
    const controls = within(
      screen.getByRole('group', { name: 'Call controls' }),
    );
    const audio = controls.getByRole('button', { name: 'Audio' });
    const hangUp = controls.getByRole('button', { name: 'Hang up' });
    expect(controls.getAllByRole('button')).toEqual([
      controls.getByRole('button', { name: 'Mute' }),
      keypad,
      audio,
      hangUp,
    ]);
    fireEvent.click(keypad);
    expect(keypad).toHaveAttribute('aria-pressed', 'true');
    expect(keypad).toHaveAttribute('aria-controls');
    fireEvent.click(audio);
    expect(audio).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toBeVisible();
    expect(
      screen.queryByRole('group', { name: 'Phone keypad' }),
    ).not.toBeInTheDocument();
    fireEvent.click(audio);
    expect(audio).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.queryByRole('combobox', { name: 'Microphone' }),
    ).not.toBeInTheDocument();
    fireEvent.click(keypad);
    expect(controls.getByRole('button', { name: 'Hang up' })).toBe(hangUp);
    for (const digit of '0123456789*#') {
      const name = digit === '*' ? 'Star' : digit === '#' ? 'Pound' : digit;
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(first.sendDigits.mock.calls).toEqual(
      [...'0123456789*#'].map((digit) => [digit]),
    );

    fireEvent.keyDown(document.body, { key: '8' });
    fireEvent.click(screen.getByRole('link', { name: 'Leads' }));
    expect(screen.getByRole('group', { name: 'Phone keypad' })).toBeVisible();
    expect(first.sendDigits).toHaveBeenCalledTimes(12);

    first.sendDigits.mockImplementationOnce(() => {
      throw new Error('send failed');
    });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(
      screen.getByText('The tone could not be sent. Try again.'),
    ).toBeVisible();
    first.sendDigits.mockImplementationOnce(() => {
      first.emit('error', new Error('signaling disconnected'));
    });
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(first.disconnect).not.toHaveBeenCalled();
    expect(device.destroy).not.toHaveBeenCalled();

    act(() => first.emit('reconnecting'));
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    act(() => first.emit('reconnected'));
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
    first.setStatus('closed');
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(first.sendDigits).toHaveBeenCalledTimes(14);
    first.setStatus('open');
    fireEvent.click(keypad);
    expect(keypad).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(keypad);
    expect(
      screen.queryByText('The tone could not be sent. Try again.'),
    ).not.toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Hang up' })),
    );
    expect(
      screen.queryByRole('group', { name: 'Phone keypad' }),
    ).not.toBeInTheDocument();
    expect(createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it('offers audio setup before dialing and keeps the supported control usable', async () => {
    const microphone: MediaDeviceInfo = {
      kind: 'audioinput',
      deviceId: 'usb-mic',
      label: 'USB mic',
      groupId: 'fixture',
      toJSON: () => ({}),
    };
    const stop = jest.fn();
    const getUserMedia = jest.fn().mockResolvedValue({
      getTracks: () => [{ stop }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: jest.fn().mockResolvedValue([microphone]),
      },
    });
    const { device } = setup();
    const sdkAudio = Object.assign(new EventEmitter(), {
      availableInputDevices: new Map([[microphone.deviceId, microphone]]),
      availableOutputDevices: new Map(),
      speakerDevices: { get: () => new Set() },
      isOutputSelectionSupported: false,
      setInputDevice: jest.fn().mockResolvedValue(undefined),
      unsetInputDevice: jest.fn().mockResolvedValue(undefined),
    });
    Object.assign(device, { audio: sdkAudio });

    const dialButton = await openPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    expect(
      await screen.findByRole('option', { name: 'USB mic' }),
    ).toBeVisible();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(
      screen.getByRole('combobox', { name: 'Audio output' }),
    ).toBeDisabled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Allow microphone access' }),
      ),
    );
    expect(stop).toHaveBeenCalledTimes(1);
    const input = screen.getByRole('combobox', { name: 'Microphone' });
    fireEvent.change(input, { target: { value: microphone.deviceId } });
    expect(input).toHaveValue(microphone.deviceId);
    expect(sdkAudio.setInputDevice).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(dialButton));
    expect(sdkAudio.setInputDevice).toHaveBeenCalledWith(microphone.deviceId);
    expect(device.connect).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Hang up' })),
    );
    expect(sdkAudio.unsetInputDevice).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(microphone.deviceId);
  });

  const openPhoneDuringCall = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Call lead' }));
    expect(
      screen.queryByRole('button', { name: 'Place call' }),
    ).not.toBeInTheDocument();
  };

  it.each(['workspace', 'user', 'logout'])(
    'clears the active call and lead details on %s change',
    async (scope) => {
      const { first, device, store } = setup();
      const dialButton = await openPhone();
      await act(async () => fireEvent.click(dialButton));
      act(() => {
        first.emit('accept');
      });
      expect(screen.getByText('Original lead')).toBeVisible();

      act(() => {
        if (scope === 'workspace')
          store.set(currentWorkspaceState.atom, {
            id: 'workspace-b',
          } as CurrentWorkspace);
        else if (scope === 'user')
          store.set(currentUserState.atom, { id: 'user-b' } as CurrentUser);
        else store.set(isCookieAuthActiveState.atom, false);
      });

      expect(
        screen.queryByRole('complementary', { name: 'Softphone' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(destination, { exact: false }),
      ).not.toBeInTheDocument();
      expect(first.eventNames()).toEqual([]);
      expect(device.listenerCount('error')).toBe(0);
      expect(device.destroy).toHaveBeenCalledTimes(1);
    },
  );

  it('stops and clears call details when Voice authorization is lost', async () => {
    jest.useFakeTimers();
    const { first, device } = setup();
    const dialButton = await openPhone();
    await act(async () => fireEvent.click(dialButton));
    act(() => {
      first.emit('accept');
    });
    jest.mocked(getVoiceStatus).mockResolvedValue('disabled');

    await act(async () => jest.advanceTimersByTime(15_000));

    expect(screen.queryByText('Original lead')).not.toBeInTheDocument();
    expect(
      screen.queryByText(destination, { exact: false }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Outbound Voice is disabled.')).toBeVisible();
    expect(first.eventNames()).toEqual([]);
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it('hangs up and removes the name and number when the original record is no longer readable', async () => {
    const { first, device } = setup();
    const dialButton = await openPhone();
    await act(async () => fireEvent.click(dialButton));
    act(() => {
      first.emit('accept');
    });
    expect(screen.getByText('Original lead')).toBeVisible();

    jest.mocked(useVoiceLeadDetails).mockReturnValue({ status: 'unavailable' });
    await act(async () => {
      first.emit('reconnecting');
    });

    expect(screen.queryByText('Original lead')).not.toBeInTheDocument();
    expect(
      screen.queryByText(destination, { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Voice authorization could not be verified for this lead.',
      ),
    ).toBeVisible();
    expect(first.eventNames()).toEqual([]);
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });
});
