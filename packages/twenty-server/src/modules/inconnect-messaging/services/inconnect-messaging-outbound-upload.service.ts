import { Injectable } from '@nestjs/common';

import { createHash } from 'crypto';

import { FileFolder } from 'twenty-shared/types';
import { DataSource } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FileUploadService } from 'src/engine/core-modules/file/file-upload/services/file-upload.service';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import {
  ConflictError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import {
  getInconnectMessagingAllowedMimeTypesForType,
  getInconnectMessagingOutboundMaximumBytes,
  INCONNECT_MESSAGING_OUTBOUND_UPLOAD_TTL_MILLISECONDS,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-media-policy.constant';
import { type InconnectMessagingOutboundUploadDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-outbound-upload.dto';
import { InconnectMessagingOutboundUploadEntity } from 'src/modules/inconnect-messaging/entities/outbound-upload.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  INCONNECT_MESSAGING_ATTACHMENT_TYPES,
  type InconnectMessagingAttachmentType,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const normalizeFilenameOrThrow = (filename: string): string => {
  const normalized = filename.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 180 ||
    normalized === '.' ||
    normalized === '..' ||
    /[\\/\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new UserInputError('Invalid filename', {
      subCode: 'INVALID_FILENAME',
    });
  }

  return normalized;
};

const normalizeTypeOrThrow = (
  value: string,
): InconnectMessagingAttachmentType => {
  if (
    !INCONNECT_MESSAGING_ATTACHMENT_TYPES.includes(
      value as InconnectMessagingAttachmentType,
    )
  ) {
    throw new UserInputError('Unsupported media type', {
      subCode: 'UNSUPPORTED_MEDIA_TYPE',
    });
  }

  return value as InconnectMessagingAttachmentType;
};

@Injectable()
export class InconnectMessagingOutboundUploadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly fileUploadService: FileUploadService,
    private readonly fileService: FileService,
  ) {}

  async createUpload({
    authContext,
    clientUploadId,
    filename,
    size,
    type: rawType,
  }: {
    authContext: WorkspaceAuthContext;
    clientUploadId: string;
    filename: string;
    size: number;
    type: string;
  }): Promise<InconnectMessagingOutboundUploadDTO> {
    const actor = await this.requireAuthorizedActor(authContext);
    const type = normalizeTypeOrThrow(rawType);
    const safeFilename = normalizeFilenameOrThrow(filename);
    const maximumBytes = getInconnectMessagingOutboundMaximumBytes(type);

    if (!Number.isInteger(size) || size <= 0 || size > maximumBytes) {
      throw new UserInputError('Invalid media size', {
        subCode: 'MEDIA_SIZE_LIMIT_EXCEEDED',
      });
    }

    const uploadId = uuidv5(
      `${actor.workspaceMemberId}:${clientUploadId}`,
      actor.workspaceId,
    );
    const fileId = uuidv5('inconnect-messaging-outbound-file', uploadId);
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify([type, safeFilename, size]))
      .digest('hex');
    const repository = this.dataSource.getRepository(
      InconnectMessagingOutboundUploadEntity,
    );
    const now = new Date();

    await repository
      .createQueryBuilder()
      .insert()
      .values({
        id: uploadId,
        workspaceId: actor.workspaceId,
        workspaceMemberId: actor.workspaceMemberId,
        clientUploadId,
        state: 'CREATING',
        type,
        safeFilename,
        size,
        fileId: null,
        mimeType: null,
        contentFingerprint: null,
        requestFingerprint,
        expiresAt: new Date(
          now.getTime() + INCONNECT_MESSAGING_OUTBOUND_UPLOAD_TTL_MILLISECONDS,
        ),
        completedAt: null,
        consumedByMessageId: null,
        consumedAt: null,
      })
      .orIgnore()
      .execute();

    let upload = await this.findOwnedUploadOrThrow({
      ...actor,
      uploadId,
    });

    if (upload.requestFingerprint !== requestFingerprint) {
      throw new ConflictError('UPLOAD_IDEMPOTENCY_KEY_CONFLICT');
    }

    this.assertNotExpired(upload, now);

    if (upload.state === 'AVAILABLE' || upload.state === 'CONSUMED') {
      return this.toDTO(upload, null);
    }

    let uploadTarget;

    if (upload.state === 'CREATING') {
      uploadTarget = await this.fileUploadService.createServerOwnedFileUpload({
        workspaceId: actor.workspaceId,
        filename: safeFilename,
        size,
        fileFolder: FileFolder.InconnectMessaging,
        fileId,
        maximumFileSize: maximumBytes,
      });

      await repository.update(
        { id: uploadId, workspaceId: actor.workspaceId, state: 'CREATING' },
        { state: 'PENDING', fileId },
      );
      upload = await this.findOwnedUploadOrThrow({ ...actor, uploadId });
    } else {
      if (upload.fileId === null) throw new Error('Upload file is unavailable');
      uploadTarget =
        await this.fileUploadService.refreshServerOwnedFileUploadTarget({
          workspaceId: actor.workspaceId,
          fileId: upload.fileId,
          fileFolder: FileFolder.InconnectMessaging,
        });
    }

    return this.toDTO(upload, uploadTarget);
  }

  async completeUpload({
    authContext,
    uploadId,
  }: {
    authContext: WorkspaceAuthContext;
    uploadId: string;
  }): Promise<InconnectMessagingOutboundUploadDTO> {
    const actor = await this.requireAuthorizedActor(authContext);
    let upload = await this.findOwnedUploadOrThrow({ ...actor, uploadId });

    this.assertNotExpired(upload, new Date());

    if (upload.state === 'AVAILABLE' || upload.state === 'CONSUMED') {
      return this.toDTO(upload, null);
    }

    if (upload.state !== 'PENDING' || upload.fileId === null) {
      throw new UserInputError('Upload is not ready to complete', {
        subCode: 'UPLOAD_NOT_READY',
      });
    }

    const file = await this.fileUploadService.completeServerOwnedFileUpload({
      workspaceId: actor.workspaceId,
      fileId: upload.fileId,
      fileFolder: FileFolder.InconnectMessaging,
      allowedMimeTypes: getInconnectMessagingAllowedMimeTypesForType(
        upload.type,
      ),
    });
    const fingerprint = await this.hashStoredFileOrThrow({
      workspaceId: actor.workspaceId,
      fileId: file.id,
      maximumBytes: getInconnectMessagingOutboundMaximumBytes(upload.type),
      expectedSize: Number(upload.size),
    });
    const completedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(InconnectMessagingOutboundUploadEntity)
        .findOne({
          where: {
            id: uploadId,
            workspaceId: actor.workspaceId,
            workspaceMemberId: actor.workspaceMemberId,
          },
          lock: { mode: 'pessimistic_write' },
        });

      if (locked === null) throw new NotFoundError('Upload not found');
      this.assertNotExpired(locked, completedAt);

      if (locked.state === 'PENDING') {
        locked.state = 'AVAILABLE';
        locked.mimeType = file.mimeType;
        locked.contentFingerprint = fingerprint;
        locked.completedAt = completedAt;
        await manager
          .getRepository(InconnectMessagingOutboundUploadEntity)
          .save(locked);
      }
    });

    upload = await this.findOwnedUploadOrThrow({ ...actor, uploadId });

    return this.toDTO(upload, null);
  }

  private async requireAuthorizedActor(
    authContext: WorkspaceAuthContext,
  ): Promise<{ workspaceId: string; workspaceMemberId: string }> {
    if (
      !isUserAuthContext(authContext) ||
      !(await this.authorizationService.canStageOutboundUpload(authContext))
    ) {
      throw new NotFoundError('Upload not found');
    }

    return {
      workspaceId: authContext.workspace.id,
      workspaceMemberId: authContext.workspaceMemberId,
    };
  }

  private async findOwnedUploadOrThrow({
    workspaceId,
    workspaceMemberId,
    uploadId,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    uploadId: string;
  }): Promise<InconnectMessagingOutboundUploadEntity> {
    const upload = await this.dataSource
      .getRepository(InconnectMessagingOutboundUploadEntity)
      .findOne({ where: { id: uploadId, workspaceId, workspaceMemberId } });

    if (upload === null) throw new NotFoundError('Upload not found');

    return upload;
  }

  private assertNotExpired(
    upload: InconnectMessagingOutboundUploadEntity,
    now: Date,
  ): void {
    if (upload.expiresAt <= now) {
      throw new UserInputError('Upload has expired', {
        subCode: 'UPLOAD_EXPIRED',
      });
    }
  }

  private async hashStoredFileOrThrow({
    workspaceId,
    fileId,
    maximumBytes,
    expectedSize,
  }: {
    workspaceId: string;
    fileId: string;
    maximumBytes: number;
    expectedSize: number;
  }): Promise<string> {
    const file = await this.fileService.getFileStreamById({
      workspaceId,
      fileId,
      allowedFileFolders: [FileFolder.InconnectMessaging],
    });

    if (file === null) {
      throw new UserInputError('Uploaded file is unavailable', {
        subCode: 'UPLOAD_STORAGE_UNAVAILABLE',
      });
    }

    const hash = createHash('sha256');
    let bytes = 0;

    for await (const chunk of file.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      bytes += buffer.length;
      if (bytes > maximumBytes) {
        file.stream.destroy();
        throw new UserInputError('Invalid media size', {
          subCode: 'MEDIA_SIZE_LIMIT_EXCEEDED',
        });
      }
      hash.update(buffer);
    }

    if (bytes !== expectedSize) {
      throw new UserInputError('Uploaded file size mismatch', {
        subCode: 'UPLOAD_SIZE_MISMATCH',
      });
    }

    return hash.digest('hex');
  }

  private toDTO(
    upload: InconnectMessagingOutboundUploadEntity,
    target: {
      uploadUrl: string;
      contentType: string;
    } | null,
  ): InconnectMessagingOutboundUploadDTO {
    return {
      uploadId: upload.id,
      state: upload.state,
      type: upload.type,
      filename: upload.safeFilename,
      size: Number(upload.size),
      contentType: upload.mimeType,
      uploadUrl: target?.uploadUrl ?? null,
      uploadContentType: target?.contentType ?? null,
      expiresAt: upload.expiresAt,
    };
  }
}
