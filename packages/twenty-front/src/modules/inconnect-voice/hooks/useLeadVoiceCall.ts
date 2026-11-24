import {
  createVoiceSession,
  getVoiceStatus,
  type VoiceAvailability,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { type Device } from '@twilio/voice-sdk';
import { atom, useStore } from 'jotai';
import { useCallback, useEffect, useState } from 'react';

export type VoiceCallState =
  | 'idle'
  | 'checking-microphone'
  | 'loading-sdk'
  | 'preparing'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'reconnecting'
  | 'disconnected'
  | 'microphone-unavailable'
  | 'microphone-denied'
  | 'expired'
  | 'unauthorized'
  | 'destination-changed'
  | 'timeout'
  | 'error';

const PREPARATION_TIMEOUT_MS = 20_000;

type VoiceStage = 'microphone' | 'sdk' | 'session' | 'connection';

type VoiceFailure = {
  stage: VoiceStage;
  code?: number;
};

type VoiceAttempt = {
  abort: AbortController;
  stage: VoiceStage;
  timeout?: number;
  device?: Device;
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

export const useLeadVoiceCall = (recordId: string) => {
  const [availability, setAvailability] =
    useState<VoiceAvailability>('loading');
  const [state, setState] = useState<VoiceCallState>('idle');
  const [tokenExpiring, setTokenExpiring] = useState(false);
  const [failure, setFailure] = useState<VoiceFailure | null>(null);
  const [attemptAtom] = useState(() => atom<VoiceAttempt | null>(null));
  const store = useStore();

  const release = useCallback(() => {
    const attempt = store.get(attemptAtom);
    store.set(attemptAtom, null);
    window.clearTimeout(attempt?.timeout);
    attempt?.abort.abort();
    attempt?.device?.destroy();
  }, [attemptAtom, store]);

  useEffect(() => {
    const abort = new AbortController();
    void getVoiceStatus(abort.signal).then(
      (status) => {
        if (!abort.signal.aborted) setAvailability(status);
      },
      () => {
        if (!abort.signal.aborted) setAvailability('unavailable');
      },
    );

    return () => {
      abort.abort();
      release();
    };
  }, [recordId, release]);

  const hangUp = () => {
    release();
    setTokenExpiring(false);
    setFailure(null);
    setState('disconnected');
  };

  const placeCall = async (expectedDestination: string) => {
    if (availability !== 'ready' || store.get(attemptAtom)) return;
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setState('microphone-unavailable');
      return;
    }

    const attempt: VoiceAttempt = {
      abort: new AbortController(),
      stage: 'microphone',
    };
    store.set(attemptAtom, attempt);
    setFailure(null);

    const isCurrent = () => store.get(attemptAtom) === attempt;
    const update = (nextState: VoiceCallState) => {
      if (!isCurrent()) return;
      window.clearTimeout(attempt.timeout);
      setState(nextState);
    };
    const finish = (
      nextState: VoiceCallState,
      diagnostic: VoiceFailure | null = null,
    ) => {
      if (!isCurrent()) return;
      release();
      setTokenExpiring(false);
      setFailure(diagnostic);
      setState(nextState);
    };
    const fail = (error: unknown) => {
      finish(getFailureState(error), {
        stage: attempt.stage,
        code: getFailureCode(error),
      });
    };
    const beginStage = (
      stage: VoiceStage,
      nextState: VoiceCallState,
      timeout = PREPARATION_TIMEOUT_MS,
    ) => {
      update(nextState);
      attempt.stage = stage;
      attempt.timeout = window.setTimeout(
        () => finish('timeout', { stage }),
        timeout,
      );
    };

    try {
      beginStage('microphone', 'checking-microphone');
      // Get permission before issuing the short-lived intent. The SDK
      // acquires its own input stream when it connects.
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      for (const track of microphone.getTracks()) track.stop();
      if (!isCurrent()) return;

      beginStage('sdk', 'loading-sdk');
      const { Call, Device: TwilioDevice } = await import('@twilio/voice-sdk');
      if (!isCurrent()) return;

      beginStage('session', 'preparing');
      const session = await createVoiceSession(recordId, attempt.abort.signal);
      if (!isCurrent()) return;
      if (session.destination !== expectedDestination)
        return finish('destination-changed');
      if (session.intentExpiresAt <= Date.now()) return finish('expired');

      attempt.stage = 'sdk';
      const device = new TwilioDevice(session.token, {
        enableImprovedSignalingErrorPrecision: true,
        logLevel: 'silent',
      });
      attempt.device = device;
      device.on('error', fail);
      device.on('tokenWillExpire', () => {
        if (isCurrent()) setTokenExpiring(true);
      });

      const remaining = session.intentExpiresAt - Date.now();
      if (remaining <= 0) return finish('expired');
      beginStage('connection', 'connecting', remaining);
      const call = await device.connect({
        params: { intentId: session.intentId },
      });
      if (!isCurrent()) {
        call.disconnect();
        return;
      }

      call.on('ringing', () => update('ringing'));
      call.on('accept', () => update('active'));
      call.on('reconnecting', () => update('reconnecting'));
      call.on('reconnected', () => update('active'));
      call.on('disconnect', () => finish('disconnected'));
      call.on('cancel', () => finish('disconnected'));
      call.on('reject', () => finish('disconnected'));
      call.on('error', fail);

      const status = call.status();
      if (status === Call.State.Closed) finish('disconnected');
      else if (status === Call.State.Open) update('active');
      else if (status === Call.State.Ringing) update('ringing');
    } catch (error) {
      fail(error);
    }
  };

  return { availability, state, failure, tokenExpiring, hangUp, placeCall };
};
