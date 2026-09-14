import {
  decodeInconnectMessagingCursor,
  encodeInconnectMessagingCursor,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-cursor.util';

describe('INCONNECT Messaging cursor', () => {
  const value = {
    id: '30303030-1111-4111-8111-111111111111',
    kind: 'message' as const,
    sortAt: new Date('2026-09-11T10:00:00.000Z'),
  };

  it('round-trips the deterministic timestamp and ID tie breaker', () => {
    const cursor = encodeInconnectMessagingCursor(value);

    expect(
      decodeInconnectMessagingCursor({ cursor, expectedKind: 'message' }),
    ).toEqual(value);
  });

  it('does not allow a Conversation cursor to be used for Messages', () => {
    const cursor = encodeInconnectMessagingCursor({
      ...value,
      kind: 'conversation',
    });

    expect(() =>
      decodeInconnectMessagingCursor({ cursor, expectedKind: 'message' }),
    ).toThrow('Invalid INCONNECT Messaging cursor');
  });

  it('rejects malformed cursors', () => {
    expect(() =>
      decodeInconnectMessagingCursor({
        cursor: Buffer.from('{}').toString('base64'),
        expectedKind: 'message',
      }),
    ).toThrow('Invalid INCONNECT Messaging cursor');
  });
});
