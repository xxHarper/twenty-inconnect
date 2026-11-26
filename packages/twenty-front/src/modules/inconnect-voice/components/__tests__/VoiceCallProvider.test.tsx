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
import type * as VoicePhoneNavigationItemModule from '@/inconnect-voice/components/VoicePhoneNavigationItem';
import {
  VoiceCallContext,
  VoicePhoneContext,
} from '@/inconnect-voice/contexts/VoiceCallContext';
import { useVoiceLeadDetails } from '@/inconnect-voice/hooks/useVoiceLeadDetails';
import {
  createVoiceSession,
  createManualVoiceSession,
  getVoiceCallProgress,
  getVoiceInboundAccess,
  getVoiceInboundOffer,
  getManualVoiceCallProgress,
  getVoicePhoneAccess,
  getVoiceRecents,
  getVoiceStatus,
  lookupVoiceNumber,
  startVoiceInboundSession,
  updateVoiceInboundSession,
  type VoiceLookup,
} from '@/inconnect-voice/utils/voiceApi';
import { DefaultLayout } from '@/ui/layout/page/components/DefaultLayout';
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
import userEvent from '@testing-library/user-event';
import { Device, Logger } from '@twilio/voice-sdk';
import { EventEmitter } from 'events';
import { createStore, Provider } from 'jotai';
import { type PropsWithChildren, useContext } from 'react';
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
  createManualVoiceSession: jest.fn(),
  getVoiceCallProgress: jest.fn(),
  getManualVoiceCallProgress: jest.fn(),
  getVoiceInboundAccess: jest.fn(),
  getVoiceInboundOffer: jest.fn(),
  getVoicePhoneAccess: jest.fn(),
  getVoiceRecents: jest.fn(),
  getVoiceStatus: jest.fn(),
  lookupVoiceNumber: jest.fn(),
  startVoiceInboundSession: jest.fn(),
  updateVoiceInboundSession: jest.fn(),
  VoiceApiError: Error,
}));

jest.mock('@/navigation/components/AppNavigationDrawer', () => ({
  AppNavigationDrawer: () => {
    const { VoicePhoneNavigationItem } = jest.requireActual<
      typeof VoicePhoneNavigationItemModule
    >('@/inconnect-voice/components/VoicePhoneNavigationItem');
    return (
      <nav>
        <VoicePhoneNavigationItem />
      </nav>
    );
  },
}));
jest.mock('@/error-handler/components/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: PropsWithChildren) => children,
}));
jest.mock('@/error-handler/components/AppFullScreenErrorFallback', () => ({}));
jest.mock('@/error-handler/components/AppPageErrorFallback', () => ({}));
jest.mock('@/file-upload/components/FileUploadProvider', () => ({
  FileUploadProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock(
  '@/information-banner/components/impersonate/InformationBannerIsImpersonating',
  () => ({ InformationBannerIsImpersonating: () => null }),
);
jest.mock('@/keyboard-shortcut-menu/components/KeyboardShortcutMenu', () => ({
  KeyboardShortcutMenu: () => null,
}));
jest.mock('@/layout-customization/components/LayoutCustomizationBar', () => ({
  LayoutCustomizationBar: () => null,
}));
jest.mock('@/navigation/components/MobileNavigationBar', () => ({
  MobileNavigationBar: () => null,
}));
jest.mock(
  '@/navigation-menu-item/display/dnd/providers/PageDragDropProvider',
  () => ({
    PageDragDropProvider: ({ children }: PropsWithChildren) => children,
  }),
);
jest.mock('@/ui/layout/fullscreen/hooks/useShowFullscreen', () => ({
  useShowFullscreen: () => false,
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

const GlobalPhone = () => {
  const open = useContext(VoicePhoneContext);
  return <button onClick={() => open?.()}>Phone</button>;
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
      .mocked(getVoiceInboundAccess)
      .mockRejectedValue(new Error('Inbound disabled'));
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

  const setup = (useDefaultLayout = false) => {
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
            initialEntries={[useDefaultLayout ? '/messages' : '/lead']}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            {useDefaultLayout ? (
              <Routes>
                <Route element={<DefaultLayout />}>
                  <Route path="/messages" element={<h1>Inbox</h1>} />
                </Route>
              </Routes>
            ) : (
              <VoiceCallProvider>
                <nav>
                  <GlobalPhone />
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
            )}
          </MemoryRouter>
        </I18nProvider>
      </Provider>
    );
    const view = render(app);
    return { first, second, device, store, view };
  };

  it('opens Phone from the default layout sidebar with outbound disabled and no free-dial grant', async () => {
    jest.mocked(getVoicePhoneAccess).mockResolvedValue(true);
    jest.mocked(getVoiceStatus).mockResolvedValue('disabled');
    jest.mocked(getVoiceRecents).mockResolvedValue({ next: null, rows: [] });
    setup(true);

    const sidebar = screen.getByRole('navigation');
    fireEvent.click(
      await within(sidebar).findByRole('button', { name: 'Phone' }),
    );

    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Keypad' })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Phone number' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place call' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Keypad' }), {
      key: 'ArrowRight',
    });
    expect(await screen.findByText('No calls recorded.')).toBeInTheDocument();
    expect(getVoicePhoneAccess).toHaveBeenCalled();
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(createManualVoiceSession).not.toHaveBeenCalled();
  });

  const openPhone = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Call lead' }));
    const getDialButton = () =>
      screen.getByRole('button', { name: 'Place call' });
    await waitFor(() => expect(getDialButton()).toBeEnabled());
    return getDialButton();
  };

  it('opens the global keypad, precaches a recent number for review and starts only on confirmation', async () => {
    const { first, device } = setup();
    jest.mocked(getVoiceRecents).mockResolvedValue({
      next: null,
      rows: [
        {
          id: originalLead,
          recordId: null,
          name: null,
          destination,
          createdAt: '2026-11-25T18:00:00Z',
          direction: 'outbound',
          status: 'finished',
          result: 'answered',
          answeredAt: null,
          endedAt: null,
          durationSeconds: 30,
        },
      ],
    });
    jest.mocked(lookupVoiceNumber).mockResolvedValue({
      candidates: [],
      next: null,
      destination,
      canCall: true,
      canCallUnlinked: true,
    });
    jest.mocked(createManualVoiceSession).mockResolvedValue({
      token: 'new-token',
      destination,
      intentId: anotherLead,
      intentExpiresAt: Date.now() + 45_000,
    });
    jest.mocked(getManualVoiceCallProgress).mockResolvedValue({
      id: anotherLead,
      status: 'reserved',
      result: null,
      answeredAt: null,
      endedAt: null,
      durationSeconds: null,
      observedAt: Date.now(),
    });

    fireEvent.click(screen.getByRole('link', { name: 'Messaging' }));
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    const input = screen.getByRole('textbox', { name: 'Phone number' });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(input).toHaveValue('1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    expect(input).toHaveValue('');
    expect(first.sendDigits).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Recents' }));
    const redial = await screen.findByRole('button', {
      name: `Redial ${destination}`,
    });
    fireEvent.click(redial);
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
      destination,
    );
    expect(lookupVoiceNumber).not.toHaveBeenCalled();
    expect(createManualVoiceSession).not.toHaveBeenCalled();
    const dial = await screen.findByRole('button', { name: 'Place call' });
    expect(dial).toBeDisabled();
    await waitFor(() => expect(dial).toBeEnabled());
    expect(lookupVoiceNumber).toHaveBeenCalledWith(
      destination,
      expect.any(AbortSignal),
      undefined,
    );
    await act(async () => fireEvent.click(dial));

    expect(createManualVoiceSession).toHaveBeenCalledWith(
      destination,
      null,
      expect.any(AbortSignal),
    );
    expect(device.connect).toHaveBeenCalledWith({
      params: { intentId: anotherLead },
    });
    expect(
      screen.queryByRole('textbox', { name: 'Phone number' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Recents' }),
    ).not.toBeInTheDocument();
    expect(first.sendDigits).not.toHaveBeenCalled();
  });

  it('debounces valid pasted numbers and ignores an older response after the destination changes', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const alternate = '+14155552671';
    const result = {
      candidates: [{ name: 'Original lead', recordId: originalLead }],
      next: null,
      destination,
      canCall: true,
      canCallUnlinked: false,
    };
    let resolveOld: (value: VoiceLookup) => void = () => undefined;
    jest
      .mocked(lookupVoiceNumber)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...result,
        destination: alternate,
        candidates: [{ name: 'Another lead', recordId: anotherLead }],
      });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    const field = screen.getByRole('textbox', { name: 'Phone number' });
    const dial = screen.getByRole('button', { name: 'Place call' });
    for (const value of ['2', '+1 201', '*123#', '911']) {
      fireEvent.change(field, { target: { value } });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(500);
      });
    }
    expect(lookupVoiceNumber).not.toHaveBeenCalled();
    expect(dial).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear number' }));
    await user.click(field);
    await user.paste('+1 (201) 555-0123');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(499);
    });
    expect(lookupVoiceNumber).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(lookupVoiceNumber).toHaveBeenCalledTimes(1);
    const firstSignal = jest.mocked(lookupVoiceNumber).mock.calls[0][1];
    fireEvent.change(field, { target: { value: alternate } });
    expect(firstSignal.aborted).toBe(true);
    expect(dial).toBeDisabled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText('Another lead')).toBeInTheDocument();
    expect(dial).toBeEnabled();
    await act(async () => resolveOld(result));
    expect(screen.queryByText('Original lead')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear number' }));
    expect(screen.queryByText('Another lead')).not.toBeInTheDocument();
    expect(dial).toBeDisabled();
    expect(createManualVoiceSession).not.toHaveBeenCalled();
  });

  it('keeps dialing blocked after a lookup error and until a matching Lead is selected explicitly', async () => {
    jest.useFakeTimers();
    jest
      .mocked(lookupVoiceNumber)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({
        candidates: [
          { name: 'First match', recordId: originalLead },
          { name: 'Second match', recordId: anotherLead },
        ],
        next: null,
        destination,
        canCall: true,
        canCallUnlinked: false,
      })
      .mockResolvedValueOnce({
        candidates: [],
        next: null,
        destination: '+14155552671',
        canCall: true,
        canCallUnlinked: false,
      });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    const field = screen.getByRole('textbox', { name: 'Phone number' });
    const dial = screen.getByRole('button', { name: 'Place call' });
    fireEvent.change(field, { target: { value: destination } });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Matching Leads could not be verified.',
    );
    expect(dial).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry lookup' }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    const second = screen.getByRole('radio', { name: 'Second match' });
    expect(second).not.toBeChecked();
    expect(dial).toBeDisabled();
    fireEvent.click(second);
    expect(dial).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    expect(field).toHaveValue(destination);
    expect(second).toBeChecked();
    fireEvent.change(field, { target: { value: '+14155552671' } });
    expect(dial).toBeDisabled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText('No associated Lead')).toBeInTheDocument();
    expect(dial).toBeDisabled();
    expect(createManualVoiceSession).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'user'])(
    'cancels lookup and clears the global draft after a %s change',
    async (identity) => {
      jest.useFakeTimers();
      jest
        .mocked(lookupVoiceNumber)
        .mockReturnValue(new Promise(() => undefined));
      const { store } = setup();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), {
        target: { value: destination },
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(500);
      });
      const signal = jest.mocked(lookupVoiceNumber).mock.calls[0][1];
      await act(async () => {
        if (identity === 'workspace')
          store.set(currentWorkspaceState.atom, {
            id: 'workspace-b',
          } as CurrentWorkspace);
        else store.set(currentUserState.atom, { id: 'user-b' } as CurrentUser);
      });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
      });
      expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(
        '',
      );
      expect(createManualVoiceSession).not.toHaveBeenCalled();
    },
  );

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
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    expect(screen.getByText('Original lead')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Phone number' }),
    ).not.toBeInTheDocument();
    expect(Device).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText('Call completed')).toBeVisible();
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(screen.getByRole('timer')).toHaveTextContent('00:04');
    expect(screen.getByText('Connected time')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Audio' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to keypad' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Back to recents' }),
    ).toBeVisible();
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

  it('shows symmetric incoming controls and opens Recents after completion without retiring the registered device', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000003';
    jest.mocked(getVoiceInboundAccess).mockResolvedValue({ available: true });
    jest
      .mocked(startVoiceInboundSession)
      .mockResolvedValue({ id: sessionId, token: 'inbound-token' });
    jest.mocked(updateVoiceInboundSession).mockResolvedValue({});
    jest.mocked(getVoiceRecents).mockResolvedValue({ rows: [], next: null });
    let finished = false;
    jest.mocked(getVoiceInboundOffer).mockImplementation(async (id) => ({
      id,
      recordId: originalLead,
      name: 'Incoming Lead',
      number: destination,
      status: finished ? 'finished' : 'ringing',
      result: finished ? 'answered' : null,
      answeredAt: null,
      endedAt: finished ? new Date().toISOString() : null,
      durationSeconds: finished ? 21 : null,
      observedAt: Date.now(),
    }));
    const { first, device } = setup();
    const receiver = Object.assign(device, {
      state: 'unregistered',
      register: jest.fn(async () => {
        receiver.state = 'registered';
        receiver.emit('registered');
      }),
    });
    first.setStatus('pending');
    const incoming = Object.assign(first, {
      customParameters: new Map([['inconnectVoiceCallId', anotherLead]]),
      accept: jest.fn(),
      reject: jest.fn(),
    });

    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Phone' })),
    );
    const receive = await screen.findByRole('button', {
      name: 'Receive calls',
    });
    await act(async () => fireEvent.click(receive));
    expect(await screen.findByText('Ready to receive calls')).toBeVisible();
    await act(async () => {
      receiver.emit('incoming', incoming);
    });
    expect(screen.getByText('Incoming call')).toBeVisible();
    expect(screen.getByText('+1 201 555 0123')).toBeVisible();
    const [decline, accept] = within(
      screen.getByRole('group', { name: 'Incoming call controls' }),
    ).getAllByRole('button');
    expect(decline).toHaveAccessibleName('Decline');
    expect(accept).toHaveAccessibleName('Accept');
    await act(async () => fireEvent.click(accept));
    expect(incoming.accept).toHaveBeenCalledTimes(1);
    act(() => {
      first.setStatus('open');
      first.emit('accept');
    });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Audio' })),
    );
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toBeVisible();

    finished = true;
    await act(async () => {
      first.setStatus('closed');
      first.emit('disconnect');
    });
    expect(await screen.findByText('Call completed')).toBeVisible();
    expect(screen.getByText('Connected time')).toBeVisible();
    expect(screen.getByRole('timer')).toHaveTextContent('00:21');
    expect(
      screen.queryByRole('button', { name: 'Audio' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Microphone' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Back to recents' })),
    );
    expect(
      await screen.findByRole('tabpanel', { name: 'Recents' }),
    ).toBeVisible();
    expect(screen.getByText('Ready to receive calls')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Phone' })).toBeVisible();
    expect(receiver.register).toHaveBeenCalledTimes(1);
    expect(receiver.destroy).not.toHaveBeenCalled();
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
    expect(
      screen.queryByRole('combobox', { name: 'Microphone' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Back to keypad' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    expect(
      await screen.findByRole('combobox', { name: 'Microphone' }),
    ).toHaveValue(microphone.deviceId);
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
