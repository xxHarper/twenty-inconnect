import {
  lookupVoiceNumber,
  VoiceApiError,
  type VoiceLookup,
} from '@/inconnect-voice/utils/voiceApi';
import { atom, useStore } from 'jotai';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { useCallback, useEffect, useState } from 'react';
import { normalizePhoneIdentity } from 'twenty-shared/utils';

const LOOKUP_DEBOUNCE_MS = 500;
const LOOKUP_INTERVAL_MS = 1_000;

const getDestination = (input: string) => {
  if (input.length > 64 || !/^\+?[0-9\s()-]+$/.test(input.trim())) return null;

  // MX is Voice's default for national numbers. The server still parses the original input.
  const identity = normalizePhoneIdentity(input, { defaultCountry: 'MX' });
  if (identity === null) return null;
  const phone = parsePhoneNumberFromString(identity);
  return phone?.country !== undefined && phone.isValid() ? phone.number : null;
};

type LookupState =
  | { status: 'idle' | 'loading' | 'invalid' | 'failed' | 'throttled' }
  | { status: 'found'; data: VoiceLookup; recordId: string | null };

type LookupRuntime = {
  raw: string;
  destination: string | null;
  controller: AbortController | null;
  timer: number | undefined;
  lastRequestAt: number;
};

export const useVoiceDialLookup = () => {
  const [number, setNumber] = useState('');
  const [revision, setRevision] = useState(0);
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const store = useStore();
  const [runtime] = useState(() =>
    atom<LookupRuntime>({
      raw: '',
      destination: null,
      controller: null,
      timer: undefined,
      lastRequestAt: -Infinity,
    }),
  );

  const cancel = useCallback(() => {
    const { timer, controller } = store.get(runtime);
    window.clearTimeout(timer);
    controller?.abort();
  }, [runtime, store]);

  const editNumber = (raw: string, fresh = false) => {
    const destination = getDestination(raw);
    const changed = store.get(runtime).destination !== destination;
    store.set(runtime, (previous) => ({ ...previous, raw, destination }));
    setNumber(raw);

    if (changed || fresh || !destination) {
      cancel();
      setLookup({
        status: destination ? 'loading' : raw.trim() ? 'invalid' : 'idle',
      });
      setRevision((previous) => previous + 1);
    }
  };

  const schedule = useCallback(
    (delay: number, previous?: VoiceLookup) => {
      const { destination, lastRequestAt } = store.get(runtime);
      if (!destination) return;
      const abort = new AbortController();
      const timer = window.setTimeout(
        async () => {
          store.set(runtime, (previous) => ({
            ...previous,
            lastRequestAt: Date.now(),
          }));
          const signal = AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(12_000),
          ]);
          try {
            const data = await lookupVoiceNumber(
              store.get(runtime).raw,
              signal,
              previous?.next ?? undefined,
            );
            signal.throwIfAborted();
            if (data.destination !== destination) {
              setLookup({ status: 'failed' });
              return;
            }
            const candidates = previous
              ? [...previous.candidates, ...data.candidates]
              : data.candidates;
            setLookup({
              status: 'found',
              data: { ...data, candidates },
              recordId:
                !previous && candidates.length === 1 && !data.next
                  ? candidates[0].recordId
                  : null,
            });
          } catch (error) {
            if (abort.signal.aborted) return;
            setLookup({
              status:
                error instanceof VoiceApiError && error.status === 429
                  ? 'throttled'
                  : 'failed',
            });
          }
        },
        Math.max(delay, lastRequestAt + LOOKUP_INTERVAL_MS - Date.now()),
      );
      store.set(runtime, (current) => ({
        ...current,
        timer,
        controller: abort,
      }));
    },
    [runtime, store],
  );

  useEffect(() => {
    schedule(LOOKUP_DEBOUNCE_MS);
    return cancel;
  }, [cancel, revision, schedule]);

  const select = (recordId: string) => {
    setLookup((previous) =>
      previous.status === 'found' ? { ...previous, recordId } : previous,
    );
  };

  const loadMore = () => {
    if (lookup.status !== 'found' || !lookup.data.next) return;
    cancel();
    setLookup({ status: 'loading' });
    schedule(0, lookup.data);
  };

  return { number, lookup, editNumber, select, loadMore };
};
