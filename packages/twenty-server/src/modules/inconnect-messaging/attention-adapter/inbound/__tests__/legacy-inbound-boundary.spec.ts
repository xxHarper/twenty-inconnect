import { legacyInboundFixture } from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/legacy-inbound.fixtures';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service',
  () => ({ InconnectMessagingOutboxService: class {} }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service',
  () => ({ InconnectMessagingMediaIngestionService: class {} }),
);

describe('unchanged real processReceipt, without mocking its internal methods', () => {
  it.each([false, true])(
    'preserves %s existing Conversation and no-epoch Message',
    async (existingConversation) => {
      const fixture = legacyInboundFixture({ existingConversation });
      await fixture.service.processReceipt(fixture.receipt.id);
      expect(fixture.order.indexOf('commit-2')).toBeLessThan(
        fixture.order.indexOf('publish'),
      );
      expect(fixture.order.indexOf('commit-2')).toBeLessThan(
        fixture.order.indexOf('media'),
      );
      const message = fixture.writes.find((write) => write.table === 'message');
      expect(message?.values).toMatchObject({
        direction: 'INBOUND',
        providerMessageId: 'SM-original',
      });
      expect(
        Object.keys(message?.values ?? {}).some((key) =>
          key.startsWith('attention'),
        ),
      ).toBe(false);
      expect(
        fixture.writes.find((write) => write.table === 'outbox')?.values,
      ).toMatchObject({ eventType: 'INBOUND_MESSAGE_RECEIVED' });
      expect(fixture.receiptUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'IMAGE',
    'STICKER',
    'DOCUMENT',
    'AUDIO',
    'VIDEO',
    'CONTACT',
  ] as const)(
    'preserves %s media intents without downloading during the transaction',
    async (type) => {
      const mimeTypes = {
        IMAGE: 'image/jpeg',
        STICKER: 'image/webp',
        DOCUMENT: 'application/pdf',
        AUDIO: 'audio/ogg',
        VIDEO: 'video/mp4',
        CONTACT: 'text/vcard',
      };
      const fixture = legacyInboundFixture({
        webhookChanges: {
          messageType: type,
          attachments: [
            {
              ordinal: 0,
              type,
              providerMediaLocator: 'opaque-locator',
              declaredMimeType: mimeTypes[type],
              safeFilename: 'attachment',
            },
          ],
        },
      });
      await fixture.service.processReceipt(fixture.receipt.id);
      expect(
        fixture.writes.find((write) => write.table === 'attachment')?.values,
      ).toMatchObject({
        ingestionState: 'PENDING',
        ordinal: 0,
        fileId: null,
        declaredMimeType: mimeTypes[type],
      });
      expect(fixture.order.indexOf('commit-2')).toBeLessThan(
        fixture.order.indexOf('media'),
      );
    },
  );

  it('preserves location metadata without inventing an Attachment', async () => {
    const fixture = legacyInboundFixture({
      webhookChanges: {
        messageType: 'LOCATION',
        providerMetadata: { location: { latitude: 19, longitude: -99 } },
      },
    });
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.writes.some((write) => write.table === 'attachment')).toBe(
      false,
    );
    expect(
      fixture.writes.find((write) => write.table === 'message')?.values.type,
    ).toBe('LOCATION');
  });

  it('reuses an existing Message without another attachment or inbound Outbox', async () => {
    const fixture = legacyInboundFixture({ duplicate: true });
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.requestPublication).not.toHaveBeenCalled();
    expect(
      fixture.writes.some((write) =>
        ['outbox', 'attachment'].includes(write.table),
      ),
    ).toBe(false);
    expect(fixture.receiptUpdate).toHaveBeenCalledTimes(1);
  });

  it('does no domain work for a Receipt already processed', async () => {
    const fixture = legacyInboundFixture({ processed: true });
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.writes).toEqual([]);
  });

  it.each(['message', 'attachment', 'outbox', 'commit'] as const)(
    'rejects %s failure before any external request and leaves Receipt retryable',
    async (fault) => {
      const fixture = legacyInboundFixture({
        fault,
        webhookChanges: {
          attachments: [
            {
              ordinal: 0,
              type: 'IMAGE',
              providerMediaLocator: 'opaque',
              declaredMimeType: 'image/jpeg',
              safeFilename: 'image.jpg',
            },
          ],
        },
      });
      await expect(
        fixture.service.processReceipt(fixture.receipt.id),
      ).rejects.toMatchObject({ retryable: true });
      expect(fixture.order).toContain('reject-2');
      expect(fixture.requestPublication).not.toHaveBeenCalled();
      expect(fixture.requestMedia).not.toHaveBeenCalled();
      expect(fixture.releaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: fixture.receipt.id }),
        expect.objectContaining({ processingState: 'RECEIVED' }),
      );
    },
  );

  it('fails a foreign or disabled routed connection without Message writes', async () => {
    const fixture = legacyInboundFixture({ fault: 'connection' });
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.writes).toEqual([]);
    expect(fixture.releaseUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingState: 'FAILED' }),
    );
  });

  it('keeps a post-commit media error outside causal rollback', async () => {
    const fixture = legacyInboundFixture();
    fixture.requestMedia.mockRejectedValueOnce(
      new Error('queue unavailable') as never,
    );
    await expect(
      fixture.service.processReceipt(fixture.receipt.id),
    ).rejects.toThrow('queue unavailable');
    expect(fixture.order).toContain('commit-2');
    expect(fixture.releaseUpdate).not.toHaveBeenCalled();
  });
});
