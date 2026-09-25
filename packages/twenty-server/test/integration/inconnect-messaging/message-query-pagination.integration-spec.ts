import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingMessageQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-message-query.service';
import { getCoreRepository } from 'test/integration/utils/get-core-repository.util';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const absentWorkspaceId = 'f3f73949-d23f-4df0-8c2f-b55c70f71c81';
const absentConversationId = 'b175b81e-26ee-456d-a1d1-920325e718b4';

describe('INCONNECT Messaging Message PostgreSQL pagination', () => {
  it('executes the joined take pagination path with computed display chronology', async () => {
    const coreRepository = getCoreRepository<InconnectMessagingMessageEntity>(
      InconnectMessagingMessageEntity,
    );
    const repository = new WorkspaceScopedRepository(coreRepository);
    const queryLogSpy = jest.spyOn(
      coreRepository.manager.connection.logger,
      'logQuery',
    );
    const authorizationService = {
      findAuthorizedConversation: jest
        .fn()
        .mockResolvedValue({ id: absentConversationId }),
    };
    const service = new InconnectMessagingMessageQueryService(
      repository,
      authorizationService as never,
    );

    await expect(
      service.getAuthorizedMessagePage({
        authContext: {
          workspace: { id: absentWorkspaceId },
        } as never,
        conversationId: absentConversationId,
        first: 1,
      }),
    ).resolves.toEqual({
      edges: [],
      hasNextPage: false,
      readThroughMessageId: null,
      totalCount: 0,
    });

    expect(authorizationService.findAuthorizedConversation).toHaveBeenCalled();

    const paginationQuery = queryLogSpy.mock.calls
      .map(([query]) => query)
      .find(
        (query) =>
          query.includes('SELECT DISTINCT') &&
          query.includes('"distinctAlias"'),
      );

    expect(paginationQuery).toContain(
      '"distinctAlias"."message_id" AS "ids_message_id"',
    );
    expect(paginationQuery).toContain('"distinctAlias"."message_display_at"');
    expect(paginationQuery).toContain(
      'COALESCE("message"."effectiveInboundAt", "message"."createdAt") AS "message_display_at"',
    );
    expect(paginationQuery).not.toContain('ORDER BY COALESCE');
  });
});
