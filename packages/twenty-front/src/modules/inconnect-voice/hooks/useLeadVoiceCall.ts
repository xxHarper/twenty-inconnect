import {
  createManualVoiceSession,
  createVoiceSession,
  getVoiceStatus,
  getVoiceInboundOffer,
  type VoiceInboundOffer,
  type VoiceAvailability,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { useVoiceInboundRegistration } from '@/inconnect-voice/hooks/useVoiceInboundRegistration';
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
  | 'incoming'
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
  inboundSessionId?: string;
  deciding?: boolean;
  sendingDigit?: boolean;
  digitFailed?: boolean;
};

type VoiceDevice = {
  instance: Device;
  inboundSessionId?: string;
  unbind: () => void;
  retireAfterCall?: true;
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

export const useLeadVoiceCall = (
  isOpen: boolean,
  audioScope = '',
  onIncomingOffer?: () => void,
) => {
  const [availability, setAvailability] =
    useState<VoiceAvailability>('loading');
  const [snapshot, setSnapshot] = useState<VoiceCallSnapshot>(idleCall);
  const [audioSettings, setAudioSettings] = useState<VoiceAudioSettings | null>(
    null,
  );
  const [audio] = useState(() =>
    createVoiceAudio(audioScope, setAudioSettings),
  );
  const [inboundOffer, setInboundOffer] = useState<VoiceInboundOffer | null>(
    null,
  );
  const [tracking, setTracking] = useState<{
    callId: string;
    recordId: string | null;
    manual?: true;
    inboundSessionId?: string;
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

      const retireDevice = destroyDevice || device?.retireAfterCall === true;
      const retireAudioDevice = audio.end(retireDevice);
      if ((retireDevice || retireAudioDevice) && device) {
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
    if (providerProgress?.progress.status !== 'finished') return;
    const current = readRuntime().attempt;
    if (
      !current?.inboundSessionId ||
      current.intentId !== providerProgress.progress.id ||
      !current.call
    )
      return;
    const call = current.call;
    try {
      if (call.status() === 'pending') call.reject();
      else if (call.status() !== 'closed') call.disconnect();
    } catch {
      finish('disconnected', true);
      return;
    }
    if (readRuntime().attempt === current) finish('disconnected', false);
  }, [finish, providerProgress, readRuntime]);

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
      const { attempt, device } = readRuntime();
      if (
        status !== 'ready' &&
        !attempt?.inboundSessionId &&
        (attempt || !device?.inboundSessionId)
      )
        revokeAuthorization();
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
    setInboundOffer(null);
    setDisplayedCallId(null);
    return true;
  };

  const fail = (error: unknown) => {
    const { attempt, device } = readRuntime();
    if (attempt) {
      // A rejected outgoing reservation has not started an SDK call on the registered device.
      const keepRegistration =
        Boolean(device?.inboundSessionId) &&
        (attempt.stage !== 'connection' || attempt.call?.status() === 'closed');
      finish(getFailureState(error), !keepRegistration, {
        stage: attempt.stage,
        code: getFailureCode(error),
      });
    }
  };

  const hangUp = () => {
    const attempt = readRuntime().attempt;
    if (
      !attempt ||
      attempt.ending ||
      (attempt.inboundSessionId &&
        !attempt.sdkOpen &&
        snapshot.state === 'incoming')
    )
      return;

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
    (availability === 'ready' || Boolean(inboundOffer)) &&
    snapshot.state === 'active' &&
    activeProgress?.progress.status === 'answered';

  const sendDigit = (digit: string) => {
    const { attempt, availability } = readRuntime();
    if (
      digit.length !== 1 ||
      !'0123456789*#'.includes(digit) ||
      (availability !== 'ready' && !attempt?.inboundSessionId) ||
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

  const attachDevice = (
    TwilioDevice: typeof Device,
    token: string,
    inboundSessionId?: string,
  ) => {
    const capture = audio.createCapture();
    const instance = new TwilioDevice(token, {
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
        inboundSessionId,
        unbind: () => instance.off('error', onError),
      },
    });
    audio.attach(instance, capture);
    return instance;
  };

  const bindCall = (attempt: VoiceAttempt, call: Call) => {
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
    if (status === 'closed') onEnd();
    else if (status === 'open') connectAudio();
    else if (status === 'ringing') onRinging();
    else if (status === 'reconnecting') onReconnecting();
  };

  const receive = async (call: Call, sessionId: string) => {
    const id = call.customParameters.get('inconnectVoiceCallId');
    if (!id || readRuntime().attempt || !readRuntime().mounted) {
      call.reject();
      return;
    }

    const attempt: VoiceAttempt = {
      abort: new AbortController(),
      stage: 'connection',
      intentId: id,
      inboundSessionId: sessionId,
    };
    writeRuntime({ attempt });
    bindCall(attempt, call);
    if (readRuntime().attempt !== attempt) return;

    try {
      const offer = await getVoiceInboundOffer(
        id,
        sessionId,
        AbortSignal.any([attempt.abort.signal, AbortSignal.timeout(5_000)]),
      );
      if (readRuntime().attempt !== attempt) return;
      if (offer.status !== 'ringing') {
        call.reject();
        if (readRuntime().attempt === attempt) finish('disconnected', false);
        return;
      }
      setInboundOffer(offer);
      setDisplayedCallId(id);
      setTracking({
        callId: id,
        recordId: offer.recordId,
        inboundSessionId: sessionId,
        deadline: performance.now() + 8 * 60_000,
      });
      setSnapshot({
        ...idleCall,
        busy: true,
        state: 'incoming',
        destination: offer.number,
      });
      onIncomingOffer?.();
    } catch {
      if (readRuntime().attempt === attempt) {
        call.reject();
        if (readRuntime().attempt === attempt) finish('unauthorized', false);
      }
    }
  };

  const inbound = useVoiceInboundRegistration({
    isOpen,
    attachDevice: async (token, sessionId) => {
      const { Device: TwilioDevice, Logger } =
        await import('@twilio/voice-sdk');
      if (!readRuntime().mounted || readRuntime().attempt) return null;
      Logger.setLevel('silent', false);
      release(true);
      return attachDevice(TwilioDevice, token, sessionId);
    },
    onIncoming: (call, sessionId) => void receive(call, sessionId),
    onRetire: (device) => {
      const current = readRuntime();
      if (current.device?.instance !== device) return;
      if (current.attempt?.inboundSessionId) finish('unauthorized', true);
      else if (!current.attempt) release(true);
      else {
        current.device.retireAfterCall = true;
        void device.unregister().catch(() => undefined);
      }
    },
  });

  const decideInbound = async (action: 'accept' | 'decline') => {
    const attempt = readRuntime().attempt;
    if (
      !attempt?.inboundSessionId ||
      !attempt.intentId ||
      !attempt.call ||
      attempt.deciding ||
      snapshot.state !== 'incoming'
    )
      return;
    attempt.deciding = true;
    const call = attempt.call;
    const isCurrent = () => readRuntime().attempt === attempt;
    setSnapshot((previous) => ({
      ...previous,
      state: action === 'accept' ? 'connecting' : 'ending',
    }));

    try {
      const signal = AbortSignal.any([
        attempt.abort.signal,
        AbortSignal.timeout(8_000),
      ]);
      if (action === 'accept') await audio.prepare(signal, () => call);
      if (!isCurrent()) return;
      signal.throwIfAborted();
      const progress = await getVoiceInboundOffer(
        attempt.intentId,
        attempt.inboundSessionId,
        signal,
        action,
      );
      if (!isCurrent()) return;
      if (progress.status !== 'ringing' || action === 'decline') {
        call.reject();
        if (isCurrent()) finish('disconnected', false);
        return;
      }
      attempt.timeout = window.setTimeout(
        () => finish('timeout', true, { stage: 'connection' }),
        PREPARATION_TIMEOUT_MS,
      );
      call.accept();
    } catch (error) {
      if (!isCurrent()) return;
      call.reject();
      if (isCurrent())
        finish(getFailureState(error), false, {
          stage: 'connection',
          code: getFailureCode(error),
        });
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
    setInboundOffer(null);
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
      const { Device: TwilioDevice, Logger } =
        await import('@twilio/voice-sdk');
      if (!isCurrent()) return;
      // The SDK's debug logger receives the original DTMF value.
      Logger.setLevel('silent', false);

      beginStage('session', 'preparing');
      const inboundSessionId = readRuntime().device?.inboundSessionId;
      const inboundArgument = inboundSessionId ? [inboundSessionId] : [];
      const session = manual
        ? await createManualVoiceSession(
            expectedDestination,
            recordId,
            attempt.abort.signal,
            ...inboundArgument,
          )
        : recordId
          ? await createVoiceSession(
              recordId,
              attempt.abort.signal,
              ...inboundArgument,
            )
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
        if (inboundSessionId) return finish('error', true, { stage: 'sdk' });
        device = attachDevice(TwilioDevice, session.token);
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

      bindCall(attempt, call);
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
    inbound,
    inboundOffer: activeProgress?.offer ?? inboundOffer,
    decideInbound,
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
