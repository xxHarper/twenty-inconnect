import { type RawBodyRequest } from '@nestjs/common';

import express, { type Request } from 'express';

import { InconnectMessagingWebhookController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-webhook.controller';
import {
  protectedFixture,
  protectedRequest,
} from './authenticated-ingress.fixtures';

const directRequest = () => {
  const signed = protectedRequest();
  const app = express();
  app.set('trust proxy', false);
  return Object.assign(Object.create(app.request), {
    app,
    socket: { encrypted: true, remoteAddress: '127.0.0.1' },
    headers: {
      host: 'crm.example.test',
      'content-type': signed.contentType,
      'x-twilio-signature': signed.signature,
    },
    rawHeaders: ['Host', 'crm.example.test'],
    originalUrl: new URL(signed.effectiveUrl).pathname,
    params: { routingKey: signed.routingKey },
    body: signed.parameters,
    rawBody: Buffer.from(signed.rawBody, 'utf8'),
  }) as RawBodyRequest<Request<{ routingKey: string }>>;
};

describe('controller transport evidence from server request', () => {
  it('emits v1 through actual controller, real Express getters and real signature verifier', async () => {
    const fixture = protectedFixture();
    await new InconnectMessagingWebhookController(
      fixture.ingress,
    ).handleInbound(directRequest());
    expect(fixture.state.original!.ingressContractVersion).toBe(1);
  });

  it('denies v1 when the raw bytes are not valid UTF8 even if the parsed form verifies', async () => {
    const fixture = protectedFixture();
    const request = directRequest();
    request.rawBody = Buffer.from([0xff]);
    await new InconnectMessagingWebhookController(
      fixture.ingress,
    ).handleInbound(request);
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.builder.values.mock.calls[0][0]).not.toHaveProperty(
      'ingressContractVersion',
    );
  });

  it('denies v1 for duplicated Host header evidence without changing legacy receipt semantics', async () => {
    const fixture = protectedFixture();
    const request = directRequest();
    request.rawHeaders.push('Host', 'other.example.test');
    await new InconnectMessagingWebhookController(
      fixture.ingress,
    ).handleInbound(request);
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it('does not turn request body authority fields into a policy registration', async () => {
    const fixture = protectedFixture();
    const request = directRequest();
    request.body = {
      ...request.body,
      ingressContractVersion: '1',
      trusted: 'true',
    };
    await expect(
      new InconnectMessagingWebhookController(fixture.ingress).handleInbound(
        request,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.query).not.toHaveBeenCalled();
  });
});
