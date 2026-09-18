import { Injectable } from '@nestjs/common';

import { type Readable } from 'stream';

import { FileFolder } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type InconnectMessagingProviderMediaTokenJwtPayload } from 'src/engine/core-modules/auth/types/inconnect-messaging-provider-media-token-jwt-payload.type';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';

export type InconnectMessagingProviderMediaDelivery = {
  stream: Readable;
  mimeType: string;
  filename: string;
  size: number;
};

@Injectable()
export class InconnectMessagingProviderMediaDeliveryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtWrapperService: JwtWrapperService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly fileService: FileService,
  ) {}

  async createCapabilityUrl({
    workspaceId,
    attachmentId,
  }: {
    workspaceId: string;
    attachmentId: string;
  }): Promise<string> {
    const payload: InconnectMessagingProviderMediaTokenJwtPayload = {
      type: JwtTokenTypeEnum.INCONNECT_MESSAGING_PROVIDER_MEDIA,
      workspaceId,
      attachmentId,
      sub: attachmentId,
    };
    const token = await this.jwtWrapperService.signAsyncOrThrow(payload, {
      expiresIn: this.twentyConfigService.get('FILE_TOKEN_EXPIRES_IN'),
    });
    const serverUrl = new URL(this.twentyConfigService.get('SERVER_URL'));

    return new URL(
      `/inconnect-messaging/provider-media/${encodeURIComponent(attachmentId)}?token=${encodeURIComponent(token)}`,
      serverUrl,
    ).toString();
  }

  async getByCapability({
    attachmentId,
    token,
  }: {
    attachmentId: string;
    token: string;
  }): Promise<InconnectMessagingProviderMediaDelivery | null> {
    let payload: InconnectMessagingProviderMediaTokenJwtPayload;

    try {
      payload = (await this.jwtWrapperService.verifyJwtToken(
        token,
      )) as InconnectMessagingProviderMediaTokenJwtPayload;
    } catch {
      return null;
    }

    if (
      payload.type !== JwtTokenTypeEnum.INCONNECT_MESSAGING_PROVIDER_MEDIA ||
      payload.attachmentId !== attachmentId ||
      payload.sub !== attachmentId ||
      typeof payload.workspaceId !== 'string'
    ) {
      return null;
    }

    const attachment = await this.dataSource
      .getRepository(InconnectMessagingAttachmentEntity)
      .findOne({
        where: {
          id: attachmentId,
          workspaceId: payload.workspaceId,
          ingestionState: 'AVAILABLE',
        },
        relations: { message: true },
      });

    if (
      attachment === null ||
      attachment.fileId === null ||
      attachment.mimeType === null ||
      attachment.size === null ||
      attachment.message.direction !== 'OUTBOUND' ||
      attachment.message.workspaceId !== payload.workspaceId
    ) {
      return null;
    }

    const file = await this.fileService.getFileStreamById({
      fileId: attachment.fileId,
      workspaceId: payload.workspaceId,
      allowedFileFolders: [FileFolder.InconnectMessaging],
    });

    return file === null
      ? null
      : {
          stream: file.stream,
          mimeType: attachment.mimeType,
          filename: attachment.safeFilename,
          size: Number(attachment.size),
        };
  }
}
