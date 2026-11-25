import { createVoiceAudio } from '@/inconnect-voice/utils/createVoiceAudio';
import { type Call, type Device } from '@twilio/voice-sdk';
import { EventEmitter } from 'events';

const makeDevice = (
  kind: MediaDeviceKind,
  deviceId: string,
): MediaDeviceInfo => ({
  kind,
  deviceId,
  groupId: 'fixture',
  label: deviceId,
  toJSON: () => ({ deviceId, kind }),
});

const defaultInput = makeDevice('audioinput', 'default');
const usbInput = makeDevice('audioinput', 'usb-mic');
const defaultOutput = makeDevice('audiooutput', 'default');
const usbOutput = makeDevice('audiooutput', 'usb-speaker');

const makeStream = () => {
  const track = {
    enabled: true,
    readyState: 'live',
    getSettings: () => ({ deviceId: 'default' }),
    stop: jest.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
};

const makeSdkAudio = () => {
  const availableInputDevices = new Map(
    [defaultInput, usbInput].map((device) => [device.deviceId, device]),
  );
  const availableOutputDevices = new Map(
    [defaultOutput, usbOutput].map((device) => [device.deviceId, device]),
  );
  const speakers = new Set([defaultOutput]);
  const audio = Object.assign(new EventEmitter(), {
    availableInputDevices,
    availableOutputDevices,
    inputDevice: null as MediaDeviceInfo | null,
    inputStream: null as MediaStream | null,
    isOutputSelectionSupported: true,
    setInputDevice: jest.fn(async (id: string) => {
      audio.inputDevice = availableInputDevices.get(id) ?? null;
    }),
    unsetInputDevice: jest.fn(async () => {
      audio.inputDevice = null;
    }),
    speakerDevices: {
      get: () => speakers,
      set: jest.fn(async (id: string) => {
        const next = availableOutputDevices.get(id);
        if (!next) throw new DOMException('', 'NotFoundError');
        speakers.clear();
        speakers.add(next);
      }),
    },
  });

  return audio;
};

describe('Voice audio settings', () => {
  const storageKey = 'inconnect.voice.audio.v1:workspace:user';
  const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  );
  const sinkDescriptor = Object.getOwnPropertyDescriptor(
    HTMLAudioElement.prototype,
    'setSinkId',
  );
  const browserMedia = Object.assign(new EventTarget(), {
    enumerateDevices: jest.fn(),
    getUserMedia: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: browserMedia,
    });
    Object.defineProperty(HTMLAudioElement.prototype, 'setSinkId', {
      configurable: true,
      value: jest.fn(),
    });
    browserMedia.enumerateDevices.mockResolvedValue([
      defaultInput,
      usbInput,
      defaultOutput,
      usbOutput,
    ]);
    browserMedia.getUserMedia.mockResolvedValue(makeStream().stream);
  });

  afterEach(() => {
    if (mediaDevicesDescriptor)
      Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    if (sinkDescriptor)
      Object.defineProperty(
        HTMLAudioElement.prototype,
        'setSinkId',
        sinkDescriptor,
      );
    else Reflect.deleteProperty(HTMLAudioElement.prototype, 'setSinkId');
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const setup = async () => {
    const sdk = makeSdkAudio();
    const publish = jest.fn();
    const audio = createVoiceAudio('workspace:user', publish);
    const stopWatching = audio.watch();
    await Promise.resolve();
    const capture = audio.createCapture();
    audio.attach({ audio: sdk } as unknown as Device, capture);
    const local = makeStream();
    const call = {
      status: () => 'open',
      getLocalStream: () => local.stream,
      isMuted: jest.fn(() => false),
    };
    const start = async () => {
      await audio.prepare(
        new AbortController().signal,
        () => call as unknown as Call,
      );
      audio.refreshEffective();
    };
    return { audio, sdk, capture, call, start, stopWatching };
  };

  it('stores an idle selection per user and workspace without opening the microphone', async () => {
    const remove = jest.spyOn(browserMedia, 'removeEventListener');
    const { audio, sdk, start, stopWatching } = await setup();
    await audio.select('input', usbInput.deviceId);
    await audio.select('output', usbOutput.deviceId);
    expect(browserMedia.getUserMedia).not.toHaveBeenCalled();
    expect(sdk.setInputDevice).not.toHaveBeenCalled();
    expect(sdk.speakerDevices.set).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toEqual({
      input: 'usb-mic',
      output: 'usb-speaker',
    });
    expect(
      createVoiceAudio('workspace:user', jest.fn()).getSettings().preferences,
    ).toEqual({ input: 'usb-mic', output: 'usb-speaker' });
    for (const scope of ['workspace:other', 'other:user']) {
      expect(
        createVoiceAudio(scope, jest.fn()).getSettings().preferences,
      ).toEqual({ input: 'default', output: 'default' });
    }

    await start();
    expect(sdk.setInputDevice).toHaveBeenCalledWith('usb-mic');
    expect(sdk.speakerDevices.set).toHaveBeenCalledWith('usb-speaker');
    expect(audio.getSettings().effective).toEqual({
      input: 'usb-mic',
      output: 'usb-speaker',
    });
    expect(audio.end(false)).toBe(false);
    expect(sdk.unsetInputDevice).toHaveBeenCalledTimes(1);
    audio.end(true);
    stopWatching();
    expect(sdk.listenerCount('deviceChange')).toBe(0);
    expect(remove).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });

  it('uses system defaults for stale preferences and skips unsupported selection independently', async () => {
    jest.useFakeTimers();
    localStorage.setItem(
      storageKey,
      JSON.stringify({ input: 'gone-mic', output: 'gone-speaker' }),
    );
    const { audio, sdk, start, stopWatching } = await setup();
    const starting = start();
    await jest.advanceTimersByTimeAsync(500);
    await starting;
    expect(sdk.setInputDevice).not.toHaveBeenCalled();
    expect(sdk.speakerDevices.set).toHaveBeenCalledWith('default');
    expect(audio.getSettings().issues).toEqual({
      input: 'unavailable',
      output: 'fallback',
    });
    audio.end(true);
    stopWatching();

    Object.defineProperty(browserMedia, 'getSupportedConstraints', {
      configurable: true,
      value: () => ({}),
    });
    try {
      const second = await setup();
      expect(second.audio.getSettings().supported).toEqual({
        input: false,
        output: true,
      });
      second.audio.end(true);
      second.stopWatching();
    } finally {
      Reflect.deleteProperty(browserMedia, 'getSupportedConstraints');
    }

    Reflect.deleteProperty(HTMLAudioElement.prototype, 'setSinkId');
    expect(
      createVoiceAudio('workspace:user', jest.fn()).getSettings().supported,
    ).toEqual({ input: true, output: false });
  });

  it('allows an explicit permission retry and stops the preview stream immediately', async () => {
    const preview = makeStream();
    browserMedia.getUserMedia
      .mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
      .mockResolvedValueOnce(preview.stream);
    const { audio, stopWatching } = await setup();
    await expect(audio.checkMicrophone()).rejects.toHaveProperty(
      'name',
      'NotAllowedError',
    );
    expect(audio.getSettings().microphoneAccess).toBe('denied');
    await audio.checkMicrophone();
    expect(audio.getSettings().microphoneAccess).toBe('granted');
    expect(preview.track.stop).toHaveBeenCalledTimes(1);
    audio.end(true);
    stopWatching();
  });

  it('keeps a replacement track muted and keeps the previous selection when a change fails', async () => {
    const { audio, sdk, capture, call, start, stopWatching } = await setup();
    await start();
    call.isMuted.mockReturnValue(true);
    const replacement = makeStream();
    browserMedia.getUserMedia.mockResolvedValueOnce(replacement.stream);
    sdk.setInputDevice.mockImplementationOnce(async (id) => {
      sdk.inputStream = await capture.getUserMedia({ audio: true });
      sdk.inputDevice = sdk.availableInputDevices.get(id) ?? null;
    });
    await audio.select('input', 'usb-mic');
    expect(replacement.track.enabled).toBe(false);
    expect(audio.getSettings().effective.input).toBe('usb-mic');

    sdk.setInputDevice.mockRejectedValueOnce(
      new DOMException('', 'NotAllowedError'),
    );
    await audio.select('input', 'default');
    expect(audio.getSettings().issues.input).toBe('denied');
    expect(audio.getSettings().effective.input).toBe('usb-mic');
    expect(audio.getSettings().preferences.input).toBe('usb-mic');

    sdk.speakerDevices.set.mockRejectedValueOnce(
      new DOMException('', 'NotFoundError'),
    );
    await audio.select('output', 'usb-speaker');
    expect(audio.getSettings().issues.output).toBe('unavailable');
    expect(audio.getSettings().effective.output).toBe('default');
    expect(audio.getSettings().preferences.output).toBe('default');
    audio.end(false);
    expect(replacement.track.stop).toHaveBeenCalled();
    audio.end(true);
    stopWatching();
  });

  it('refreshes the device inventory and reports the effective fallback after unplugging', async () => {
    jest.useFakeTimers();
    const { audio, sdk, capture, start, stopWatching } = await setup();
    await start();
    await audio.select('input', 'usb-mic');
    await audio.select('output', 'usb-speaker');
    sdk.availableInputDevices.delete('usb-mic');
    sdk.availableOutputDevices.delete('usb-speaker');
    browserMedia.enumerateDevices.mockResolvedValue([
      defaultInput,
      defaultOutput,
    ]);
    sdk.emit('deviceChange', [usbInput, usbOutput]);

    const fallback = makeStream();
    browserMedia.getUserMedia.mockResolvedValueOnce(fallback.stream);
    sdk.inputStream = await capture.getUserMedia({ audio: true });
    sdk.inputDevice = defaultInput;
    await jest.runOnlyPendingTimersAsync();

    expect(audio.getSettings().devices).toEqual({
      input: [defaultInput],
      output: [defaultOutput],
    });
    expect(audio.getSettings().effective).toEqual({
      input: 'default',
      output: 'default',
    });
    expect(audio.getSettings().issues).toEqual({
      input: 'fallback',
      output: 'fallback',
    });
    expect(audio.getSettings().preferences).toEqual({
      input: 'usb-mic',
      output: 'usb-speaker',
    });
    audio.end(true);
    stopWatching();
  });

  it('blocks overlapping input selections and releases captures that resolve after hangup', async () => {
    const { audio, sdk, capture, start, stopWatching } = await setup();
    await start();
    let grant: (stream: MediaStream) => void = () => undefined;
    browserMedia.getUserMedia.mockReturnValueOnce(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    sdk.setInputDevice.mockImplementationOnce(async () => {
      sdk.inputStream = await capture.getUserMedia({ audio: true });
      sdk.inputDevice = usbInput;
    });
    const selection = audio.select('input', 'usb-mic');
    await audio.select('input', 'default');
    expect(sdk.setInputDevice).toHaveBeenCalledTimes(1);
    expect(audio.getSettings().pending.input).toBe(true);
    expect(audio.end(false)).toBe(true);
    const late = makeStream();
    grant(late.stream);
    await selection;
    expect(late.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.getSettings().preferences.input).toBe('default');
    expect(sdk.listenerCount('deviceChange')).toBe(0);
    stopWatching();
  });

  it('retires a device whose SDK input cannot be unset after the call', async () => {
    const { audio, sdk, start, stopWatching } = await setup();
    await start();
    await audio.select('input', 'usb-mic');
    sdk.unsetInputDevice.mockRejectedValueOnce(new Error('still connected'));
    expect(audio.end(false)).toBe(false);
    await expect(audio.canReuseDevice()).resolves.toBe(false);
    audio.end(true);
    stopWatching();
  });
});
