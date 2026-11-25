export const VOICE_RESULTS = [
  'answered',
  'no-answer',
  'busy',
  'canceled',
  'failed',
] as const;

export type VoiceResult = (typeof VOICE_RESULTS)[number];
export type VoiceStatus =
  | 'reserved'
  | 'connecting'
  | 'ringing'
  | 'answered'
  | 'finished';

export type VoiceProgress = {
  status: VoiceStatus;
  result: VoiceResult | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
};

export const isTwilioCallSid = (value: unknown): value is string =>
  typeof value === 'string' && /^CA[0-9a-fA-F]{32}$/.test(value);

const timestamp = (value: unknown): Date | null => {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' &&
          /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} (?:\+0000|GMT)$/.test(
            value,
          )
        ? new Date(value)
        : null;

  return date && Number.isFinite(date.getTime()) ? date : null;
};

export const readTwilioProgress = ({
  status,
  eventTime,
  duration,
}: {
  status: string;
  eventTime?: unknown;
  duration?: unknown;
}): VoiceProgress | null => {
  const result =
    status === 'completed'
      ? 'answered'
      : (VOICE_RESULTS.find(
          (value) => value !== 'answered' && value === status,
        ) ?? null);
  const state = result
    ? 'finished'
    : status === 'in-progress'
      ? 'answered'
      : status === 'ringing'
        ? 'ringing'
        : status === 'initiated' || status === 'queued'
          ? 'connecting'
          : null;

  if (!state) return null;

  return {
    status: state,
    result,
    answeredAt: state === 'answered' ? timestamp(eventTime) : null,
    endedAt: state === 'finished' ? timestamp(eventTime) : null,
    durationSeconds:
      result === 'answered' &&
      typeof duration === 'string' &&
      /^\d{1,9}$/.test(duration)
        ? Number(duration)
        : null,
  };
};

const rank: Record<VoiceStatus, number> = {
  reserved: 0,
  connecting: 1,
  ringing: 2,
  answered: 3,
  finished: 4,
};

export const mergeVoiceProgress = (
  current: VoiceProgress,
  incoming: VoiceProgress,
): VoiceProgress => {
  if (current.result && incoming.result && current.result !== incoming.result)
    return current;
  if (
    current.status === 'answered' &&
    incoming.result &&
    incoming.result !== 'answered'
  )
    return current;

  const result = current.result ?? incoming.result;
  const endedAt = current.endedAt ?? incoming.endedAt;
  const answeredAt = current.answeredAt ?? incoming.answeredAt;

  return {
    status:
      rank[incoming.status] > rank[current.status]
        ? incoming.status
        : current.status,
    result,
    answeredAt:
      (!result || result === 'answered') &&
      answeredAt &&
      (!endedAt || answeredAt <= endedAt)
        ? answeredAt
        : current.answeredAt,
    endedAt:
      endedAt && (!current.answeredAt || endedAt >= current.answeredAt)
        ? endedAt
        : current.endedAt,
    durationSeconds: current.durationSeconds ?? incoming.durationSeconds,
  };
};
