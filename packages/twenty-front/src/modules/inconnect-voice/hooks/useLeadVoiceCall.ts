import {
  createManualVoiceSession,
  createVoiceSession,
  getVoiceStatus,
  type VoiceAvailability,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { useVoiceProviderProgress } from '@/inconnect-voice/hooks/useVoiceProviderProgress';
import { createVoiceAudio } from '@/inconnect-voice/utils/createVoiceAudio';
import {
  getVoiceAudioIssue,
  type VoiceAudioSettings,
} from '@/inconnect-voice/utils/voiceAudioPreferences';
import { type Call, type Device } from '@twilio/voice-sdk';
import { atom, useStore } from 'jotai';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export type VoiceCallState =
  | 'idle'
  | 'checking-microphone'
  | 'loading-sdk'
  | 'preparing'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'reconnecting'
  | 'ending'
  | 'disconnected'
  | 'microphone-unavailable'
  | 'microphone-denied'
  | 'microphone-missing'
  | 'microphone-failed'
  | 'expired'
  | 'unauthorized'
  | 'destination-changed'
  | 'conflict'
  | 'timeout'
  | 'error';

export const VOICE_AUTHORIZATION_CHECK_MS = 15_000;
const PREPARATION_TIMEOUT_MS = 20_000;
const HANGUP_TIMEOUT_MS = 5_000;

type VoiceStage = 'microphone' | 'sdk' | 'session' | 'connection';

type VoiceFailure = {
  stage: VoiceStage;
  code?: number;
};

type VoiceCallSnapshot = {
  state: VoiceCallState;
  busy: boolean;
  canMute: boolean;
  muted: boolean;
  connectedAt: number | null;
  endedAt: number | null;
  destination: string | null;
  failure: VoiceFailure | null;
};

const idleCall: VoiceCallSnapshot = {
  state: 'idle',
  busy: false,
  canMute: false,
  muted: false,
  connectedAt: null,
  endedAt: null,
  destination: null,
  failure: null,
};

type VoiceAttempt = {
  abort: AbortController;
  stage: VoiceStage;
  timeout?: number;
  call?: Call;
  unbind?: () => void;
  ending?: boolean;
  sdkOpen?: boolean;
  intentId?: string;
  sendingDigit?: boolean;
  digitFailed?: boolean;
};

type VoiceDevice = {
  instance: Device;
  unbind: () => void;
};

const getFailureCode = (error: unknown): number | undefined => {
  if (error instanceof VoiceApiError) return error.status;

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number' &&
    Number.isInteger(error.code) &&
    error.code >= 10_000 &&
    error.code <= 99_999
  )
    return error.code;

  return undefined;
};

const getFailureState = (error: unknown): VoiceCallState => {
  if (error instanceof VoiceApiError && error.status === 409) return 'conflict';
  if (
    error instanceof VoiceApiError &&
    (error.status === 401 || error.status === 403)
  )
    return 'unauthorized';
  if (typeof error === 'object' && error !== null) {
    if (
      ('name' in error && error.name === 'NotAllowedError') ||
      ('code' in error && error.code === 31401)
    )
      return 'microphone-denied';
    if ('code' in error && (error.code === 20104 || error.code === 31205))
      return 'expired';
  }

  return 'error';
};

export const useLeadVoiceCall = (isOpen: boolean, audioScope = '') => {
  const [availability, setAvailability] =
    useState<VoiceAvailability>('loading');
  const [snapshot, setSnapshot] = useState<VoiceCallSnapshot>(idleCall);
  const [audioSettings, setAudioSettings] = useState<VoiceAudioSettings | null>(
    null,
  );
  const [audio] = useState(() =>
    createVoiceAudio(audioScope, setAudioSettings),
  );
  const [tracking, setTracking] = useState<{
    callId: string;
    recordId: string | null;
    manual?: true;
    deadline: number;
  } | null>(null);
  const [displayedCallId, setDisplayedCallId] = useState<string | null>(null);
  const [runtimeAtom] = useState(() =>
    atom<{
      availability: VoiceAvailability;
      attempt: VoiceAttempt | null;
      device: VoiceDevice | null;
      mounted: boolean;
    }>({
      availability: 'loading',
      attempt: null,
      device: null,
      mounted: false,
    }),
  );
  const store = useStore();
  const readRuntime = useCallback(
    () => store.get(runtimeAtom),
    [runtimeAtom, store],
  );
  const writeRuntime = useCallback(
    (patch: Partial<ReturnType<typeof readRuntime>>) =>
      store.set(runtimeAtom, (previous) => ({ ...previous, ...patch })),
    [runtimeAtom, store],
  );

  const release = useCallback(
    (destroyDevice: boolean) => {
      const { attempt, device } = readRuntime();
      writeRuntime({ attempt: null });
      window.clearTimeout(attempt?.timeout);
      attempt?.abort.abort();
      attempt?.unbind?.();

      const retireAudioDevice = audio.end(destroyDevice);
      if ((destroyDevice || retireAudioDevice) && device) {
        writeRuntime({ device: null });
        device.unbind();
        device.instance.destroy();
      }
    },
    [audio, readRuntime, writeRuntime],
  );

  useLayoutEffect(() => {
    writeRuntime({ mounted: true });

    return () => {
      writeRuntime({ mounted: false });
      release(true);
    };
  }, [release, writeRuntime]);

  const finish = useCallback(
    (
      state: VoiceCallState,
      destroyDevice: boolean,
      failure: VoiceFailure | null = null,
    ) => {
      release(destroyDevice);
      const endedAt = performance.now();
      setSnapshot((previous) => ({
        ...previous,
        state,
        busy: false,
        canMute: false,
        muted: false,
        endedAt,
        destination: null,
        failure,
      }));
    },
    [release],
  );

  const revokeAuthorization = useCallback(() => {
    if (readRuntime().attempt) {
      finish('unauthorized', true);
    } else {
      release(true);
    }
  }, [finish, readRuntime, release]);
  const providerProgress = useVoiceProviderProgress(
    tracking,
    snapshot.busy,
    revokeAuthorization,
  );

  useEffect(() => {
    if (!isOpen) return;

    const abort = new AbortController();
    let nextCheck: number | undefined;
    const check = async () => {
      const request = new AbortController();
      const cancelRequest = () => request.abort();
      abort.signal.addEventListener('abort', cancelRequest, { once: true });
      const timeout = window.setTimeout(
        cancelRequest,
        VOICE_AUTHORIZATION_CHECK_MS,
      );
      let status: VoiceAvailability;
      try {
        status = await getVoiceStatus(request.signal);
        if (request.signal.aborted) status = 'unavailable';
      } catch {
        status = 'unavailable';
      } finally {
        window.clearTimeout(timeout);
        abort.signal.removeEventListener('abort', cancelRequest);
      }
      if (abort.signal.aborted || !readRuntime().mounted) return;
      writeRuntime({ availability: status });
      setAvailability(status);
      if (status !== 'ready') revokeAuthorization();
      nextCheck = window.setTimeout(
        () => void check(),
        VOICE_AUTHORIZATION_CHECK_MS,
      );
    };
    void check();

    return () => {
      abort.abort();
      window.clearTimeout(nextCheck);
      writeRuntime({ availability: 'loading' });
    };
  }, [isOpen, readRuntime, revokeAuthorization, writeRuntime]);

  useEffect(() => {
    if (isOpen) return audio.watch();
  }, [audio, isOpen]);

  const resetCall = () => {
    if (readRuntime().attempt) return false;
    setSnapshot(idleCall);
    setDisplayedCallId(null);
    return true;
  };

  const fail = (error: unknown) => {
    const attempt = readRuntime().attempt;
    if (attempt) {
      finish(getFailureState(error), true, {
        stage: attempt.stage,
        code: getFailureCode(error),
      });
    }
  };

  const hangUp = () => {
    const attempt = readRuntime().attempt;
    if (!attempt || attempt.ending) return;

    attempt.ending = true;
    setSnapshot((previous) => ({
      ...previous,
      state: 'ending',
      canMute: false,
    }));
    if (!attempt.call) {
      // A pending SDK connect must be destroyed so it cannot dial after cancellation.
      finish('disconnected', attempt.stage === 'connection');
      return;
    }

    window.clearTimeout(attempt.timeout);
    attempt.timeout = window.setTimeout(
      () => finish('timeout', true, { stage: 'connection' }),
      HANGUP_TIMEOUT_MS,
    );
    try {
      attempt.call.disconnect();
    } catch (error) {
      fail(error);
    }
  };

  const toggleMute = () => {
    const attempt = readRuntime().attempt;
    if (!attempt?.call || attempt.ending) return;
    try {
      attempt.call.mute(!attempt.call.isMuted());
    } catch (error) {
      fail(error);
    }
  };

  const activeProgress =
    providerProgress?.progress.id === displayedCallId ? providerProgress : null;
  const canSendDigit =
    availability === 'ready' &&
    snapshot.state === 'active' &&
    activeProgress?.progress.status === 'answered';

  const sendDigit = (digit: string) => {
    const { attempt, availability } = readRuntime();
    if (
      digit.length !== 1 ||
      !'0123456789*#'.includes(digit) ||
      availability !== 'ready' ||
      !canSendDigit ||
      !attempt?.call ||
      attempt.intentId !== activeProgress.progress.id ||
      attempt.ending ||
      !attempt.sdkOpen ||
      attempt.call.status() !== 'open'
    ) {
      return 'unavailable';
    }
    attempt.sendingDigit = true;
    attempt.digitFailed = false;
    try {
      attempt.call.sendDigits(digit);
      return attempt.digitFailed ? 'failed' : 'sent';
    } catch {
      return 'failed';
    } finally {
      attempt.sendingDigit = false;
      attempt.digitFailed = false;
    }
  };

  const placeCall = async (
    recordId: string | null,
    expectedDestination: string,
    manual = false,
  ) => {
    if (
      !readRuntime().mounted ||
      readRuntime().availability !== 'ready' ||
      readRuntime().attempt
    )
      return;
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setSnapshot({ ...idleCall, state: 'microphone-unavailable' });
      return;
    }

    const attempt: VoiceAttempt = {
      abort: new AbortController(),
      stage: 'microphone',
    };
    writeRuntime({ attempt });
    setDisplayedCallId(null);
    setSnapshot({
      ...idleCall,
      busy: true,
      state: 'checking-microphone',
      destination: expectedDestination,
    });

    const isCurrent = () => readRuntime().attempt === attempt;
    const update = (state: VoiceCallState) => {
      if (!isCurrent() || attempt.ending) return;
      window.clearTimeout(attempt.timeout);
      setSnapshot((previous) => ({ ...previous, state }));
    };
    const connectAudio = () => {
      if (!isCurrent() || attempt.ending) return;
      attempt.sdkOpen = true;
      audio.refreshEffective();
      window.clearTimeout(attempt.timeout);
      const connectedAt = performance.now();
      setSnapshot((previous) => ({
        ...previous,
        state: 'active',
        canMute: true,
        connectedAt: previous.connectedAt ?? connectedAt,
      }));
    };
    const beginStage = (
      stage: VoiceStage,
      state: VoiceCallState,
      timeout = PREPARATION_TIMEOUT_MS,
    ) => {
      update(state);
      attempt.stage = stage;
      attempt.timeout = window.setTimeout(
        () => finish('timeout', stage === 'connection', { stage }),
        timeout,
      );
    };

    try {
      beginStage('microphone', 'checking-microphone');
      await audio.checkMicrophone();
      if (!isCurrent()) return;

      beginStage('sdk', 'loading-sdk');
      const {
        Call: TwilioCall,
        Device: TwilioDevice,
        Logger,
      } = await import('@twilio/voice-sdk');
      if (!isCurrent()) return;
      // The SDK's debug logger receives the original DTMF value.
      Logger.setLevel('silent', false);

      beginStage('session', 'preparing');
      const session = manual
        ? await createManualVoiceSession(
            expectedDestination,
            recordId,
            attempt.abort.signal,
          )
        : recordId
          ? await createVoiceSession(recordId, attempt.abort.signal)
          : null;
      if (session === null) return finish('unauthorized', true);
      if (!isCurrent()) return;
      attempt.intentId = session.intentId;
      setTracking({
        callId: session.intentId,
        recordId,
        ...(manual ? { manual: true } : {}),
        deadline: performance.now() + 8 * 60_000,
      });
      setDisplayedCallId(session.intentId);
      if (session.destination !== expectedDestination)
        return finish('destination-changed', false);
      if (session.intentExpiresAt <= Date.now())
        return finish('expired', false);

      attempt.stage = 'sdk';
      let retained = readRuntime().device;
      if (retained && !(await audio.canReuseDevice())) {
        if (!isCurrent()) return;
        audio.end(true);
        writeRuntime({ device: null });
        retained.unbind();
        retained.instance.destroy();
        retained = null;
      }
      if (!isCurrent()) return;
      let device: Device;
      if (retained) {
        // Each explicitly authorized dial supplies a fresh token before connecting.
        device = retained.instance;
        device.updateToken(session.token);
      } else {
        const capture = audio.createCapture();
        const instance = new TwilioDevice(session.token, {
          enableImprovedSignalingErrorPrecision: true,
          getUserMedia: capture.getUserMedia,
          logLevel: 'silent',
        });
        const onError = (error: unknown, call?: Call) => {
          const current = readRuntime().attempt;
          if (
            readRuntime().device?.instance === instance &&
            current?.stage === 'connection' &&
            (!call || !current.call || call === current.call)
          ) {
            if (current.sendingDigit) current.digitFailed = true;
            else fail(error);
          }
        };
        instance.on('error', onError);
        writeRuntime({
          device: {
            instance,
            unbind: () => instance.off('error', onError),
          },
        });
        audio.attach(instance, capture);
        device = instance;
      }

      const remaining = session.intentExpiresAt - Date.now();
      if (remaining <= 0) return finish('expired', false);
      beginStage('connection', 'connecting', remaining);
      await audio.prepare(attempt.abort.signal, () => attempt.call);
      if (!isCurrent()) return;
      if (session.intentExpiresAt <= Date.now()) return finish('expired', true);
      const call = await device.connect({
        params: { intentId: session.intentId },
      });
      if (!isCurrent()) {
        call.disconnect();
        return;
      }

      attempt.call = call;
      const onRinging = () => {
        attempt.sdkOpen = false;
        update('ringing');
      };
      const onReconnecting = () => {
        attempt.sdkOpen = false;
        update('reconnecting');
      };
      const onEnd = () => {
        if (isCurrent()) finish('disconnected', false);
      };
      const onError = (error: unknown) => {
        if (!isCurrent()) return;
        if (attempt.sendingDigit) attempt.digitFailed = true;
        else fail(error);
      };
      const onMute = (muted: boolean) => {
        if (isCurrent()) setSnapshot((previous) => ({ ...previous, muted }));
      };

      call.on('ringing', onRinging);
      call.on('accept', connectAudio);
      call.on('reconnecting', onReconnecting);
      call.on('reconnected', connectAudio);
      call.on('disconnect', onEnd);
      call.on('cancel', onEnd);
      call.on('reject', onEnd);
      call.on('error', onError);
      call.on('mute', onMute);
      attempt.unbind = () => {
        call.off('ringing', onRinging);
        call.off('accept', connectAudio);
        call.off('reconnecting', onReconnecting);
        call.off('reconnected', connectAudio);
        call.off('disconnect', onEnd);
        call.off('cancel', onEnd);
        call.off('reject', onEnd);
        call.off('error', onError);
        call.off('mute', onMute);
      };

      const status = call.status();
      if (status === TwilioCall.State.Closed) onEnd();
      else if (status === TwilioCall.State.Open) connectAudio();
      else if (status === TwilioCall.State.Ringing) onRinging();
      else if (status === TwilioCall.State.Reconnecting) onReconnecting();
    } catch (error) {
      if (!isCurrent()) return;
      if (attempt.stage === 'microphone') {
        const issue = getVoiceAudioIssue(error);
        const state = {
          denied: 'microphone-denied',
          unavailable: 'microphone-missing',
          unsupported: 'microphone-unavailable',
          failed: 'microphone-failed',
        } as const;
        finish(state[issue], false, { stage: 'microphone' });
      } else {
        fail(error);
      }
    }
  };

  return {
    availability,
    snapshot,
    providerProgress: activeProgress,
    audioSettings: audioSettings ?? audio.getSettings(),
    selectAudioDevice: audio.select,
    requestMicrophoneAccess: audio.checkMicrophone,
    canSendDigit,
    sendDigit,
    hasProviderAttempt: displayedCallId !== null,
    resetCall,
    hangUp,
    toggleMute,
    placeCall,
    revokeAuthorization,
  };
};
