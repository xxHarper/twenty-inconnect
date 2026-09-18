import { Readable } from 'stream';

import { FileFolder } from 'twenty-shared/types';
import { type EntityManager } from 'typeorm';

import { InconnectMessagingOutboundUploadEntity } from 'src/modules/inconnect-messaging/entities/outbound-upload.entity';
import { InconnectMessagingOutboundUploadService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbound-upload.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const workspaceMemberId = '22222222-2222-4222-8222-222222222222';
const clientUploadId = '33333333-3333-4333-8333-333333333333';
const authContext = {
  type: 'user',
  workspace: { id: workspaceId },
  workspaceMemberId,
  workspaceMember: { id: workspaceMemberId },
};

const buildService = () => {
  const rows = new Map<string, InconnectMessagingOutboundUploadEntity>();
  let pendingValues: Partial<InconnectMessagingOutboundUploadEntity> | null =
    null;
  const queryBuilder = {
    insert: jest.fn().mockReturnThis(),
    values: jest
      .fn()
      .mockImplementation(
        (values: Partial<InconnectMessagingOutboundUploadEntity>) => {
          pendingValues = values;

          return queryBuilder;
        },
      ),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockImplementation(async () => {
      if (pendingValues?.id && !rows.has(pendingValues.id)) {
        rows.set(
          pendingValues.id,
          Object.assign(new InconnectMessagingOutboundUploadEntity(), {
            ...pendingValues,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        );
      }
    }),
  };
  const repository = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn().mockImplementation(
      async (options: {
        where: {
          id: string;
          workspaceId: string;
          workspaceMemberId: string;
        };
      }) => {
        const row = rows.get(options.where.id);

        return row?.workspaceId === options.where.workspaceId &&
          row.workspaceMemberId === options.where.workspaceMemberId
          ? row
          : null;
      },
    ),
    update: jest
      .fn()
      .mockImplementation(
        async (
          where: { id: string; state?: string },
          values: Partial<InconnectMessagingOutboundUploadEntity>,
        ) => {
          const row = rows.get(where.id);

          if (row && (!where.state || row.state === where.state)) {
            Object.assign(row, values);
            return { affected: 1 };
          }

          return { affected: 0 };
        },
      ),
    save: jest
      .fn()
      .mockImplementation(
        async (row: InconnectMessagingOutboundUploadEntity) => {
          rows.set(row.id, row);
          return row;
        },
      ),
  };
  const manager = {
    getRepository: jest.fn().mockReturnValue(repository),
  } as unknown as EntityManager;
  const dataSource = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === InconnectMessagingOutboundUploadEntity) return repository;
      throw new Error('Unexpected repository');
    }),
    transaction: jest
      .fn()
      .mockImplementation(
        async (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager),
      ),
  };
  const authorizationService = {
    canStageOutboundUpload: jest.fn().mockResolvedValue(true),
  };
  const fileUploadService = {
    createServerOwnedFileUpload: jest.fn().mockResolvedValue({
      fileId: 'server-only-file-id',
      uploadUrl: 'https://upload.example.com/server-capability',
      contentType: 'application/octet-stream',
      expiresAt: new Date(Date.now() + 60_000),
    }),
    refreshServerOwnedFileUploadTarget: jest.fn(),
    completeServerOwnedFileUpload: jest
      .fn()
      .mockImplementation(
        async ({
          fileId,
          allowedMimeTypes,
        }: {
          fileId: string;
          allowedMimeTypes: readonly string[];
        }) => {
          if (!allowedMimeTypes.includes('image/png'))
            throw new Error('mime rejected');

          return { id: fileId, mimeType: 'image/png' };
        },
      ),
  };
  const fileService = {
    getFileStreamById: jest.fn().mockResolvedValue({
      stream: Readable.from(Buffer.from('png-bytes')),
      mimeType: 'image/png',
    }),
  };
  const service = new InconnectMessagingOutboundUploadService(
    dataSource as never,
    authorizationService as never,
    fileUploadService as never,
    fileService as never,
  );

  return {
    service,
    rows,
    authorizationService,
    fileUploadService,
    fileService,
  };
};

describe('InconnectMessagingOutboundUploadService', () => {
  it('creates an actor-scoped idempotent upload without exposing FileEntity identity', async () => {
    const fixture = buildService();
    const input = {
      authContext: authContext as never,
      clientUploadId,
      filename: 'photo.png',
      size: 9,
      type: 'IMAGE',
    };
    const first = await fixture.service.createUpload(input);
    const retry = await fixture.service.createUpload(input);

    expect(retry.uploadId).toBe(first.uploadId);
    expect(first).toMatchObject({
      state: 'PENDING',
      uploadUrl: 'https://upload.example.com/server-capability',
      uploadContentType: 'application/octet-stream',
    });
    expect(first).not.toHaveProperty('fileId');
    expect(
      fixture.fileUploadService.createServerOwnedFileUpload,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.fileUploadService.refreshServerOwnedFileUploadTarget,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.fileUploadService.createServerOwnedFileUpload,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        fileFolder: FileFolder.InconnectMessaging,
        fileId: expect.any(String),
        maximumFileSize: 5 * 1024 * 1024,
      }),
    );
  });

  it('fails closed without SEND authorization', async () => {
    const fixture = buildService();

    fixture.authorizationService.canStageOutboundUpload.mockResolvedValue(
      false,
    );
    await expect(
      fixture.service.createUpload({
        authContext: authContext as never,
        clientUploadId,
        filename: 'photo.png',
        size: 9,
        type: 'IMAGE',
      }),
    ).rejects.toThrow('Upload not found');
  });

  it('rejects malformed names and type-specific oversized files', async () => {
    const fixture = buildService();

    await expect(
      fixture.service.createUpload({
        authContext: authContext as never,
        clientUploadId,
        filename: '../photo.png',
        size: 9,
        type: 'IMAGE',
      }),
    ).rejects.toMatchObject({ extensions: { subCode: 'INVALID_FILENAME' } });
    await expect(
      fixture.service.createUpload({
        authContext: authContext as never,
        clientUploadId,
        filename: 'sticker.webp',
        size: 100 * 1024 + 1,
        type: 'STICKER',
      }),
    ).rejects.toMatchObject({
      extensions: { subCode: 'MEDIA_SIZE_LIMIT_EXCEEDED' },
    });
  });

  it('rejects cross-actor completion and expired staging references', async () => {
    const fixture = buildService();
    const created = await fixture.service.createUpload({
      authContext: authContext as never,
      clientUploadId,
      filename: 'photo.png',
      size: 9,
      type: 'IMAGE',
    });

    await expect(
      fixture.service.completeUpload({
        authContext: {
          ...authContext,
          workspaceMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          workspaceMember: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        } as never,
        uploadId: created.uploadId,
      }),
    ).rejects.toThrow('Upload not found');

    await expect(
      fixture.service.completeUpload({
        authContext: {
          ...authContext,
          workspace: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        } as never,
        uploadId: created.uploadId,
      }),
    ).rejects.toThrow('Upload not found');

    const row = fixture.rows.get(created.uploadId);

    if (row) row.expiresAt = new Date(Date.now() - 1);
    await expect(
      fixture.service.completeUpload({
        authContext: authContext as never,
        uploadId: created.uploadId,
      }),
    ).rejects.toMatchObject({ extensions: { subCode: 'UPLOAD_EXPIRED' } });
  });

  it('detects MIME through the official completion path and fingerprints bounded stored bytes', async () => {
    const fixture = buildService();
    const created = await fixture.service.createUpload({
      authContext: authContext as never,
      clientUploadId,
      filename: 'photo.png',
      size: 9,
      type: 'IMAGE',
    });
    const completed = await fixture.service.completeUpload({
      authContext: authContext as never,
      uploadId: created.uploadId,
    });

    expect(completed).toMatchObject({
      state: 'AVAILABLE',
      contentType: 'image/png',
      uploadUrl: null,
    });
    expect(fixture.rows.get(created.uploadId)?.contentFingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('rejects spoofed or unsupported detected MIME independently of the filename', async () => {
    const fixture = buildService();
    const created = await fixture.service.createUpload({
      authContext: authContext as never,
      clientUploadId,
      filename: 'looks-like-an-image.png',
      size: 9,
      type: 'IMAGE',
    });

    fixture.fileUploadService.completeServerOwnedFileUpload.mockImplementationOnce(
      async ({ allowedMimeTypes }) => {
        if (!allowedMimeTypes.includes('application/pdf')) {
          throw new Error('mime rejected');
        }

        return { id: 'unexpected', mimeType: 'application/pdf' };
      },
    );

    await expect(
      fixture.service.completeUpload({
        authContext: authContext as never,
        uploadId: created.uploadId,
      }),
    ).rejects.toThrow('mime rejected');
    expect(fixture.rows.get(created.uploadId)?.state).toBe('PENDING');
  });

  it('does not reopen or expose upload authority after the staging row is consumed', async () => {
    const fixture = buildService();
    const input = {
      authContext: authContext as never,
      clientUploadId,
      filename: 'photo.png',
      size: 9,
      type: 'IMAGE',
    };
    const created = await fixture.service.createUpload(input);
    await fixture.service.completeUpload({
      authContext: authContext as never,
      uploadId: created.uploadId,
    });
    const row = fixture.rows.get(created.uploadId);

    if (row) {
      row.state = 'CONSUMED';
      row.consumedByMessageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      row.consumedAt = new Date();
    }

    await expect(fixture.service.createUpload(input)).resolves.toMatchObject({
      uploadId: created.uploadId,
      state: 'CONSUMED',
      uploadUrl: null,
    });
    expect(
      fixture.fileUploadService.createServerOwnedFileUpload,
    ).toHaveBeenCalledTimes(1);
  });
});
