import { type DataSource, type Repository } from 'typeorm';

import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { type InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import {
  scope,
  identifier,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const publisherFixture = () => {
  const event = {
    id: identifier(80),
    workspaceId: scope.workspaceId,
    aggregateType: 'CONVERSATION',
    aggregateId: scope.conversationId,
    eventType: 'CONVERSATION_ATTENTION_CHANGED',
    immutablePayload: { conversationId: scope.conversationId },
    processingState: 'PENDING',
    availableAt: new Date(0),
    attemptCount: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    createdAt: new Date(0),
  };
  const findOne = jest.fn(async (options) => {
    expect(options).toEqual({
      select: ['id', 'workspaceId'],
      where: { id: scope.conversationId, workspaceId: scope.workspaceId },
    });
    return { id: scope.conversationId, workspaceId: scope.workspaceId };
  });
  const source = {
    transaction: jest.fn(async (callback) =>
      callback({
        getRepository: () => ({
          findOne: async () => event,
          save: async () => event,
        }),
      }),
    ),
    getRepository: jest.fn((entity) => {
      expect(entity).toBe(InconnectMessagingConversationEntity);
      return { findOne };
    }),
  };
  const update = jest.fn(async () => ({ affected: 1 }));
  const members = [1, 2, 3].map((value) => ({
    workspaceMemberId: identifier(value + 50),
    workspace: { id: scope.workspaceId },
  }));
  const allowed = new Set([
    members[0].workspaceMemberId,
    members[1].workspaceMemberId,
  ]);
  const authorize = jest.fn(async ({ authContext, conversationId }) => {
    expect(conversationId).toBe(scope.conversationId);
    return allowed.has(authContext.workspaceMemberId)
      ? { id: scope.conversationId }
      : null;
  });
  const publish = jest.fn(async () => {
    allowed.delete(members[1].workspaceMemberId);
  });
  const candidates = jest.fn(async () => members);
  const autoLink = jest.fn();
  const service = new InconnectMessagingOutboxService(
    source as unknown as DataSource,
    { update } as unknown as Repository<InconnectMessagingOutboxEventEntity>,
    { add: jest.fn() } as never,
    { findAuthorizedConversation: authorize } as never,
    { getCandidateAuthContexts: candidates } as never,
    { publishToMember: publish } as never,
    { attemptForInboundMessage: autoLink } as never,
  );
  return {
    service,
    event,
    members,
    authorize,
    publish,
    update,
    autoLink,
    findOne,
    candidates,
    source,
  };
};

describe('existing publisher consumes attention as an authorized Conversation hint', () => {
  it('rechecks each recipient and excludes a member revoked after candidate enumeration', async () => {
    const fixture = publisherFixture();
    await fixture.service.publishEvent(fixture.event.id);
    expect(fixture.authorize).toHaveBeenCalledTimes(3);
    expect(fixture.publish).toHaveBeenCalledTimes(1);
    expect(fixture.publish).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      workspaceMemberId: fixture.members[0].workspaceMemberId,
      hint: {
        eventId: fixture.event.id,
        eventType: 'CONVERSATION_UPDATED',
        conversationId: scope.conversationId,
        messageId: null,
        occurredAt: fixture.event.createdAt,
      },
    });
    expect(fixture.autoLink).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingState: 'PUBLISHED' }),
    );
  });

  it.each([
    null,
    {},
    { conversationId: identifier(99) },
    { conversationId: scope.conversationId, body: 'private' },
    [],
  ])('fails malformed payload %j before fanout', async (payload) => {
    const fixture = publisherFixture();
    Object.assign(fixture.event, { immutablePayload: payload });
    await fixture.service.publishEvent(fixture.event.id);
    expect(fixture.candidates).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingState: 'FAILED' }),
    );
  });

  it.each(['MESSAGE', 'other'])(
    'rejects incorrect aggregate %s before resolving content',
    async (aggregateType) => {
      const fixture = publisherFixture();
      fixture.event.aggregateType = aggregateType;
      await fixture.service.publishEvent(fixture.event.id);
      expect(fixture.source.getRepository).not.toHaveBeenCalled();
      expect(fixture.publish).not.toHaveBeenCalled();
    },
  );

  it('skips a foreign workspace candidate before authorization/publication', async () => {
    const fixture = publisherFixture();
    fixture.members.forEach((member) => {
      member.workspace.id = identifier(99);
    });
    await fixture.service.publishEvent(fixture.event.id);
    expect(fixture.authorize).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('rejects a missing scoped Conversation without emitting data', async () => {
    const fixture = publisherFixture();
    fixture.findOne.mockResolvedValueOnce(null as never);
    await fixture.service.publishEvent(fixture.event.id);
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('keeps publication failure retryable in the existing outbox', async () => {
    const fixture = publisherFixture();
    fixture.publish.mockRejectedValueOnce(
      new Error('delivery failure') as never,
    );
    await expect(
      fixture.service.publishEvent(fixture.event.id),
    ).rejects.toThrow('delivery failure');
    expect(fixture.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingState: 'PENDING' }),
    );
  });
});
