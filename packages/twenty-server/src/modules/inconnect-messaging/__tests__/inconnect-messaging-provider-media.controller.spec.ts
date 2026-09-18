import { Readable, Writable } from 'stream';

import { NotFoundException } from '@nestjs/common';

import { type Response } from 'express';

import { InconnectMessagingProviderMediaController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-provider-media.controller';

const attachmentId = '22222222-2222-4222-8222-222222222222';

const buildResponse = () => {
  const chunks: Buffer[] = [];
  const response = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & Partial<Response>;

  response.setHeader = jest.fn();
  response.status = jest.fn().mockReturnValue(response);
  response.send = jest.fn().mockReturnValue(response);

  return { response: response as Response, chunks };
};

const buildController = () => {
  const stream = Readable.from(Buffer.from('png-bytes'));
  const deliveryService = {
    getByCapability: jest.fn().mockResolvedValue({
      stream,
      mimeType: 'image/png',
      filename: '../../unsafe name with unicode 📷.png',
      size: 9,
    }),
  };
  const controller = new InconnectMessagingProviderMediaController(
    deliveryService as never,
  );

  return { controller, deliveryService, stream };
};

describe('InconnectMessagingProviderMediaController', () => {
  it('serves GET with bounded provider-safe headers and exact capability lookup', async () => {
    const fixture = buildController();
    const { response, chunks } = buildResponse();

    await fixture.controller.getMedia(attachmentId, 'signed-token', response);

    expect(Buffer.concat(chunks).toString()).toBe('png-bytes');
    expect(fixture.deliveryService.getByCapability).toHaveBeenCalledWith({
      attachmentId,
      token: 'signed-token',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/png',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '9');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="unsafe_name_with.png"',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
  });

  it('answers HEAD without streaming the body', async () => {
    const fixture = buildController();
    const destroy = jest.spyOn(fixture.stream, 'destroy');
    const { response, chunks } = buildResponse();

    await fixture.controller.headMedia(attachmentId, 'signed-token', response);

    expect(destroy).toHaveBeenCalled();
    expect(chunks).toHaveLength(0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith();
  });

  it('denies missing capability and traversal-like attachment paths without lookup', async () => {
    const fixture = buildController();
    const { response } = buildResponse();

    await expect(
      fixture.controller.getMedia('../other-file', 'signed-token', response),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      fixture.controller.getMedia(attachmentId, undefined, response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.deliveryService.getByCapability).not.toHaveBeenCalled();
  });
});
