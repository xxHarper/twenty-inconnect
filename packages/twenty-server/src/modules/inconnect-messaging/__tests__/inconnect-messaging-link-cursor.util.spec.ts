import {
  decodeInconnectMessagingLinkCandidateCursor,
  encodeInconnectMessagingLinkCandidateCursor,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-link-cursor.util';

describe('INCONNECT Messaging link candidate cursor', () => {
  it('round-trips the deterministic label and UUID ordering tuple', () => {
    const value = {
      id: '14141414-1111-4111-8111-111111111111',
      label: 'Acme',
    };

    expect(
      decodeInconnectMessagingLinkCandidateCursor(
        encodeInconnectMessagingLinkCandidateCursor(value),
      ),
    ).toEqual(value);
  });

  it('rejects another cursor shape', () => {
    expect(() =>
      decodeInconnectMessagingLinkCandidateCursor('not-a-cursor'),
    ).toThrow('Invalid INCONNECT Messaging link cursor');
  });
});
