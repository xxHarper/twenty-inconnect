import { durableFixture } from './durable-inbound.fixtures';
import { DURABLE_INBOUND_FACT_SQL } from '../durable-inbound-sql';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('frozen v1 content and media intention, independent of download lifecycle', () => {
  it.each([
    ['text/Unicode/whitespace', { Body: '  👋 café 漢字\n ' }],
    ['empty text', { Body: '' }],
    ['provider timestamp', { Timestamp: '2026-10-20T10:30:00.123Z' }],
    [
      'image',
      {
        NumMedia: '1',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/media/image',
      },
    ],
    [
      'sticker',
      {
        NumMedia: '1',
        MediaContentType0: 'image/webp',
        MediaUrl0: 'https://api.twilio.com/media/sticker',
      },
    ],
    [
      'audio',
      {
        NumMedia: '1',
        MediaContentType0: 'audio/ogg',
        MediaUrl0: 'https://api.twilio.com/media/audio',
      },
    ],
    [
      'video',
      {
        NumMedia: '1',
        MediaContentType0: 'video/mp4',
        MediaUrl0: 'https://api.twilio.com/media/video',
      },
    ],
    [
      'document filename',
      {
        Body: 'path/ archivo.pdf',
        NumMedia: '1',
        MediaContentType0: 'application/pdf',
      },
    ],
    [
      'contact',
      {
        NumMedia: '1',
        MediaContentType0: 'text/vcard',
        MediaUrl0: 'https://api.twilio.com/media/contact',
      },
    ],
    ['location', { Latitude: '19.4', Longitude: '-99.1' }],
    ['malformed media intention still inbound', { NumMedia: '1' }],
  ])(
    'correlates the real R2 normalized %s without renormalizing or downloading',
    async (_name, parameters) => {
      const fixture = await durableFixture(undefined, undefined, parameters);
      const harness = fixture.start();
      await expect(harness.prepare()).resolves.toMatchObject({
        status: 'PREPARED',
      });
      harness.done();
      expect(fixture.issuance.external).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'missing',
      (attachments: Record<string, unknown>[]) => attachments.splice(0),
    ],
    [
      'ordinal',
      (attachments: Record<string, unknown>[]) => {
        attachments[0].ordinal = 1;
      },
    ],
    [
      'type',
      (attachments: Record<string, unknown>[]) => {
        attachments[0].type = 'AUDIO';
      },
    ],
    [
      'mime',
      (attachments: Record<string, unknown>[]) => {
        attachments[0].declaredMimeType = 'image/png';
      },
    ],
    [
      'filename',
      (attachments: Record<string, unknown>[]) => {
        attachments[0].safeFilename = 'different';
      },
    ],
    [
      'duplicate',
      (attachments: Record<string, unknown>[]) =>
        attachments.push(attachments[0]),
    ],
  ])('rejects %s attachment correlation', async (_name, change) => {
    const fixture = await durableFixture(undefined, undefined, {
      NumMedia: '1',
      MediaContentType0: 'image/jpeg',
    });
    change(fixture.fact.attachments as Record<string, unknown>[]);
    fixture.stopAfter(DURABLE_INBOUND_FACT_SQL, 2);
    const harness = fixture.start();
    await expect(harness.prepare()).rejects.toMatchObject({
      callerMustRollback: true,
    });
    harness.done();
  });

  it('does not confuse redacted media locators and download/file state with original intention', () => {
    expect(DURABLE_INBOUND_FACT_SQL).toContain('a."declaredMimeType"');
    expect(DURABLE_INBOUND_FACT_SQL).not.toMatch(
      /a\."(?:providerMediaLocator|ingestionState|fileId|mimeType|availableAt)"/,
    );
  });
});
