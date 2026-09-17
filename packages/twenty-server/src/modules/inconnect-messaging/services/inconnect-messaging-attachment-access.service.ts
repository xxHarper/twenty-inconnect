import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Readable } from 'stream';

import { FileFolder } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

export type AuthorizedInconnectMessagingAttachment = {
  stream: Readable;
  mimeType: string;
  filename: string;
};

@Injectable()
export class InconnectMessagingAttachmentAccessService {
  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- The explicit workspace predicate is paired with Conversation authorization before storage is read.
    @InjectRepository(InconnectMessagingAttachmentEntity)
    private readonly attachmentRepository: Repository<InconnectMessagingAttachmentEntity>,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly fileService: FileService,
  ) {}

  async getAuthorizedAttachment({
    authContext,
    attachmentId,
  }: {
    authContext: WorkspaceAuthContext;
    attachmentId: string;
  }): Promise<AuthorizedInconnectMessagingAttachment | null> {
    const attachment = await this.attachmentRepository.findOne({
      select: [
        'id',
        'workspaceId',
        'messageId',
        'fileId',
        'ingestionState',
        'safeFilename',
      ],
      where: {
        id: attachmentId,
        workspaceId: authContext.workspace.id,
        ingestionState: 'AVAILABLE',
      },
      relations: { message: true },
    });

    if (
      attachment === null ||
      attachment.fileId === null ||
      attachment.message.workspaceId !== authContext.workspace.id
    ) {
      return null;
    }

    const conversation =
      await this.authorizationService.findAuthorizedConversation({
        authContext,
        conversationId: attachment.message.conversationId,
      });

    if (conversation === null) return null;

    const file = await this.fileService.getFileStreamById({
      fileId: attachment.fileId,
      workspaceId: authContext.workspace.id,
      allowedFileFolders: [FileFolder.InconnectMessaging],
    });

    return file === null
      ? null
      : {
          ...file,
          filename: attachment.safeFilename,
        };
  }
}
