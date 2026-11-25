import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';

type VoiceCallTimerProps = {
  connectedAt: number | null;
  endedAt: number | null;
  durationSeconds?: number | null;
};

export const VoiceCallTimer = ({
  connectedAt,
  endedAt,
  durationSeconds,
}: VoiceCallTimerProps) => {
  const { t } = useLingui();
  const [sample, setSample] = useState(() => performance.now());

  useEffect(() => {
    if (connectedAt === null || endedAt !== null || durationSeconds != null)
      return;
    const timer = window.setInterval(() => setSample(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [connectedAt, durationSeconds, endedAt]);

  const elapsed =
    durationSeconds ??
    (connectedAt === null
      ? null
      : Math.max(0, Math.floor(((endedAt ?? sample) - connectedAt) / 1_000)));
  if (elapsed === null) return null;
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  return <span role="timer">{t`Connected time: ${minutes}:${seconds}`}</span>;
};
