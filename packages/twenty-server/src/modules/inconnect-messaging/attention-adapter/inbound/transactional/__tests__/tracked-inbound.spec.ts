import {
  apply,
  initial,
  pending,
  physicalRows,
  identifier,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_INSERT_EFFECT_SQL,
  ATTENTION_UPDATE_CONVERSATION_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { durableEvent } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/__tests__/durable-inbound.fixtures';
import * as sql from '../tracked-inbound-sql';
import {
  bundle,
  conversation,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { causalFixture } from './tracked-inbound.fixtures';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('complete source causal inbound unit with real R2/R3/III-A/II/C1/reducer', () => {
  it.each([true, false])(
    'prepares new=%s Conversation with explicit message origin, both outboxes and scoped Receipt completion',
    async (fresh) => {
      const fixture = await causalFixture({ fresh });
      const harness = fixture.start();
      const result = await harness.prepare();
      harness.done();
      expect(result).toMatchObject({
        status: 'PREPARED',
        receiptId: identifier(27),
        messageId: identifier(10),
        trackingEpochId: identifier(4),
        conversationId: identifier(2),
      });
      expect(
        result.publicationRequests.map((event) => event.eventType),
      ).toEqual(['INBOUND_MESSAGE_RECEIVED', 'CONVERSATION_ATTENTION_CHANGED']);
      const statements = harness.calls.map((call) => call.sql);
      expect(
        statements.indexOf(sql.INBOUND_LOCK_CONVERSATION_SQL),
      ).toBeLessThan(statements.indexOf(sql.INBOUND_LOCK_RECEIPT_SQL));
      expect(statements.indexOf(sql.INBOUND_LOCK_RECEIPT_SQL)).toBeLessThan(
        statements.indexOf(sql.INBOUND_INSERT_MESSAGE_SQL),
      );
      expect(statements.indexOf(sql.INBOUND_INSERT_MESSAGE_SQL)).toBeLessThan(
        statements.indexOf(ATTENTION_INSERT_EFFECT_SQL),
      );
      expect(statements.indexOf(ATTENTION_INSERT_EFFECT_SQL)).toBeLessThan(
        statements.indexOf(sql.INBOUND_FINALIZE_RECEIPT_SQL),
      );
      expect(statements.includes(sql.INBOUND_CREATE_EPOCH_SQL)).toBe(fresh);
      expect(harness.runner.commitTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(['1', '9223372036854775809'])(
    'renews PENDING/%s using exact BigInt and preserves pendingAt in writer SQL',
    async (revision) => {
      const before = pending(revision);
      const fixture = await causalFixture({
        fresh: false,
        before,
        fixture: { current: conversation('PENDING', revision) },
      });
      const harness = fixture.start();
      await harness.prepare();
      harness.done();
      expect(
        harness.calls
          .find((call) => call.sql === ATTENTION_UPDATE_CONVERSATION_SQL)
          ?.parameters.slice(-4),
      ).toEqual([
        'PENDING',
        revision,
        'PENDING',
        (BigInt(revision) + BigInt(1)).toString(),
      ]);
      expect(ATTENTION_UPDATE_CONVERSATION_SQL).toContain('THEN c."pendingAt"');
    },
  );

  it('replays an existing Message/Effect without another increment, attachment or inbound Outbox', async () => {
    const event = durableEvent();
    const rows = physicalRows(event, initial());
    const before = apply(initial(), event).state;
    const fixture = await causalFixture({
      fresh: false,
      duplicate: true,
      before,
      fixture: {
        current: conversation('PENDING', '1'),
        effect: rows.effect,
        receipt: rows.canonicalReceipt,
        bundles: { [rows.effect.id]: bundle(rows) },
        originalAudit: rows.canonicalAudit,
      },
    });
    const harness = fixture.start();
    const result = await harness.prepare();
    harness.done();
    expect(result.publicationRequests).toHaveLength(1);
    expect(
      harness.calls.some((call) =>
        [
          sql.INBOUND_INSERT_MESSAGE_SQL,
          sql.INBOUND_INSERT_ATTACHMENT_SQL,
          sql.INBOUND_INSERT_OUTBOX_SQL,
          ATTENTION_UPDATE_CONVERSATION_SQL,
        ].includes(call.sql),
      ),
    ).toBe(false);
  });

  it.each([
    ['TEXT', {}],
    [
      'IMAGE',
      {
        NumMedia: '1',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    [
      'STICKER',
      {
        NumMedia: '1',
        MediaContentType0: 'image/webp',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    [
      'AUDIO',
      {
        NumMedia: '1',
        MediaContentType0: 'audio/ogg',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    [
      'VIDEO',
      {
        NumMedia: '1',
        MediaContentType0: 'video/mp4',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    [
      'DOCUMENT',
      {
        NumMedia: '1',
        MediaContentType0: 'application/pdf',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    [
      'CONTACT',
      {
        NumMedia: '1',
        MediaContentType0: 'text/vcard',
        MediaUrl0: 'https://api.twilio.com/media',
      },
    ],
    ['LOCATION', { Latitude: '19.4', Longitude: '-99.1' }],
  ] as const)(
    'persists actual R2 normalized %s and its media intention before R3',
    async (type, form) => {
      const fixture = await causalFixture({
        form: { ...form, Body: '  hola 👋\n' },
      });
      const harness = fixture.start();
      await harness.prepare();
      harness.done();
      expect(
        harness.calls.find(
          (call) => call.sql === sql.INBOUND_INSERT_MESSAGE_SQL,
        )?.parameters[5],
      ).toBe(type);
      expect(
        harness.calls.find(
          (call) => call.sql === sql.INBOUND_INSERT_MESSAGE_SQL,
        )?.parameters[6],
      ).toBe('  hola 👋\n');
      expect(
        harness.calls.filter(
          (call) => call.sql === sql.INBOUND_INSERT_ATTACHMENT_SQL,
        ),
      ).toHaveLength(['TEXT', 'LOCATION'].includes(type) ? 0 : 1);
    },
  );
});
