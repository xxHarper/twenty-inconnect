import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';

import { pipeline } from 'node:stream/promises';

import { type Response } from 'express';
import { z } from 'zod';

import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { getContentDisposition } from 'src/engine/core-modules/file/utils/get-content-disposition.utils';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InconnectMessagingAttachmentAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-attachment-access.service';

@Controller('inconnect-messaging/attachments')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard, NoPermissionGuard)
export class InconnectMessagingAttachmentController {
  constructor(
    private readonly attachmentAccessService: InconnectMessagingAttachmentAccessService,
  ) {}

  @Get(':attachmentId')
  async getAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!z.uuid().safeParse(attachmentId).success) {
      throw new NotFoundException();
    }

    const authContext = getWorkspaceAuthContext();

    if (authContext.type !== 'user') throw new NotFoundException();

    const attachment =
      await this.attachmentAccessService.getAuthorizedAttachment({
        authContext,
        attachmentId,
      });

    if (attachment === null) throw new NotFoundException();

    const safeFilename = attachment.filename
      .replace(/[\r\n"\\]/g, '_')
      .slice(0, 180);

    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `${getContentDisposition(attachment.mimeType)}; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    );

    await pipeline(attachment.stream, response);
  }
}
