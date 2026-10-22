import {
  originRequest,
  ORIGIN_TEST_TOKEN,
  receiptOriginFixture,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin.fixtures';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';

describe('durable inbound origin preflight (no durable admission implemented)', () => {
  it('persists only after real routing and SDK authentication and preserves backend scope', async () => {
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(
      originRequest({ workspaceId: 'untrusted' }),
    );
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.rows[0]).toMatchObject({
      workspaceId: fixture.connection.workspaceId,
      providerConnectionId: fixture.connection.id,
      eventKind: 'INBOUND_MESSAGE',
      processingState: 'RECEIVED',
      normalizedMetadata: { body: 'Hola 👋 café 漢字' },
    });
    expect(fixture.decrypt).toHaveBeenCalledWith(
      fixture.connection.encryptedCredentials,
      { workspaceId: fixture.connection.workspaceId },
    );
    expect(fixture.add).toHaveBeenCalledWith(
      expect.any(String),
      { receiptId: fixture.rows[0].id },
      expect.any(Object),
    );
    expect(fixture.external).not.toHaveBeenCalled();
  });

  it.each(['invalid', ''])(
    'rejects signature %s before any receipt transaction or enqueue',
    async (signature) => {
      const fixture = receiptOriginFixture();
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook({
          ...originRequest(),
          signature,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(fixture.transaction).not.toHaveBeenCalled();
      expect(fixture.add).not.toHaveBeenCalled();
    },
  );

  it('cannot distinguish a signed ingress INSERT from a direct unsigned persistence call', async () => {
    const signed = receiptOriginFixture();
    const direct = receiptOriginFixture();
    const request = originRequest();
    await signed.ingress.acceptTwilioWhatsappWebhook(request);
    const normalizedWebhook = direct.provider.normalizeWebhook({
      request,
      payloadHash: direct.receiptService.computePayloadHash(request.rawBody),
    });
    await direct.receiptService.persistAndRequestProcessing({
      workspaceId: direct.connection.workspaceId,
      providerConnectionId: direct.connection.id,
      normalizedWebhook,
      rawBody: request.rawBody,
      firstReceivedAt: request.serverReceivedAt,
    });
    expect(direct.rows).toEqual(signed.rows);
    expect(direct.decrypt).not.toHaveBeenCalled();
    expect(direct.findConnections).not.toHaveBeenCalled();
    // These identical projections are a counterexample, never an admission.
    expect(direct.add).toHaveBeenCalledTimes(1);
  });

  it('also persists caller-normalized content unrelated to rawBody without proving its origin', async () => {
    const fixture = receiptOriginFixture();
    const request = originRequest();
    const normalized = fixture.provider.normalizeWebhook({
      request,
      payloadHash: 'unused',
    });
    if (normalized.kind !== 'INBOUND_MESSAGE')
      throw new Error('Invalid fixture');
    await fixture.receiptService.persistAndRequestProcessing({
      workspaceId: fixture.connection.workspaceId,
      providerConnectionId: fixture.connection.id,
      normalizedWebhook: { ...normalized, body: 'synthetic content' },
      rawBody: request.rawBody,
      firstReceivedAt: request.serverReceivedAt,
    });
    expect(fixture.rows[0]).toMatchObject({
      normalizedMetadata: { body: 'synthetic content' },
    });
    expect(fixture.decrypt).not.toHaveBeenCalled();
  });

  it('recovers after enqueue failure and service reconstruction with only serialized receipt data', async () => {
    const original = receiptOriginFixture();
    original.add.mockRejectedValueOnce(new Error('queue unavailable'));
    await original.ingress.acceptTwilioWhatsappWebhook(originRequest());
    const serialized = JSON.stringify(original.rows);
    expect(serialized).not.toContain(ORIGIN_TEST_TOKEN);
    const data: InconnectMessagingWebhookReceiptEntity[] =
      JSON.parse(serialized);
    for (const row of data) {
      expect(row).not.toHaveProperty('rawBody');
      expect(row).not.toHaveProperty('signature');
      expect(row).not.toHaveProperty('effectiveUrl');
      expect(row).not.toHaveProperty('parameters');
      row.firstReceivedAt = new Date(row.firstReceivedAt);
    }
    const restarted = receiptOriginFixture(data);
    await expect(
      restarted.receiptService.recoverPendingReceipts(),
    ).resolves.toBe(1);
    expect(restarted.add).toHaveBeenCalledWith(
      expect.any(String),
      { receiptId: data[0].id },
      expect.any(Object),
    );
    expect(restarted.decrypt).not.toHaveBeenCalled();
    expect(restarted.transaction).not.toHaveBeenCalled();
    expect(restarted.external).not.toHaveBeenCalled();
  });

  it('re-enqueues an unknown historical row identically without upgrading its provenance', async () => {
    const fixture = receiptOriginFixture();
    const request = originRequest();
    await fixture.receiptService.persistAndRequestProcessing({
      workspaceId: fixture.connection.workspaceId,
      providerConnectionId: fixture.connection.id,
      normalizedWebhook: fixture.provider.normalizeWebhook({
        request,
        payloadHash: 'unused',
      }),
      rawBody: request.rawBody,
      firstReceivedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const before = JSON.stringify(fixture.rows);
    await expect(
      fixture.makeReceiptService().recoverPendingReceipts(),
    ).resolves.toBe(1);
    expect(JSON.stringify(fixture.rows)).toBe(before);
    expect(fixture.decrypt).not.toHaveBeenCalled();
  });

  it('preserves original receipt metadata on signed duplicate without attesting it retroactively', async () => {
    const fixture = receiptOriginFixture();
    const request = originRequest();
    await fixture.ingress.acceptTwilioWhatsappWebhook(request);
    const original = JSON.stringify(fixture.rows);
    await fixture.ingress.acceptTwilioWhatsappWebhook({
      ...request,
      serverReceivedAt: new Date('2026-10-23T12:00:00.000Z'),
    });
    expect(JSON.stringify(fixture.rows)).toBe(original);
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.add).toHaveBeenCalledTimes(2);
  });

  it('rejects a signed duplicate with different raw payload rather than replacing the original', async () => {
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(originRequest());
    const original = JSON.stringify(fixture.rows);
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(
        originRequest({ Body: 'different' }),
      ),
    ).rejects.toMatchObject({ category: 'PAYLOAD_CONFLICT' });
    expect(JSON.stringify(fixture.rows)).toBe(original);
    expect(fixture.add).toHaveBeenCalledTimes(1);
  });

  it('does not upgrade PROCESSED to a new inbound operation on duplicate reception', async () => {
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(originRequest());
    fixture.rows[0].processingState = 'PROCESSED';
    await fixture.ingress.acceptTwilioWhatsappWebhook(originRequest());
    expect(fixture.rows[0].processingState).toBe('PROCESSED');
    // Reception can enqueue it again; processReceipt's separate guard is required.
    expect(fixture.add).toHaveBeenCalledTimes(2);
    await expect(fixture.receiptService.recoverPendingReceipts()).resolves.toBe(
      0,
    );
  });

  it('does not authenticate history again on recovery after token rotation', async () => {
    const fixture = receiptOriginFixture();
    const request = originRequest();
    await fixture.ingress.acceptTwilioWhatsappWebhook(request);
    const historical = JSON.stringify(fixture.rows);
    fixture.decrypt.mockReturnValue(
      JSON.stringify({ authToken: 'rotated-token' }),
    );
    await expect(
      fixture.makeReceiptService().recoverPendingReceipts(),
    ).resolves.toBe(1);
    expect(JSON.stringify(fixture.rows)).toBe(historical);
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(request),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.rows).toHaveLength(1);
  });

  it('recovery alone does not establish current connection authorization', async () => {
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(originRequest());
    fixture.connection.lifecycleStatus = 'DISABLED';
    await expect(
      fixture.makeReceiptService().recoverPendingReceipts(),
    ).resolves.toBe(1);
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(originRequest()),
    ).rejects.toMatchObject({ category: 'CONNECTION_DISABLED' });
  });

  it('rejects ambiguous routing even with a valid signature and a shared token', async () => {
    const fixture = receiptOriginFixture();
    fixture.connections.push({ ...fixture.connection });
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(originRequest()),
    ).rejects.toMatchObject({ category: 'CONNECTION_AMBIGUOUS' });
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it.each(['08006', '57014'])(
    'propagates receipt SQL failure %s without enqueue or fallback',
    async (code) => {
      const fixture = receiptOriginFixture();
      fixture.execute.mockRejectedValueOnce(
        Object.assign(new Error('injected SQL failure'), { code }),
      );
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook(originRequest()),
      ).rejects.toMatchObject({ code });
      expect(fixture.add).not.toHaveBeenCalled();
      expect(fixture.external).not.toHaveBeenCalled();
    },
  );
});
