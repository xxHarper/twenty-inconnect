import { type Call, type Device } from '@twilio/voice-sdk';

import {
  DEFAULT_DEVICE,
  getVoiceAudioIssue,
  readVoiceAudioPreferences,
  type VoiceAudioIssue,
  type VoiceAudioKind,
  type VoiceAudioSettings,
} from '@/inconnect-voice/utils/voiceAudioPreferences';

const AUDIO_KINDS = ['input', 'output'] as const;

const supportsEnumeration = () =>
  typeof navigator.mediaDevices?.enumerateDevices === 'function';

const getBrowserSupport = () => ({
  input:
    supportsEnumeration() &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    (typeof navigator.mediaDevices.getSupportedConstraints !== 'function' ||
      navigator.mediaDevices.getSupportedConstraints().deviceId === true),
  output: supportsEnumeration() && 'setSinkId' in HTMLAudioElement.prototype,
});

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

type AudioAttempt = {
  getCall: () => Call | undefined;
  streams: Set<MediaStream>;
};

type VoiceAudioDevice = {
  audio: NonNullable<Device['audio']>;
  pendingCaptures: number;
  retireAfterCall: boolean;
  outputUnconfirmed: boolean;
  unbind: () => void;
};

export const createVoiceAudio = (
  scope: string,
  publish: (settings: VoiceAudioSettings) => void,
) => {
  const key = `inconnect.voice.audio.v1:${scope}`;
  let settings: VoiceAudioSettings = {
    preferences: readVoiceAudioPreferences(key),
    devices: { input: [], output: [] },
    effective: { input: null, output: null },
    supported: getBrowserSupport(),
    pending: { input: false, output: false },
    issues: {},
    microphoneAccess: 'unconfirmed',
  };
  let device: VoiceAudioDevice | null = null;
  let attempt: AudioAttempt | null = null;
  let permissionCheck: Promise<void> | null = null;
  let enumeration = 0;
  let releasing = Promise.resolve();
  let watching = false;
  let refreshTimer: number | undefined;
  const operations: Record<VoiceAudioKind, Promise<void> | null> = {
    input: null,
    output: null,
  };

  const update = (patch: Partial<VoiceAudioSettings>) => {
    settings = { ...settings, ...patch };
    if (watching) publish(settings);
  };

  const setIssue = (kind: VoiceAudioKind, issue?: VoiceAudioIssue) =>
    update({ issues: { ...settings.issues, [kind]: issue } });

  const save = (kind: VoiceAudioKind, id: string) => {
    const preferences = { ...settings.preferences, [kind]: id };
    update({ preferences });
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {
      // In-memory preferences still work for this session.
    }
  };

  const sdkDevices = () =>
    device && {
      input: device.audio.availableInputDevices,
      output: device.audio.availableOutputDevices,
    };

  const effectiveInput = () => {
    const track = attempt?.getCall()?.getLocalStream?.()?.getAudioTracks()[0];
    if (track?.readyState === 'ended') return null;
    const id =
      device?.audio.inputDevice?.deviceId ?? track?.getSettings().deviceId;
    if (!id) return track ? DEFAULT_DEVICE : null;
    const inventory = device?.audio.availableInputDevices;
    return !inventory?.size || inventory.has(id) ? id : null;
  };

  const refreshEffective = () => {
    if (!device || !attempt) return;
    const inventory = sdkDevices();
    update({
      devices: {
        input: inventory?.input.size
          ? [...inventory.input.values()]
          : settings.devices.input,
        output: inventory?.output.size
          ? [...inventory.output.values()]
          : settings.devices.output,
      },
      effective: {
        input: effectiveInput(),
        output: device.outputUnconfirmed
          ? null
          : (device.audio.speakerDevices.get().values().next().value
              ?.deviceId ?? DEFAULT_DEVICE),
      },
    });
  };

  const refreshBrowserDevices = async () => {
    if (!supportsEnumeration()) return;
    const revision = ++enumeration;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (revision !== enumeration || !watching) return;
      const inventory = attempt ? sdkDevices() : null;
      update({
        devices: {
          input: inventory?.input.size
            ? [...inventory.input.values()]
            : devices.filter(
                (entry) => entry.kind === 'audioinput' && entry.deviceId !== '',
              ),
          output: inventory?.output.size
            ? [...inventory.output.values()]
            : devices.filter(
                (entry) =>
                  entry.kind === 'audiooutput' && entry.deviceId !== '',
              ),
        },
      });
    } catch {
      // Enumeration is optional for calls using the system defaults.
    }
  };

  const checkMicrophone = () => {
    if (permissionCheck) return permissionCheck;
    update({ microphoneAccess: 'checking' });
    permissionCheck = (async () => {
      try {
        if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
          throw new DOMException('', 'NotSupportedError');
        }
        const preferred = settings.preferences.input;
        const preview = await navigator.mediaDevices.getUserMedia({
          audio:
            preferred === DEFAULT_DEVICE
              ? true
              : { deviceId: { ideal: preferred } },
        });
        void refreshBrowserDevices();
        stopStream(preview);
        update({ microphoneAccess: 'granted' });
      } catch (error) {
        update({ microphoneAccess: getVoiceAudioIssue(error) });
        throw error;
      }
    })().finally(() => {
      permissionCheck = null;
    });
    return permissionCheck;
  };

  const refreshAfterCapture = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshEffective();
      if (settings.issues.input === 'lost' && settings.effective.input) {
        setIssue('input', 'fallback');
      }
    }, 0);
  };

  // The SDK keeps explicit captures and may finish acquiring a track after
  // disconnect. Keep ownership of the streams so either path can release them.
  const createCapture = () => {
    let owner: VoiceAudioDevice | null = null;
    return {
      bind: (binding: VoiceAudioDevice) => {
        owner = binding;
      },
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        const current = attempt;
        const binding = owner;
        if (!current || !binding || device !== binding) {
          // A deferred SDK devicechange refresh can run after hangup.
          if (binding && device === binding) binding.retireAfterCall = true;
          return new MediaStream();
        }
        binding.pendingCaptures++;
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (attempt !== current || device !== binding) {
            stopStream(stream);
            return stream;
          }
          current.streams.add(stream);
          if (current.getCall()) {
            // Twilio applies the current mute state after swapping the track.
            // Keep it silent until then, including if Mute is pressed mid-swap.
            for (const track of stream.getAudioTracks()) track.enabled = false;
          }
          return stream;
        } finally {
          binding.pendingCaptures--;
          if (attempt === current && device === binding) refreshAfterCapture();
        }
      },
    };
  };

  const attach = (
    instance: Device,
    capture: ReturnType<typeof createCapture>,
  ) => {
    const audio = instance.audio;
    if (!audio) return;

    const onDeviceChange = (lost: MediaDeviceInfo[]) => {
      if (!attempt) {
        void refreshBrowserDevices();
        return;
      }
      const previousInput = settings.effective.input;
      const previousOutput = settings.effective.output;
      const inputLost =
        previousInput !== null &&
        previousInput !== DEFAULT_DEVICE &&
        !audio.availableInputDevices.has(previousInput);
      const outputLost =
        (previousOutput !== null &&
          previousOutput !== DEFAULT_DEVICE &&
          !audio.availableOutputDevices.has(previousOutput)) ||
        lost.some((entry) => entry.deviceId === previousOutput);
      refreshEffective();
      if (inputLost) {
        setIssue('input', settings.effective.input ? 'fallback' : 'lost');
      }
      if (outputLost) {
        setIssue('output', 'lost');
        binding.outputUnconfirmed = true;
        refreshEffective();
        void restoreOutput(binding);
      }
      void refreshBrowserDevices();
    };
    const binding: VoiceAudioDevice = {
      audio,
      pendingCaptures: 0,
      retireAfterCall: false,
      outputUnconfirmed: false,
      unbind: () => audio.off('deviceChange', onDeviceChange),
    };
    device = binding;
    capture.bind(binding);
    audio.on('deviceChange', onDeviceChange);
    update({
      supported: {
        input:
          getBrowserSupport().input &&
          typeof audio.setInputDevice === 'function' &&
          typeof audio.unsetInputDevice === 'function',
        output:
          audio.isOutputSelectionSupported &&
          typeof audio.speakerDevices?.set === 'function',
      },
    });
  };

  const applySelection = async (kind: VoiceAudioKind, id: string) => {
    const binding = device;
    const current = attempt;
    if (!binding || !current) return false;
    const { audio } = binding;
    const available = sdkDevices()?.[kind];
    const previous = settings.effective[kind];
    const fallback = available?.has(DEFAULT_DEVICE)
      ? DEFAULT_DEVICE
      : available?.keys().next().value;
    const target = id === DEFAULT_DEVICE ? fallback : id;
    const currentOperation = () => attempt === current && device === binding;
    const apply = async (deviceId: string) => {
      if (kind === 'output') {
        await audio.speakerDevices.set(deviceId);
        if (currentOperation()) binding.outputUnconfirmed = false;
        return;
      }
      const streamsBefore = new Set(current.streams);
      try {
        await audio.setInputDevice(deviceId);
      } catch (error) {
        for (const stream of current.streams) {
          if (!streamsBefore.has(stream) && stream !== audio.inputStream) {
            stopStream(stream);
            current.streams.delete(stream);
          }
        }
        throw error;
      }
    };

    if (!target || !available?.has(target)) {
      setIssue(kind, 'unavailable');
      return false;
    }

    try {
      await apply(target);
      if (currentOperation() && !available.has(target)) {
        throw new DOMException('', 'NotFoundError');
      }
      return currentOperation();
    } catch (error) {
      if (!currentOperation()) return false;
      setIssue(kind, getVoiceAudioIssue(error));
      const call = current.getCall();
      const track = call?.getLocalStream?.()?.getAudioTracks()[0];
      if (kind === 'output') binding.outputUnconfirmed = true;
      // The SDK can stop its default track before replaceTrack rejects.
      const recovery =
        call &&
        (kind === 'output' ||
          track?.readyState === 'ended' ||
          !available.has(target))
          ? previous && available.has(previous)
            ? previous
            : fallback
          : undefined;
      if (recovery || (kind === 'input' && call && !audio.inputDevice)) {
        try {
          if (recovery) await apply(recovery);
          else binding.retireAfterCall = true;
        } catch {
          if (currentOperation()) {
            binding.retireAfterCall = true;
            if (kind === 'output') binding.outputUnconfirmed = true;
          }
        }
      }
      return false;
    }
  };

  const switchDevice = async (
    kind: VoiceAudioKind,
    id: string,
    savePreference: boolean,
  ) => {
    const current = attempt;
    update({ pending: { ...settings.pending, [kind]: true } });
    const operation = (async () => {
      if (await applySelection(kind, id)) {
        if (savePreference) save(kind, id);
        else setIssue(kind, 'fallback');
      } else if (!savePreference && attempt === current) {
        setIssue(kind, 'lost');
      }
    })();
    operations[kind] = operation;
    try {
      await operation;
    } finally {
      if (operations[kind] === operation) operations[kind] = null;
      if (attempt === current) {
        refreshEffective();
        update({ pending: { ...settings.pending, [kind]: false } });
      }
    }
  };

  const restoreOutput = async (binding: VoiceAudioDevice) => {
    const current = attempt;
    await operations.output;
    if (
      attempt !== current ||
      device !== binding ||
      !binding.outputUnconfirmed ||
      operations.output
    )
      return;
    await switchDevice('output', DEFAULT_DEVICE, false);
  };

  const select = async (kind: VoiceAudioKind, id: string) => {
    if (!settings.supported[kind] || operations[kind]) return;
    if (!attempt) {
      if (
        id !== DEFAULT_DEVICE &&
        !settings.devices[kind].some((entry) => entry.deviceId === id)
      )
        return;
      save(kind, id);
      setIssue(kind);
      return;
    }
    if (attempt.getCall()?.status() !== 'open') return;

    setIssue(kind);
    await switchDevice(kind, id, true);
  };

  const prepare = async (
    signal: AbortSignal,
    getCall: AudioAttempt['getCall'],
  ) => {
    await releasing;
    if (signal.aborted || !device) return;

    const current: AudioAttempt = { getCall, streams: new Set() };
    attempt = current;
    // The helper enumerates independently on construction. Wait briefly for
    // its inventory when there is a saved selection to apply.
    if (
      AUDIO_KINDS.some(
        (kind) =>
          settings.supported[kind] &&
          settings.preferences[kind] !== DEFAULT_DEVICE &&
          !sdkDevices()?.[kind].has(settings.preferences[kind]),
      )
    ) {
      const audio = device.audio;
      await new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          audio.off('deviceChange', done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = window.setTimeout(done, 500);
        audio.on('deviceChange', done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
    if (attempt !== current || signal.aborted) return;
    for (const kind of AUDIO_KINDS) {
      if (attempt !== current || signal.aborted) return;
      if (!settings.supported[kind]) continue;
      const preferred = settings.preferences[kind];
      if (kind === 'input' && preferred === DEFAULT_DEVICE) continue;
      const available = sdkDevices()?.[kind];
      if (!available?.size) {
        if (preferred !== DEFAULT_DEVICE) setIssue(kind, 'unavailable');
        continue;
      }
      const valid = preferred === DEFAULT_DEVICE || available.has(preferred);
      const applied =
        (valid || kind === 'output') &&
        (await applySelection(kind, valid ? preferred : DEFAULT_DEVICE));
      if (attempt !== current) return;
      if (!valid) setIssue(kind, applied ? 'fallback' : 'unavailable');
      if (
        !applied &&
        kind === 'output' &&
        valid &&
        preferred !== DEFAULT_DEVICE
      ) {
        if (await applySelection(kind, DEFAULT_DEVICE)) {
          setIssue(kind, 'fallback');
        }
      }
    }
  };

  const end = (destroyDevice: boolean) => {
    const current = attempt;
    const binding = device;
    attempt = null;
    window.clearTimeout(refreshTimer);
    for (const stream of current?.streams ?? []) stopStream(stream);
    const needsDestroy =
      !!binding &&
      (binding.retireAfterCall ||
        binding.pendingCaptures > 0 ||
        operations.input !== null ||
        operations.output !== null);
    operations.input = null;
    operations.output = null;
    if (binding && (destroyDevice || needsDestroy)) {
      binding.unbind();
      device = null;
      update({ supported: getBrowserSupport() });
    } else if (
      binding &&
      current &&
      typeof binding.audio.unsetInputDevice === 'function'
    ) {
      releasing = binding.audio.unsetInputDevice().catch(() => {
        binding.retireAfterCall = true;
      });
    }
    update({
      effective: { input: null, output: null },
      pending: { input: false, output: false },
      issues: {},
    });
    return needsDestroy;
  };

  const watch = () => {
    watching = true;
    publish(settings);
    const mediaDevices = navigator.mediaDevices;
    const onDeviceChange = () => {
      if (!device) void refreshBrowserDevices();
    };
    mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    void refreshBrowserDevices();
    return () => {
      watching = false;
      enumeration++;
      mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  };

  return {
    attach,
    canReuseDevice: async () => {
      await releasing;
      return !device?.retireAfterCall;
    },
    checkMicrophone,
    createCapture,
    end,
    getSettings: () => settings,
    prepare,
    refreshEffective,
    select,
    watch,
  };
};

export type VoiceAudio = ReturnType<typeof createVoiceAudio>;
