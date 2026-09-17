import { Readable } from 'node:stream';

import { FileFolder } from 'twenty-shared/types';

import { InconnectMessagingAttachmentAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-attachment-access.service';

const WORKSPACE_ID = '10101010-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '10101010-2222-4222-8222-222222222222';
const ATTACHMENT_ID = '10101010-3333-4333-8333-333333333333';
const MESSAGE_ID = '10101010-4444-4444-8444-444444444444';
const CONVERSATION_ID = '10101010-5555-4555-8555-555555555555';
const FILE_ID = '10101010-6666-4666-8666-666666666666';

const authContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_test' },
} as never;

const attachment = {
  id: ATTACHMENT_ID,
  workspaceId: WORKSPACE_ID,
  messageId: MESSAGE_ID,
  fileId: FILE_ID,
  ingestionState: 'AVAILABLE',
  safeFilename: 'photo.jpg',
  message: {
    workspaceId: WORKSPACE_ID,
    conversationId: CONVERSATION_ID,
  },
};

const buildService = ({
  storedAttachment = attachment,
  authorizedConversation = { id: CONVERSATION_ID },
  storedFile = {
    stream: Readable.from(Buffer.from('image')),
    mimeType: 'image/jpeg',
  },
}: {
  storedAttachment?: typeof attachment | null;
  authorizedConversation?: { id: string } | null;
  storedFile?: { stream: Readable; mimeType: string } | null;
} = {}) => {
  const attachmentRepository = {
    findOne: jest.fn().mockResolvedValue(storedAttachment),
  };
  const authorizationService = {
    findAuthorizedConversation: jest
      .fn()
      .mockResolvedValue(authorizedConversation),
  };
  const fileService = {
    getFileStreamById: jest.fn().mockResolvedValue(storedFile),
  };
  const service = new InconnectMessagingAttachmentAccessService(
    attachmentRepository as never,
    authorizationService as never,
    fileService as never,
  );

  return {
    service,
    attachmentRepository,
    authorizationService,
    fileService,
  };
};

describe('InconnectMessagingAttachmentAccessService', () => {
  it('streams only after authorizing the parent Conversation', async () => {
    const { service, attachmentRepository, authorizationService, fileService } =
      buildService();

    await expect(
      service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      filename: 'photo.jpg',
    });
    expect(attachmentRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: ATTACHMENT_ID,
          workspaceId: WORKSPACE_ID,
          ingestionState: 'AVAILABLE',
        },
      }),
    );
    expect(
      authorizationService.findAuthorizedConversation,
    ).toHaveBeenCalledWith({ authContext, conversationId: CONVERSATION_ID });
    expect(fileService.getFileStreamById).toHaveBeenCalledWith({
      fileId: FILE_ID,
      workspaceId: WORKSPACE_ID,
      allowedFileFolders: [FileFolder.InconnectMessaging],
    });
  });

  it('returns the same null result for unauthorized and unavailable attachments', async () => {
    const unauthorized = buildService({ authorizedConversation: null });

    await expect(
      unauthorized.service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toBeNull();
    expect(unauthorized.fileService.getFileStreamById).not.toHaveBeenCalled();

    const unavailable = buildService({ storedAttachment: null });

    await expect(
      unavailable.service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toBeNull();
    expect(
      unavailable.authorizationService.findAuthorizedConversation,
    ).not.toHaveBeenCalled();
  });

  it('fails closed if a repository ever returns a cross-workspace row', async () => {
    const { service, authorizationService, fileService } = buildService({
      storedAttachment: {
        ...attachment,
        workspaceId: OTHER_WORKSPACE_ID,
        message: {
          ...attachment.message,
          workspaceId: OTHER_WORKSPACE_ID,
        },
      },
    });

    await expect(
      service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toBeNull();
    expect(
      authorizationService.findAuthorizedConversation,
    ).not.toHaveBeenCalled();
    expect(fileService.getFileStreamById).not.toHaveBeenCalled();
  });

  it('stops serving a known attachment UUID after Conversation access is revoked', async () => {
    const { service, authorizationService, fileService } = buildService();

    authorizationService.findAuthorizedConversation
      .mockResolvedValueOnce({ id: CONVERSATION_ID })
      .mockResolvedValueOnce(null);

    await expect(
      service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toMatchObject({ filename: 'photo.jpg' });
    await expect(
      service.getAuthorizedAttachment({
        authContext,
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toBeNull();
    expect(fileService.getFileStreamById).toHaveBeenCalledTimes(1);
  });
});
