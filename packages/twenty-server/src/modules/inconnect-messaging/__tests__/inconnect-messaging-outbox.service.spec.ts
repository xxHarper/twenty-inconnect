import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const event = {
  id: '30303030-1111-4111-8111-111111111111',
  workspaceId: '30303030-2222-4222-8222-222222222222',
  aggregateType: 'MESSAGE',
  aggregateId: '30303030-3333-4333-8333-333333333333',
  eventType: 'INBOUND_MESSAGE_RECEIVED',
  processingState: 'PENDING',
  availableAt: new Date('2026-09-11T09:00:00.000Z'),
  leaseToken: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  error: null,
  publishedAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
};
const message = {
  id: event.aggregateId,
  workspaceId: event.workspaceId,
  conversationId: '30303030-4444-4444-8444-444444444444',
};
const memberOne = {
  workspaceMemberId: 'member-one',
  workspace: { id: event.workspaceId },
};
const memberTwo = {
  workspaceMemberId: 'member-two',
  workspace: { id: event.workspaceId },
};

type TestOutboxEvent = Omit<
  typeof event,
  'processingState' | 'leaseToken' | 'leaseExpiresAt'
> & {
  processingState: string;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
};

const buildService = ({
  authorizedMemberIds = ['member-one'],
  publishFailure = false,
  enqueueFailure = false,
  initialEvent = event,
}: {
  authorizedMemberIds?: string[];
  publishFailure?: boolean;
  enqueueFailure?: boolean;
  initialEvent?: TestOutboxEvent;
} = {}) => {
  const persistedEvent = { ...initialEvent };
  const claimRepository = {
    findOne: jest.fn().mockImplementation(async () => persistedEvent),
    save: jest.fn().mockImplementation(async (value) => value),
  };
  const outboxEventRepository = {
    update: jest.fn().mockImplementation(async (_criteria, values) => {
      Object.assign(persistedEvent, values);

      return { affected: 1 };
    }),
    find: jest.fn().mockResolvedValue([persistedEvent]),
  };
  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(async (callback) =>
        callback({ getRepository: jest.fn().mockReturnValue(claimRepository) }),
      ),
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(message),
    }),
  };
  const messageQueueService = {
    add: enqueueFailure
      ? jest.fn().mockRejectedValue(new Error('queue unavailable'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const authorizationService = {
    findAuthorizedConversation: jest
      .fn()
      .mockImplementation(
        async ({ authContext }: { authContext: typeof memberOne }) =>
          authorizedMemberIds.includes(authContext.workspaceMemberId)
            ? { id: message.conversationId }
            : null,
      ),
  };
  const recipientService = {
    getCandidateAuthContexts: jest
      .fn()
      .mockResolvedValue([memberOne, memberTwo]),
  };
  const realtimePublisherService = {
    publishToMember: publishFailure
      ? jest.fn().mockRejectedValue(new Error('redis unavailable'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new InconnectMessagingOutboxService(
    dataSource as never,
    outboxEventRepository as never,
    messageQueueService as never,
    authorizationService as never,
    recipientService as never,
    realtimePublisherService as never,
  );

  return {
    service,
    persistedEvent,
    outboxEventRepository,
    messageQueueService,
    authorizationService,
    realtimePublisherService,
  };
};

describe('InconnectMessagingOutboxService', () => {
  it('requests immediate publication with the recovery-safe job identity', async () => {
    const { service, messageQueueService } = buildService();

    await expect(service.requestPublication(event)).resolves.toBe(true);
    expect(messageQueueService.add).toHaveBeenCalledWith(
      'InconnectMessagingOutboxPublishingJob',
      { outboxEventId: event.id },
      {
        id: `inconnect-messaging-outbox:${event.id}`,
        retryLimit: 5,
      },
    );
  });

  it('keeps a committed pending event recoverable when immediate enqueue fails', async () => {
    const { service, persistedEvent, outboxEventRepository } = buildService({
      enqueueFailure: true,
    });

    await expect(service.requestPublication(event)).resolves.toBe(false);
    expect(persistedEvent.processingState).toBe('PENDING');
    expect(outboxEventRepository.update).not.toHaveBeenCalled();
  });

  it('uses the same idempotency prefix for immediate and recovery enqueue', async () => {
    const { service, messageQueueService } = buildService();

    await service.requestPublication(event);
    await service.recoverPublishableEvents();

    expect(messageQueueService.add).toHaveBeenCalledTimes(2);
    expect(messageQueueService.add.mock.calls[0]?.[2]).toEqual(
      messageQueueService.add.mock.calls[1]?.[2],
    );
  });

  it('claims and publishes a minimal inbound hint only to authorized members', async () => {
    const { service, persistedEvent, realtimePublisherService } =
      buildService();

    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).toHaveBeenCalledTimes(1);
    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith({
      workspaceId: event.workspaceId,
      workspaceMemberId: 'member-one',
      hint: {
        eventId: event.id,
        eventType: 'MESSAGE_CREATED',
        conversationId: message.conversationId,
        messageId: message.id,
        occurredAt: event.createdAt,
      },
    });
    expect(
      JSON.stringify(realtimePublisherService.publishToMember.mock.calls),
    ).not.toContain('body');
    expect(persistedEvent.processingState).toBe('PUBLISHED');
    expect(persistedEvent.attemptCount).toBe(1);
  });

  it('supports partial member fanout without publishing to outsiders', async () => {
    const { service, authorizationService, realtimePublisherService } =
      buildService({ authorizedMemberIds: ['member-two'] });

    await service.publishEvent(event.id);

    expect(
      authorizationService.findAuthorizedConversation,
    ).toHaveBeenCalledTimes(2);
    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMemberId: 'member-two' }),
    );
    expect(realtimePublisherService.publishToMember).not.toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMemberId: 'member-one' }),
    );
  });

  it('marks publication complete when no member is currently authorized', async () => {
    const { service, persistedEvent, realtimePublisherService } = buildService({
      authorizedMemberIds: [],
    });

    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).not.toHaveBeenCalled();
    expect(persistedEvent.processingState).toBe('PUBLISHED');
  });

  it('releases failed realtime publication for durable retry', async () => {
    const { service, persistedEvent } = buildService({ publishFailure: true });

    await expect(service.publishEvent(event.id)).rejects.toThrow(
      'redis unavailable',
    );
    expect(persistedEvent.processingState).toBe('PENDING');
    expect(persistedEvent.leaseToken).toBeNull();
    expect(persistedEvent.error).toEqual({
      category: 'REALTIME_PUBLISH_FAILED',
    });
  });

  it('accepts an expired lease after publisher restart', async () => {
    const { service, persistedEvent, realtimePublisherService } = buildService({
      initialEvent: {
        ...event,
        processingState: 'PROCESSING',
        leaseToken: 'old-lease',
        leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).toHaveBeenCalled();
    expect(persistedEvent.processingState).toBe('PUBLISHED');
  });

  it('is duplicate-safe after successful publication', async () => {
    const { service, realtimePublisherService } = buildService();

    await service.publishEvent(event.id);
    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).toHaveBeenCalledTimes(1);
  });

  it('maps status changes to a status-only hint', async () => {
    const { service, realtimePublisherService } = buildService({
      initialEvent: {
        ...event,
        eventType: 'OUTBOUND_MESSAGE_STATUS_CHANGED',
      },
    });

    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith(
      expect.objectContaining({
        hint: expect.objectContaining({
          eventType: 'MESSAGE_STATUS_CHANGED',
        }),
      }),
    );
  });

  it('maps outbound creation to the existing message-created hint', async () => {
    const { service, realtimePublisherService } = buildService({
      initialEvent: {
        ...event,
        eventType: 'OUTBOUND_MESSAGE_CREATED',
      },
    });

    await service.publishEvent(event.id);

    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith(
      expect.objectContaining({
        hint: expect.objectContaining({ eventType: 'MESSAGE_CREATED' }),
      }),
    );
  });

  it('maps a shared Pending change to a minimal authorized Conversation hint', async () => {
    const { service, authorizationService, realtimePublisherService } =
      buildService({
        initialEvent: {
          ...event,
          aggregateType: 'CONVERSATION',
          eventType: 'CONVERSATION_PENDING_CHANGED',
        },
      });

    await service.publishEvent(event.id);

    expect(
      authorizationService.findAuthorizedConversation,
    ).toHaveBeenCalledTimes(2);
    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMemberId: 'member-one',
        hint: {
          eventId: event.id,
          eventType: 'CONVERSATION_UPDATED',
          conversationId: event.aggregateId,
          messageId: null,
          occurredAt: event.createdAt,
        },
      }),
    );
    expect(
      JSON.stringify(realtimePublisherService.publishToMember.mock.calls),
    ).not.toContain('workspaceMemberId":"member-two');
    expect(
      JSON.stringify(realtimePublisherService.publishToMember.mock.calls),
    ).not.toContain('pendingAt');
  });

  it('maps a shared link transition to the same authorized Conversation hint', async () => {
    const { service, authorizationService, realtimePublisherService } =
      buildService({
        initialEvent: {
          ...event,
          aggregateType: 'CONVERSATION',
          eventType: 'CONVERSATION_LINKED',
        },
      });

    await service.publishEvent(event.id);

    expect(
      authorizationService.findAuthorizedConversation,
    ).toHaveBeenCalledTimes(2);
    expect(realtimePublisherService.publishToMember).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMemberId: 'member-one',
        hint: expect.objectContaining({
          eventType: 'CONVERSATION_UPDATED',
          conversationId: event.aggregateId,
          messageId: null,
        }),
      }),
    );
  });

  it('recovery enqueues persisted pending or expired events', async () => {
    const { service, messageQueueService } = buildService();

    await expect(service.recoverPublishableEvents()).resolves.toBe(1);
    expect(messageQueueService.add).toHaveBeenCalledWith(
      'InconnectMessagingOutboxPublishingJob',
      { outboxEventId: event.id },
      expect.objectContaining({
        id: `inconnect-messaging-outbox:${event.id}`,
      }),
    );
  });
});
