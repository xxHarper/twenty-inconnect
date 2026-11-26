import { useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import {
  createVoiceSession,
  getVoiceStatus,
  getVoiceInboundAccess,
  getVoiceInboundOffer,
  startVoiceInboundSession,
  updateVoiceInboundSession,
} from '@/inconnect-voice/utils/voiceApi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Device } from '@twilio/voice-sdk';
import { EventEmitter } from 'events';

jest.mock('@/inconnect-voice/utils/voiceApi', () => ({
  createVoiceSession: jest.fn(),
  getVoiceStatus: jest.fn(),
  getVoiceInboundAccess: jest.fn(),
  getVoiceInboundOffer: jest.fn(),
  startVoiceInboundSession: jest.fn(),
  updateVoiceInboundSession: jest.fn(),
  VoiceApiError: Error,
}));

jest.mock('@twilio/voice-sdk', () => ({
  Call: { State: { Closed: 'closed', Open: 'open', Ringing: 'ringing' } },
  Device: jest.fn(),
  Logger: { setLevel: jest.fn() },
}));

const recordId = '00000000-0000-4000-8000-000000000001';
const intentId = '00000000-0000-4000-8000-000000000002';
const destination = '+12015550123';

describe('useLeadVoiceCall', () => {
  const microphone = jest.fn();
  const mediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    microphone.mockResolvedValue({ getTracks: () => [] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: microphone },
    });
    jest.mocked(getVoiceStatus).mockResolvedValue('ready');
    jest.mocked(createVoiceSession).mockResolvedValue({
      token: 'test-token',
      intentId,
      destination,
      intentExpiresAt: Date.now() + 45_000,
    });
  });

  afterEach(() => {
    if (mediaDevices)
      Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('leaves the SDK and microphone idle when opening and when Voice is unavailable', async () => {
    jest.mocked(getVoiceStatus).mockResolvedValue('not-configured');
    const { result } = renderHook(() => useLeadVoiceCall(true));
    await waitFor(() =>
      expect(result.current.availability).toBe('not-configured'),
    );
    await act(async () => result.current.placeCall(recordId, destination));
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(Device).not.toHaveBeenCalled();
    expect(microphone).not.toHaveBeenCalled();
  });

  it('does not initialize a device for an unexpected authorized destination', async () => {
    const { result } = renderHook(() => useLeadVoiceCall(true));
    await waitFor(() => expect(result.current.availability).toBe('ready'));
    await act(async () => result.current.placeCall(recordId, '+12015550124'));
    expect(result.current.snapshot.state).toBe('destination-changed');
    expect(Device).not.toHaveBeenCalled();
  });

  it('releases a microphone that becomes available after the attempt times out', async () => {
    jest.useFakeTimers();
    try {
      let grantMicrophone: (stream: unknown) => void = () => undefined;
      const stop = jest.fn();
      microphone.mockReturnValue(
        new Promise((resolve) => {
          grantMicrophone = resolve;
        }),
      );
      const { result } = renderHook(() => useLeadVoiceCall(true));
      await waitFor(() => expect(result.current.availability).toBe('ready'));

      act(() => {
        void result.current.placeCall(recordId, destination);
      });
      expect(result.current.snapshot.state).toBe('checking-microphone');
      await act(async () => jest.advanceTimersByTime(20_000));
      expect(result.current.snapshot.state).toBe('timeout');
      expect(result.current.snapshot.failure?.stage).toBe('microphone');

      await act(async () => grantMicrophone({ getTracks: () => [{ stop }] }));
      expect(stop).toHaveBeenCalledTimes(1);
      expect(createVoiceSession).not.toHaveBeenCalled();
      expect(Device).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborts a pending Voice session and identifies the stage on timeout', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(createVoiceSession).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useLeadVoiceCall(true));
      await waitFor(() => expect(result.current.availability).toBe('ready'));

      await act(async () => {
        void result.current.placeCall(recordId, destination);
      });
      await waitFor(() =>
        expect(result.current.snapshot.state).toBe('preparing'),
      );
      await act(async () => jest.advanceTimersByTime(20_000));

      expect(result.current.snapshot.state).toBe('timeout');
      expect(result.current.snapshot.failure?.stage).toBe('session');
      expect(jest.mocked(createVoiceSession).mock.calls[0][1].aborted).toBe(
        true,
      );
      expect(Device).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases a connection that stays pending until the intent expires', async () => {
    jest.useFakeTimers();
    try {
      let resolveCall: (call: unknown) => void = () => undefined;
      const disconnect = jest.fn();
      const device = Object.assign(new EventEmitter(), {
        connect: jest.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveCall = resolve;
          }),
        ),
        destroy: jest.fn(),
      });
      jest.mocked(Device).mockImplementation(() => device as unknown as Device);
      jest.mocked(createVoiceSession).mockResolvedValue({
        token: 'test-token',
        intentId,
        destination,
        intentExpiresAt: Date.now() + 45_000,
      });
      const { result } = renderHook(() => useLeadVoiceCall(true));
      await waitFor(() => expect(result.current.availability).toBe('ready'));

      await act(async () => {
        void result.current.placeCall(recordId, destination);
      });
      await waitFor(() =>
        expect(result.current.snapshot.state).toBe('connecting'),
      );
      await act(async () => jest.advanceTimersByTime(45_000));

      expect(result.current.snapshot.state).toBe('timeout');
      expect(result.current.snapshot.failure?.stage).toBe('connection');
      expect(device.destroy).toHaveBeenCalledTimes(1);

      await act(async () => resolveCall({ disconnect }));
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('registers without a microphone and handles Accept, Decline, remote cancel and reconnect', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000003';
    jest.mocked(getVoiceInboundAccess).mockResolvedValue({ available: true });
    jest
      .mocked(startVoiceInboundSession)
      .mockResolvedValue({ id: sessionId, token: 'inbound-token' });
    jest.mocked(updateVoiceInboundSession).mockResolvedValue({});
    jest.mocked(getVoiceInboundOffer).mockResolvedValue({
      id: intentId,
      recordId,
      name: 'Pilot Lead',
      number: destination,
      status: 'ringing',
      result: null,
      answeredAt: null,
      endedAt: null,
      durationSeconds: null,
      observedAt: Date.now(),
    });
    const device = Object.assign(new EventEmitter(), {
      state: 'unregistered',
      register: jest.fn(async () => {
        device.state = 'registered';
        device.emit('registered');
      }),
      destroy: jest.fn(),
      connect: jest.fn(),
      updateToken: jest.fn(),
    });
    jest.mocked(Device).mockImplementation(() => device as unknown as Device);
    const expanded = jest.fn();
    const { result } = renderHook(() => useLeadVoiceCall(true, '', expanded));
    await waitFor(() => expect(result.current.inbound.available).toBe(true));
    await act(async () => result.current.inbound.start());
    await waitFor(() => expect(result.current.inbound.state).toBe('online'));
    expect(microphone).not.toHaveBeenCalled();
    expect(Device).toHaveBeenCalledTimes(1);
    expect(updateVoiceInboundSession).toHaveBeenCalledWith(
      sessionId,
      'registered',
      false,
      expect.anything(),
    );

    const incoming = () =>
      Object.assign(new EventEmitter(), {
        status: jest.fn().mockReturnValue('pending'),
        customParameters: new Map([['inconnectVoiceCallId', intentId]]),
        reject: jest.fn(),
        accept: jest.fn(),
        disconnect: jest.fn(),
      });
    const accepted = incoming();
    await act(async () => {
      device.emit('incoming', accepted);
    });
    expect(result.current.snapshot.state).toBe('incoming');
    expect(result.current.inboundOffer?.name).toBe('Pilot Lead');
    expect(expanded).toHaveBeenCalledTimes(1);
    await act(async () => result.current.decideInbound('accept'));
    expect(getVoiceInboundOffer).toHaveBeenCalledWith(
      intentId,
      sessionId,
      expect.anything(),
      'accept',
    );
    expect(accepted.accept).toHaveBeenCalledTimes(1);
    act(() => {
      accepted.emit('accept');
    });
    expect(result.current.snapshot.state).toBe('active');
    expect(result.current.snapshot.connectedAt).not.toBeNull();
    act(() => {
      accepted.emit('reconnecting');
    });
    expect(result.current.snapshot.state).toBe('reconnecting');
    act(() => {
      accepted.emit('reconnected');
    });
    expect(result.current.snapshot.state).toBe('active');
    act(() => {
      result.current.hangUp();
    });
    expect(accepted.disconnect).toHaveBeenCalledTimes(1);
    act(() => {
      accepted.emit('disconnect');
    });
    expect(result.current.inbound.state).toBe('online');
    expect(device.destroy).not.toHaveBeenCalled();

    const blocked = Object.assign(new Error('Another call is active'), {
      status: 409,
    });
    jest.mocked(createVoiceSession).mockRejectedValueOnce(blocked);
    await act(async () => result.current.placeCall(recordId, destination));
    expect(device.connect).not.toHaveBeenCalled();
    expect(device.destroy).not.toHaveBeenCalled();
    expect(result.current.inbound.state).toBe('online');

    const remoteEnd = incoming();
    await act(async () => {
      device.emit('incoming', remoteEnd);
    });
    await act(async () => result.current.decideInbound('accept'));
    act(() => {
      remoteEnd.emit('accept');
      remoteEnd.emit('disconnect');
    });
    expect(result.current.snapshot.busy).toBe(false);
    expect(result.current.inbound.state).toBe('online');

    const outgoing = incoming();
    device.connect.mockResolvedValueOnce(outgoing);
    await act(async () => result.current.placeCall(recordId, destination));
    expect(createVoiceSession).toHaveBeenLastCalledWith(
      recordId,
      expect.anything(),
      sessionId,
    );
    expect(device.connect).toHaveBeenCalledTimes(1);
    act(() => {
      outgoing.emit('disconnect');
    });
    expect(result.current.inbound.state).toBe('online');

    const declined = incoming();
    await act(async () => {
      device.emit('incoming', declined);
    });
    await act(async () => result.current.decideInbound('decline'));
    expect(getVoiceInboundOffer).toHaveBeenCalledWith(
      intentId,
      sessionId,
      expect.anything(),
      'decline',
    );
    expect(declined.reject).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot.state).toBe('disconnected');

    const canceled = incoming();
    await act(async () => {
      device.emit('incoming', canceled);
    });
    act(() => {
      canceled.emit('cancel');
    });
    expect(result.current.snapshot.state).toBe('disconnected');
    expect(canceled.accept).not.toHaveBeenCalled();

    await act(async () => {
      device.state = 'unregistered';
      device.emit('unregistered');
    });
    await waitFor(() => expect(result.current.inbound.state).toBe('online'));
    expect(updateVoiceInboundSession).toHaveBeenCalledWith(
      sessionId,
      'offline',
      false,
      expect.anything(),
    );
    expect(device.register).toHaveBeenCalledTimes(2);
    await act(async () => result.current.inbound.stop());
    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(updateVoiceInboundSession).toHaveBeenCalledWith(
      sessionId,
      'stop',
      false,
      expect.anything(),
    );

    jest.mocked(getVoiceInboundAccess).mockReset();
  });

  it('requires a fresh session when the intention expires before connect', async () => {
    jest.mocked(createVoiceSession).mockResolvedValue({
      token: 'test-token',
      intentId,
      destination,
      intentExpiresAt: Date.now() - 1,
    });
    const { result } = renderHook(() => useLeadVoiceCall(true));
    await waitFor(() => expect(result.current.availability).toBe('ready'));
    await act(async () => result.current.placeCall(recordId, destination));
    expect(result.current.snapshot.state).toBe('expired');
    expect(Device).not.toHaveBeenCalled();
  });
});
