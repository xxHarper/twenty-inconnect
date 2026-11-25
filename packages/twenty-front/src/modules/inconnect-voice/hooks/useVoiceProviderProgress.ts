import {
  getVoiceCallProgress,
  VoiceApiError,
} from '@/inconnect-voice/utils/voiceApi';
import { atom, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

export const voiceHistoryRevisionState = atom<Record<string, number>>({});

type VoiceTracking = {
  callId: string;
  recordId: string;
  deadline: number;
};

export const useVoiceProviderProgress = (
  tracking: VoiceTracking | null,
  locallyBusy: boolean,
) => {
  const [snapshot, setSnapshot] = useState<{
    progress: Awaited<ReturnType<typeof getVoiceCallProgress>>;
    connectedAt: number | null;
  } | null>(null);
  const invalidate = useSetAtom(voiceHistoryRevisionState);

  useEffect(() => {
    if (!tracking) return;

    const abort = new AbortController();
    let next: number | undefined;
    let lastState: string | undefined;
    let cancelReservation = !locallyBusy;
    const poll = async () => {
      const timeout = AbortSignal.timeout(10_000);
      try {
        const progress = await getVoiceCallProgress(
          tracking.recordId,
          tracking.callId,
          AbortSignal.any([abort.signal, timeout]),
          locallyBusy ? undefined : cancelReservation ? 'cancel' : 'reconcile',
        );
        if (abort.signal.aborted) return;
        cancelReservation = false;

        const answeredAt = progress.answeredAt
          ? Date.parse(progress.answeredAt)
          : NaN;
        const startedAt = Number.isFinite(answeredAt)
          ? performance.now() - Math.max(0, progress.observedAt - answeredAt)
          : null;
        setSnapshot((previous) => ({
          progress,
          connectedAt:
            previous?.progress.id === progress.id &&
            previous.progress.answeredAt === progress.answeredAt
              ? previous.connectedAt
              : startedAt,
        }));

        const state = JSON.stringify([
          progress.status,
          progress.result,
          progress.answeredAt,
          progress.endedAt,
          progress.durationSeconds,
        ]);
        if (state !== lastState) {
          lastState = state;
          invalidate((old) => ({
            ...old,
            [tracking.recordId]: (old[tracking.recordId] ?? 0) + 1,
          }));
        }
        if (
          progress.status === 'finished' &&
          (progress.result !== 'answered' || progress.durationSeconds !== null)
        )
          return;
      } catch (error) {
        if (abort.signal.aborted) return;
        if (
          error instanceof VoiceApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setSnapshot(null);
          return;
        }
      }
      if (performance.now() < tracking.deadline)
        next = window.setTimeout(
          () => void poll(),
          locallyBusy ? 2_000 : 5_000,
        );
    };

    void poll();
    return () => {
      abort.abort();
      window.clearTimeout(next);
    };
  }, [invalidate, locallyBusy, tracking]);

  return snapshot?.progress.id === tracking?.callId ? snapshot : null;
};
