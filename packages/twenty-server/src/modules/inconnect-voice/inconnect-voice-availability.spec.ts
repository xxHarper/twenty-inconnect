import {
  getVoiceEffectiveAvailability,
  orderVoicePool,
} from 'src/modules/inconnect-voice/inconnect-voice-availability';

describe('effective Voice availability', () => {
  it.each([
    ['available', true, null, 'available'],
    ['available', false, null, 'offline'],
    ['offline', false, null, 'offline'],
    ['offline', false, 'busy', 'busy'],
    ['unavailable', true, null, 'unavailable'],
    ['unavailable', false, 'ringing', 'ringing'],
    ['unavailable', false, 'busy', 'busy'],
    ['unavailable', true, 'busy', 'busy'],
  ] as const)(
    '%s + registration %s + reservation %s gives %s',
    (preference, registered, reservation, expected) => {
      expect(
        getVoiceEffectiveAvailability(preference, registered, reservation),
      ).toBe(expected);
    },
  );
});

describe('Voice rotation order', () => {
  const offered = ['c', 'a', 'd'].map((actorMemberId) => ({ actorMemberId }));

  it('wraps and skips an absent cursor member while preserving input', () => {
    expect(
      orderVoicePool(offered, 'b').map(({ actorMemberId }) => actorMemberId),
    ).toEqual(['c', 'd', 'a']);
    expect(
      orderVoicePool(offered, 'd').map(({ actorMemberId }) => actorMemberId),
    ).toEqual(['a', 'c', 'd']);
    expect(offered[0].actorMemberId).toBe('c');
  });
});
