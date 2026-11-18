import { useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import {
  createVoiceSession,
  getVoiceStatus,
} from '@/inconnect-voice/utils/voiceApi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Device } from '@twilio/voice-sdk';
import { EventEmitter } from 'events';

jest.mock('@/inconnect-voice/utils/voiceApi', () => ({
  createVoiceSession: jest.fn(),
  getVoiceStatus: jest.fn(),
  VoiceApiError: Error,
}));

jest.mock('@twilio/voice-sdk', () => ({
  Call: { State: { Closed: 'closed', Open: 'open', Ringing: 'ringing' } },
  Device: jest.fn(),
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
    const { result } = renderHook(() => useLeadVoiceCall(recordId));
    await waitFor(() =>
      expect(result.current.availability).toBe('not-configured'),
    );
    await act(async () => result.current.placeCall(destination));
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(Device).not.toHaveBeenCalled();
    expect(microphone).not.toHaveBeenCalled();
  });

  it('connects only on explicit request with the intent ID and releases the device on hangup', async () => {
    const call = Object.assign(new EventEmitter(), {
      status: () => 'connecting',
    });
    const device = Object.assign(new EventEmitter(), {
      connect: jest.fn().mockResolvedValue(call),
      destroy: jest.fn(),
    });
    jest.mocked(Device).mockImplementation(() => device as unknown as Device);
    const { result, unmount } = renderHook(() => useLeadVoiceCall(recordId));
    await waitFor(() => expect(result.current.availability).toBe('ready'));
    expect(Device).not.toHaveBeenCalled();
    await act(async () => result.current.placeCall(destination));
    expect(createVoiceSession).toHaveBeenCalledWith(
      recordId,
      expect.any(AbortSignal),
    );
    expect(device.connect).toHaveBeenCalledWith({ params: { intentId } });
    act(() => {
      call.emit('accept');
      device.emit('tokenWillExpire');
    });
    expect(result.current.state).toBe('active');
    expect(result.current.tokenExpiring).toBe(true);
    act(() => result.current.hangUp());
    expect(result.current.state).toBe('disconnected');
    unmount();
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not initialize a device for an unexpected authorized destination', async () => {
    const { result } = renderHook(() => useLeadVoiceCall(recordId));
    await waitFor(() => expect(result.current.availability).toBe('ready'));
    await act(async () => result.current.placeCall('+12015550124'));
    expect(result.current.state).toBe('destination-changed');
    expect(Device).not.toHaveBeenCalled();
  });

  it('requires a fresh session when the intention expires before connect', async () => {
    jest.mocked(createVoiceSession).mockResolvedValue({
      token: 'test-token',
      intentId,
      destination,
      intentExpiresAt: Date.now() - 1,
    });
    const { result } = renderHook(() => useLeadVoiceCall(recordId));
    await waitFor(() => expect(result.current.availability).toBe('ready'));
    await act(async () => result.current.placeCall(destination));
    expect(result.current.state).toBe('expired');
    expect(Device).not.toHaveBeenCalled();
  });
});
