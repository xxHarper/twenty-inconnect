import {
  getVoiceInboundAccess,
  setVoiceInboundPreference,
  type VoiceInboundPreference,
  startVoiceInboundSession,
  updateVoiceInboundSession,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { type Call, type Device } from '@twilio/voice-sdk';
import { atom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useState } from 'react';

type RegistrationState =
  | 'offline'
  | 'connecting'
  | 'online'
  | 'unavailable'
  | 'disconnecting';
type ActiveRegistration = {
  abort: AbortController;
  sessionId?: string;
  device?: Device;
  detach?: () => void;
  stop?: (state?: RegistrationState, revoke?: boolean) => Promise<void>;
};

type Options = {
  isOpen: boolean;
  canRegister: boolean;
  attachDevice: (token: string, sessionId: string) => Promise<Device | null>;
  onIncoming: (call: Call, sessionId: string) => void;
  onRetire: (device: Device) => void;
};

export const useVoiceInboundRegistration = (options: Options) => {
  const [access, setAccess] = useState<Awaited<
    ReturnType<typeof getVoiceInboundAccess>
  > | null>(null);
  const [preferenceError, setPreferenceError] = useState(false);
  const available = access !== null;
  const [state, setState] = useState<RegistrationState>('offline');
  const store = useStore();
  const [preferenceWriteAtom] = useState(() =>
    atom({ revision: 0, target: null as VoiceInboundPreference | null }),
  );
  const { target: changingPreference } = useAtomValue(preferenceWriteAtom);
  const [registrationAtom] = useState(() =>
    atom<ActiveRegistration | null>(null),
  );
  const [optionsAtom] = useState(() => atom(options));
  const [pendingStartAtom] = useState(() => atom(false));

  useEffect(() => {
    store.set(optionsAtom, options);
  }, [options, optionsAtom, store]);

  useEffect(() => {
    if (!options.isOpen) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const check = async () => {
      const { revision } = store.get(preferenceWriteAtom);
      const mayUpdate = () => {
        const write = store.get(preferenceWriteAtom);
        return (
          !abort.signal.aborted && !write.target && revision === write.revision
        );
      };
      let continuePolling = true;
      try {
        const next = await getVoiceInboundAccess(
          AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
        );
        if (mayUpdate()) {
          setAccess(next);
          if (next.preference === 'offline') {
            if (store.get(pendingStartAtom)) setState('offline');
            store.set(pendingStartAtom, false);
            void store.get(registrationAtom)?.stop?.('offline', false);
          }
        }
        continuePolling = next.preference !== undefined;
      } catch (error) {
        if (mayUpdate()) setAccess(null);
        continuePolling = !(
          error instanceof VoiceApiError && [401, 403].includes(error.status)
        );
      } finally {
        if (continuePolling && !abort.signal.aborted)
          timer = window.setTimeout(check, 4_000);
      }
    };

    void check();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [
    options.isOpen,
    pendingStartAtom,
    preferenceWriteAtom,
    registrationAtom,
    store,
  ]);

  useEffect(
    () => () => {
      void store.get(registrationAtom)?.stop?.();
    },
    [registrationAtom, store],
  );

  const start = useCallback(async () => {
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
        return false;
      }
      return true;
    };

    const stop = async (next: RegistrationState = 'offline', revoke = true) => {
      if (!isCurrent()) return;
      store.set(registrationAtom, null);
      window.clearTimeout(timer);
      current.abort.abort();
      current.detach?.();
      const id = current.sessionId;
      if (revoke && id) setState('disconnecting');
      if (current.device) store.get(optionsAtom).onRetire(current.device);
      // An in-flight heartbeat must not supersede the final stop operation.
      const acknowledged =
        !revoke || !id || (await chain.then(() => closeLease(id)));
      if (!store.get(registrationAtom))
        setState(acknowledged ? next : 'unavailable');
    };
    current.stop = stop;
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
        void stop('unavailable');
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
              void stop('unavailable');
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
      const onDestroyed = () => void stop('unavailable');
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
      void stop('unavailable');
    }
  }, [available, optionsAtom, registrationAtom, store]);

  useEffect(() => {
    if (options.canRegister && store.get(pendingStartAtom)) {
      store.set(pendingStartAtom, false);
      void start();
    }
  }, [options.canRegister, pendingStartAtom, start, store]);

  const changePreference = async (preference: VoiceInboundPreference) => {
    const write = store.get(preferenceWriteAtom);
    if (write.target) return;
    store.set(preferenceWriteAtom, {
      revision: write.revision + 1,
      target: preference,
    });
    setPreferenceError(false);
    try {
      const next = await setVoiceInboundPreference(
        preference,
        AbortSignal.timeout(5_000),
      );
      setAccess(next);
      if (preference !== 'available' && store.get(pendingStartAtom)) {
        store.set(pendingStartAtom, false);
        setState('offline');
      }
      if (preference === 'offline')
        await store.get(registrationAtom)?.stop?.('offline', false);
      if (preference === 'available' && !next.registered) {
        if (store.get(optionsAtom).canRegister) await start();
        else {
          store.set(pendingStartAtom, true);
          setState('connecting');
        }
      }
    } catch {
      setPreferenceError(true);
    } finally {
      store.set(preferenceWriteAtom, {
        revision: write.revision + 2,
        target: null,
      });
    }
  };

  return {
    available,
    preference: access?.preference,
    effective: access?.effective,
    registered: access?.registered,
    changePreference,
    changingPreference,
    preferenceError,
    state,
    start,
    stop: () => void store.get(registrationAtom)?.stop?.(),
  };
};
