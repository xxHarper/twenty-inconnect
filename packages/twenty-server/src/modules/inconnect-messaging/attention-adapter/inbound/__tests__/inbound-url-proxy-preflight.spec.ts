import { type RawBodyRequest } from '@nestjs/common';

import express, { type Request } from 'express';

import {
  originRequest,
  ORIGIN_TEST_URL,
  receiptOriginFixture,
  signOriginRequest,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin.fixtures';
import { InconnectMessagingWebhookController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-webhook.controller';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';

// Real Express getters and controller, without listen(), sockets or HTTP calls.
const controllerRequest = (
  request: InconnectMessagingWebhookRequest,
  trustProxy: boolean,
  headers: Record<string, string> = {},
) => {
  const app = express();
  app.set('trust proxy', trustProxy);
  return Object.assign(Object.create(app.request), {
    app,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: 'crm.example.test',
      'content-type': request.contentType,
      'x-twilio-signature': request.signature,
      ...headers,
    },
    originalUrl:
      new URL(request.effectiveUrl).pathname +
      new URL(request.effectiveUrl).search,
    params: { routingKey: request.routingKey },
    body: request.parameters,
    rawBody: Buffer.from(request.rawBody, 'utf8'),
  }) as RawBodyRequest<Request<{ routingKey: string }>>;
};

describe('URL/proxy preflight: observed legacy behavior, pending origin policy', () => {
  it('uses trusted forwarded scheme and host in the real controller', async () => {
    const fixture = receiptOriginFixture();
    const controller = new InconnectMessagingWebhookController(fixture.ingress);
    const request = controllerRequest(originRequest(), true, {
      host: 'internal:3000',
      'x-forwarded-host': 'crm.example.test',
      'x-forwarded-proto': 'https',
    });
    await controller.handleInbound(request);
    expect(fixture.rows).toHaveLength(1);
    expect(request.protocol).toBe('https');
    expect(request.host).toBe('crm.example.test');
  });

  it('ignores forwarded origin from an untrusted peer and rejects the mismatched signature', async () => {
    const fixture = receiptOriginFixture();
    const controller = new InconnectMessagingWebhookController(fixture.ingress);
    const request = controllerRequest(originRequest(), false, {
      host: 'internal:3000',
      'x-forwarded-host': 'crm.example.test',
      'x-forwarded-proto': 'https',
    });
    await expect(controller.handleInbound(request)).rejects.toMatchObject({
      status: 403,
    });
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(request.protocol).toBe('http');
    expect(request.host).toBe('internal:3000');
  });

  it('accepts a correctly signed foreign forwarded hostname today: no allowlist is enforced', async () => {
    const fixture = receiptOriginFixture();
    const signed = signOriginRequest({
      ...originRequest(),
      effectiveUrl: ORIGIN_TEST_URL.replace(
        'crm.example.test',
        'foreign.example.test',
      ),
    });
    const request = controllerRequest(signed, true, {
      'x-forwarded-host': 'foreign.example.test',
      'x-forwarded-proto': 'https',
    });
    await new InconnectMessagingWebhookController(
      fixture.ingress,
    ).handleInbound(request);
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.external).not.toHaveBeenCalled();
  });

  it('rejects a hostname change without a corresponding signature', async () => {
    const fixture = receiptOriginFixture();
    const request = controllerRequest(originRequest(), true, {
      'x-forwarded-host': 'foreign.example.test',
      'x-forwarded-proto': 'https',
    });
    await expect(
      new InconnectMessagingWebhookController(fixture.ingress).handleInbound(
        request,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.rows).toHaveLength(0);
  });

  it('documents SDK nonstandard-port tolerance instead of treating it as port authorization', async () => {
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook({
      ...originRequest(),
      effectiveUrl: ORIGIN_TEST_URL.replace(
        'crm.example.test',
        'crm.example.test:8443',
      ),
    });
    expect(fixture.rows).toHaveLength(1);
  });

  it('documents that legacy ingress does not bind signed pathname to routingKey', async () => {
    const fixture = receiptOriginFixture();
    const request = signOriginRequest({
      ...originRequest(),
      effectiveUrl: ORIGIN_TEST_URL.replace('/route-1/', '/route-2/'),
    });
    await fixture.ingress.acceptTwilioWhatsappWebhook(request);
    expect(fixture.rows[0].providerConnectionId).toBe(fixture.connection.id);
    // This direct backend call is not a public router exploit. The signed B1
    // adapter separately rejects it; the future private ingress must bind both.
  });

  it.each(['?extra=1', '?a=two%20words', '?a=%C3%A9'])(
    'rejects a changed unsigned query %s',
    async (query) => {
      const fixture = receiptOriginFixture();
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook({
          ...originRequest(),
          effectiveUrl: ORIGIN_TEST_URL + query,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(fixture.rows).toHaveLength(0);
    },
  );

  it('documents SDK query-encoding equivalence for a signed space', async () => {
    const fixture = receiptOriginFixture();
    const request = signOriginRequest({
      ...originRequest(),
      effectiveUrl: ORIGIN_TEST_URL + '?label=two%20words',
    });
    request.effectiveUrl = ORIGIN_TEST_URL + '?label=two+words';
    await fixture.ingress.acceptTwilioWhatsappWebhook(request);
    expect(fixture.rows).toHaveLength(1);
  });

  it('documents same-signature duplicated values producing different first-value normalizations', async () => {
    const first = originRequest({ Body: ['first', 'second'] });
    const second = originRequest({ Body: ['second', 'first'] });
    expect(first.signature).toBe(second.signature);
    const fixture = receiptOriginFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(first);
    const other = receiptOriginFixture();
    await other.ingress.acceptTwilioWhatsappWebhook(second);
    expect(fixture.rows[0]).toMatchObject({
      normalizedMetadata: { body: 'first' },
    });
    expect(other.rows[0]).toMatchObject({
      normalizedMetadata: { body: 'second' },
    });
    expect(fixture.rows[0].payloadHash).not.toBe(other.rows[0].payloadHash);
  });

  it('documents that repeated equal values are also not signed for multiplicity', () => {
    expect(originRequest({ Body: ['same', 'same'] }).signature).toBe(
      originRequest({ Body: 'same' }).signature,
    );
  });

  it('preserves Unicode without deriving signature authority from the rawBody hash', async () => {
    const fixture = receiptOriginFixture();
    const request = originRequest({ Body: 'a b+é 👩‍💻' });
    request.rawBody = request.rawBody.replace(/\+/g, '%20');
    await fixture.ingress.acceptTwilioWhatsappWebhook(request);
    expect(fixture.rows[0]).toMatchObject({
      normalizedMetadata: { body: 'a b+é 👩‍💻' },
    });
  });
});
