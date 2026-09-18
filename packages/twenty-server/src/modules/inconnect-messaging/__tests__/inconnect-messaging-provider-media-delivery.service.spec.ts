import { Readable } from 'stream';

import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { InconnectMessagingAttachmentEntity } from 'src/modules/inconnect-messaging/entities/attachment.entity';
import { InconnectMessagingProviderMediaDeliveryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-media-delivery.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';

const buildService = () => {
  const attachment = {
    id: attachmentId,
    workspaceId,
    fileId,
    mimeType: 'image/png',
    size: 9,
    safeFilename: 'photo.png',
    ingestionState: 'AVAILABLE',
    message: { direction: 'OUTBOUND', workspaceId },
  };
  const repository = { findOne: jest.fn().mockResolvedValue(attachment) };
  const dataSource = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === InconnectMessagingAttachmentEntity) return repository;
      throw new Error('Unexpected repository');
    }),
  };
  const payload = {
    type: JwtTokenTypeEnum.INCONNECT_MESSAGING_PROVIDER_MEDIA,
    workspaceId,
    attachmentId,
    sub: attachmentId,
  };
  const jwt = {
    signAsyncOrThrow: jest.fn().mockResolvedValue('signed-token'),
    verifyJwtToken: jest.fn().mockResolvedValue(payload),
  };
  const config = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'SERVER_URL' ? 'https://crm.example.com' : '1d',
      ),
  };
  const fileService = {
    getFileStreamById: jest.fn().mockResolvedValue({
      stream: Readable.from(Buffer.from('png-bytes')),
      mimeType: 'image/png',
    }),
  };
  const service = new InconnectMessagingProviderMediaDeliveryService(
    dataSource as never,
    jwt as never,
    config as never,
    fileService as never,
  );

  return { service, repository, jwt, fileService, payload, attachment };
};

describe('InconnectMessagingProviderMediaDeliveryService', () => {
  it('creates a purpose-bound URL for exactly one server-selected Attachment', async () => {
    const fixture = buildService();
    const url = await fixture.service.createCapabilityUrl({
      workspaceId,
      attachmentId,
    });

    expect(url).toBe(
      `https://crm.example.com/inconnect-messaging/provider-media/${attachmentId}?token=signed-token`,
    );
    expect(fixture.jwt.signAsyncOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: JwtTokenTypeEnum.INCONNECT_MESSAGING_PROVIDER_MEDIA,
        workspaceId,
        attachmentId,
        sub: attachmentId,
      }),
      { expiresIn: '1d' },
    );
  });

  it('streams only an AVAILABLE outbound Attachment in the token workspace', async () => {
    const fixture = buildService();

    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'signed-token' }),
    ).resolves.toMatchObject({
      mimeType: 'image/png',
      filename: 'photo.png',
      size: 9,
    });
    expect(fixture.repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: attachmentId, workspaceId }),
      }),
    );
    expect(fixture.fileService.getFileStreamById).toHaveBeenCalledWith(
      expect.objectContaining({ fileId, workspaceId }),
    );
  });

  it('denies expired or modified tokens and tokens replayed for another Attachment', async () => {
    const fixture = buildService();

    fixture.jwt.verifyJwtToken.mockRejectedValueOnce(new Error('expired'));
    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'expired' }),
    ).resolves.toBeNull();

    fixture.jwt.verifyJwtToken.mockResolvedValueOnce({
      ...fixture.payload,
      attachmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'modified' }),
    ).resolves.toBeNull();
    expect(fixture.repository.findOne).toHaveBeenCalledTimes(0);
  });

  it('denies inbound, cross-workspace, or missing storage resources without fallback', async () => {
    const fixture = buildService();

    fixture.attachment.message.direction = 'INBOUND';
    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'signed-token' }),
    ).resolves.toBeNull();

    fixture.attachment.message.direction = 'OUTBOUND';
    fixture.attachment.message.workspaceId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'signed-token' }),
    ).resolves.toBeNull();

    fixture.attachment.message.workspaceId = workspaceId;
    fixture.fileService.getFileStreamById.mockResolvedValueOnce(null);
    await expect(
      fixture.service.getByCapability({ attachmentId, token: 'signed-token' }),
    ).resolves.toBeNull();
  });
});
