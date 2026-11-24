import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';

type VoiceCallTimerProps = {
  connectedAt: number;
  endedAt: number | null;
};

export const VoiceCallTimer = ({
  connectedAt,
  endedAt,
}: VoiceCallTimerProps) => {
  const { t } = useLingui();
  const [sample, setSample] = useState(connectedAt);

  useEffect(() => {
    if (endedAt !== null) return;
    const timer = window.setInterval(() => setSample(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [endedAt]);

  const elapsed = Math.max(
    0,
    Math.floor(((endedAt ?? sample) - connectedAt) / 1_000),
  );
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  return <span role="timer">{t`Browser time: ${minutes}:${seconds}`}</span>;
};
