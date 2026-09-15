import { isInconnectMessagingFreeformWindowOpen } from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';

const now = new Date('2026-09-14T12:00:00.000Z');

describe('isInconnectMessagingFreeformWindowOpen', () => {
  it.each([
    [null, false],
    [new Date('2026-09-13T12:00:00.001Z'), true],
    [new Date('2026-09-13T12:00:00.000Z'), false],
    [new Date('2026-09-13T11:59:59.999Z'), false],
    [new Date('2020-01-01T00:00:00.000Z'), false],
    [new Date('2026-09-14T12:00:00.001Z'), false],
  ])('returns %s for persisted inbound %s', (lastInboundAt, expected) => {
    expect(isInconnectMessagingFreeformWindowOpen({ lastInboundAt, now })).toBe(
      expected,
    );
  });
});
