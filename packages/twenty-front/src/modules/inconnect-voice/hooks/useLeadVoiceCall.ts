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
  | 'error';

type VoiceAttempt = {
  abort: AbortController;
  device?: Device;
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
  const [attemptAtom] = useState(() => atom<VoiceAttempt | null>(null));
  const store = useStore();

  const release = useCallback(() => {
    const attempt = store.get(attemptAtom);
    store.set(attemptAtom, null);
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
    setState('disconnected');
  };

  const placeCall = async (expectedDestination: string) => {
    if (availability !== 'ready' || store.get(attemptAtom)) return;
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setState('microphone-unavailable');
      return;
    }

    const attempt: VoiceAttempt = { abort: new AbortController() };
    store.set(attemptAtom, attempt);
    setState('preparing');

    const isCurrent = () => store.get(attemptAtom) === attempt;
    const update = (nextState: VoiceCallState) => {
      if (isCurrent()) setState(nextState);
    };
    const finish = (nextState: VoiceCallState) => {
      if (!isCurrent()) return;
      release();
      setTokenExpiring(false);
      setState(nextState);
    };
    const fail = (error: unknown) => {
      if (isCurrent() && error instanceof VoiceApiError && error.status === 503)
        setAvailability('disabled');
      finish(getFailureState(error));
    };

    try {
      const session = await createVoiceSession(recordId, attempt.abort.signal);
      if (!isCurrent()) return;
      if (session.destination !== expectedDestination)
        return finish('destination-changed');
      if (session.intentExpiresAt <= Date.now()) return finish('expired');

      const { Call, Device: TwilioDevice } = await import('@twilio/voice-sdk');
      if (!isCurrent()) return;
      if (session.intentExpiresAt <= Date.now()) return finish('expired');

      const device = new TwilioDevice(session.token, {
        enableImprovedSignalingErrorPrecision: true,
        logLevel: 'silent',
      });
      attempt.device = device;
      device.on('error', fail);
      device.on('tokenWillExpire', () => {
        if (isCurrent()) setTokenExpiring(true);
      });
      update('connecting');

      // The outbound-only SDK requests microphone access on this user-initiated connect.
      const call = await device.connect({
        params: { intentId: session.intentId },
      });
      if (!isCurrent()) return;

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

  return { availability, state, tokenExpiring, hangUp, placeCall };
};
