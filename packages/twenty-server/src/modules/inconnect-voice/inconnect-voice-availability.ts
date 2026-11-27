export const voicePreferences = [
  'available',
  'unavailable',
  'offline',
] as const;

export type VoicePreference = (typeof voicePreferences)[number];

export const getVoiceEffectiveAvailability = (
  preference: VoicePreference,
  registered: boolean,
  reservation: 'ringing' | 'busy' | null,
) => reservation ?? (!registered ? 'offline' : preference);

export const orderVoicePool = <T extends { actorMemberId: string }>(
  candidates: T[],
  after: string | null,
) => {
  const ordered = [...candidates].sort((left, right) =>
    left.actorMemberId < right.actorMemberId
      ? -1
      : Number(left.actorMemberId > right.actorMemberId),
  );
  if (!after) return ordered;
  const next = ordered.findIndex(({ actorMemberId }) => actorMemberId > after);

  return next === -1
    ? ordered
    : [...ordered.slice(next), ...ordered.slice(0, next)];
};
