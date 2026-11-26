import {
  getVoiceInboundAccess,
  startVoiceInboundSession,
  updateVoiceInboundSession,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { type Call, type Device } from '@twilio/voice-sdk';
import { atom, useStore } from 'jotai';
import { useEffect, useState } from 'react';

type RegistrationState = 'offline' | 'connecting' | 'online' | 'unavailable';
type ActiveRegistration = {
  abort: AbortController;
  sessionId?: string;
  device?: Device;
  detach?: () => void;
  stop?: () => void;
};

type Options = {
  isOpen: boolean;
  attachDevice: (token: string, sessionId: string) => Promise<Device | null>;
  onIncoming: (call: Call, sessionId: string) => void;
  onRetire: (device: Device) => void;
};

export const useVoiceInboundRegistration = (options: Options) => {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<RegistrationState>('offline');
  const store = useStore();
  const [registrationAtom] = useState(() =>
    atom<ActiveRegistration | null>(null),
  );
  const [optionsAtom] = useState(() => atom(options));

  useEffect(() => {
    store.set(optionsAtom, options);
  }, [options, optionsAtom, store]);

  useEffect(() => {
    if (!options.isOpen) return;
    const abort = new AbortController();
    const check = async () => {
      try {
        await getVoiceInboundAccess(
          AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
        );
        if (!abort.signal.aborted) setAvailable(true);
      } catch {
        if (!abort.signal.aborted) setAvailable(false);
      }
    };

    void check();
    return () => abort.abort();
  }, [options.isOpen]);

  useEffect(
    () => () => {
      store.get(registrationAtom)?.stop?.();
    },
    [registrationAtom, store],
  );

  const start = async () => {
    if (!available || store.get(registrationAtom)) return;
    const current: ActiveRegistration = { abort: new AbortController() };
    store.set(registrationAtom, current);
    const isCurrent = () => store.get(registrationAtom) === current;
    let timer: number | undefined;
    let chain = Promise.resolve();
    let refresh = false;

    const closeLease = async (id: string) => {
      try {
        await updateVoiceInboundSession(
          id,
          'stop',
          false,
          AbortSignal.timeout(4_000),
        );
      } catch {
        // The bounded lease still expires if the tab cannot report shutdown.
      }
    };

    const stop = (next: RegistrationState) => {
      if (!isCurrent()) return;
      store.set(registrationAtom, null);
      window.clearTimeout(timer);
      current.abort.abort();
      current.detach?.();
      // Serialize shutdown behind any in-flight lease mutation.
      const id = current.sessionId;
      if (id) void chain.then(() => closeLease(id));
      if (current.device) store.get(optionsAtom).onRetire(current.device);
      setState(next);
    };
    current.stop = () => stop('offline');
    setState('connecting');

    try {
      const { id, token } = await startVoiceInboundSession(
        AbortSignal.any([current.abort.signal, AbortSignal.timeout(6_000)]),
      );
      if (!isCurrent()) {
        void closeLease(id);
        return;
      }
      current.sessionId = id;
      const device = await store.get(optionsAtom).attachDevice(token, id);
      if (!device) {
        stop('unavailable');
        return;
      }
      if (!isCurrent()) {
        store.get(optionsAtom).onRetire(device);
        return;
      }
      current.device = device;

      const schedule = (delay: number) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(sync, delay);
      };
      const sync = () => {
        if (!isCurrent()) return;
        chain = chain.then(async () => {
          if (!isCurrent()) return;
          const registered = device.state === 'registered';
          const shouldRefresh = refresh;
          refresh = false;
          try {
            const result = await updateVoiceInboundSession(
              id,
              registered ? 'registered' : 'offline',
              shouldRefresh,
              AbortSignal.any([
                current.abort.signal,
                AbortSignal.timeout(5_000),
              ]),
            );
            if (!isCurrent()) return;
            if (result.token) device.updateToken(result.token);
            if (registered && device.state === 'registered') {
              setState('online');
              schedule(10_000);
            } else {
              setState('connecting');
              schedule(3_000);
              if (device.state === 'unregistered') {
                void device.register().catch(() => {
                  if (isCurrent()) {
                    refresh = true;
                    schedule(3_000);
                  }
                });
              }
            }
          } catch (error) {
            if (!isCurrent()) return;
            if (
              error instanceof VoiceApiError &&
              [401, 403, 409].includes(error.status)
            ) {
              stop('unavailable');
              return;
            }
            refresh ||= shouldRefresh;
            setState('connecting');
            schedule(3_000);
          }
        });
      };
      const onRegistered = () => sync();
      const onUnregistered = () => {
        if (!isCurrent()) return;
        setState('connecting');
        sync();
      };
      const onTokenWillExpire = () => {
        refresh = true;
        sync();
      };
      const onIncoming = (call: Call) => {
        if (isCurrent()) store.get(optionsAtom).onIncoming(call, id);
      };
      const onDestroyed = () => stop('unavailable');
      device.on('registered', onRegistered);
      device.on('unregistered', onUnregistered);
      device.on('tokenWillExpire', onTokenWillExpire);
      device.on('incoming', onIncoming);
      device.on('destroyed', onDestroyed);
      current.detach = () => {
        device.off('registered', onRegistered);
        device.off('unregistered', onUnregistered);
        device.off('tokenWillExpire', onTokenWillExpire);
        device.off('incoming', onIncoming);
        device.off('destroyed', onDestroyed);
      };
      // Register opens signaling. Microphone capture begins when a call is accepted.
      void device.register().catch(() => {
        if (isCurrent()) {
          refresh = true;
          schedule(3_000);
        }
      });
      schedule(3_000);
    } catch {
      stop('unavailable');
    }
  };

  return {
    available,
    state,
    start,
    stop: () => store.get(registrationAtom)?.stop?.(),
  };
};
