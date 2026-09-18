import {
  Controller,
  Get,
  Head,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import { pipeline } from 'stream/promises';

import { type Response } from 'express';
import { z } from 'zod';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import {
  type InconnectMessagingProviderMediaDelivery,
  InconnectMessagingProviderMediaDeliveryService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-media-delivery.service';

const toProviderSafeFilename = (filename: string): string => {
  const sanitized =
    filename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '') || 'media';
  const extensionIndex = sanitized.lastIndexOf('.');
  const extension =
    extensionIndex > 0 ? sanitized.slice(extensionIndex).slice(0, 8) : '';
  const basename = (
    extensionIndex > 0 ? sanitized.slice(0, extensionIndex) : sanitized
  ).slice(0, Math.max(1, 20 - extension.length));

  return `${basename || 'media'}${extension}`.slice(0, 20);
};

@Controller('inconnect-messaging/provider-media')
export class InconnectMessagingProviderMediaController {
  constructor(
    private readonly deliveryService: InconnectMessagingProviderMediaDeliveryService,
  ) {}

  @Head(':attachmentId')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async headMedia(
    @Param('attachmentId') attachmentId: string,
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const media = await this.resolveMediaOrThrow({ attachmentId, token });

    media.stream.destroy();
    this.setHeaders(response, media);
    response.status(200).send();
  }

  @Get(':attachmentId')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getMedia(
    @Param('attachmentId') attachmentId: string,
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const media = await this.resolveMediaOrThrow({ attachmentId, token });

    this.setHeaders(response, media);
    await pipeline(media.stream, response);
  }

  private async resolveMediaOrThrow({
    attachmentId,
    token,
  }: {
    attachmentId: string;
    token: string | undefined;
  }): Promise<InconnectMessagingProviderMediaDelivery> {
    if (!z.uuid().safeParse(attachmentId).success || !token) {
      throw new NotFoundException();
    }

    const media = await this.deliveryService.getByCapability({
      attachmentId,
      token,
    });

    if (media === null) throw new NotFoundException();

    return media;
  }

  private setHeaders(
    response: Response,
    media: InconnectMessagingProviderMediaDelivery,
  ): void {
    const filename = toProviderSafeFilename(media.filename);

    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Content-Length', String(media.size));
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
  }
}
