import { type EntityManager } from 'typeorm';

import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';
import { buildInconnectMessagingTemplateDefinitionFingerprint } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-template.util';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

const buildService = () => {
  const attempt = {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId,
    messageId,
    attemptNumber: 1,
    startedAt: new Date(Date.now() - 60_000),
    leaseToken: null as string | null,
    leaseExpiresAt: null as Date | null,
    providerRequestStartedAt: null as Date | null,
    outcome: null as string | null,
    completedAt: null as Date | null,
    error: null as Record<string, unknown> | null,
  };
  const message = {
    id: messageId,
    workspaceId,
    providerConnectionId: '44444444-4444-4444-8444-444444444444',
    conversationId: '55555555-5555-4555-8555-555555555555',
    direction: 'OUTBOUND',
    type: 'TEXT',
    sendMode: 'FREEFORM',
    body: 'Hola',
    templateId: null as string | null,
    templateProviderReference: null as string | null,
    templateDisplayName: null as string | null,
    templateLanguage: null as string | null,
    templateVariables: null as Record<string, string> | null,
    templateDefinitionFingerprint: null as string | null,
    outboundState: 'QUEUED',
    providerMessageId: null as string | null,
    providerStatus: null as string | null,
  };
  const connection = {
    id: message.providerConnectionId,
    workspaceId,
    provider: 'FAKE',
    channel: 'WHATSAPP',
    normalizedSenderAddress: '+14155238886',
    inboundRoutingKey: 'route-1',
    encryptedCredentials: 'encrypted',
  };
  const conversation = {
    id: message.conversationId,
    workspaceId,
    providerConnectionId: connection.id,
    externalAddressNormalized: '+525512345678',
    lastInboundAt: new Date(Date.now() - 60_000),
  };
  const attemptRepository = {
    findOne: jest
      .fn()
      .mockImplementation(
        async (options: { where: Record<string, unknown> }) => {
          if ('outcome' in options.where && attempt.outcome !== null)
            return null;
          if (
            'leaseToken' in options.where &&
            attempt.leaseToken !== options.where.leaseToken
          )
            return null;

          return attempt;
        },
      ),
    find: jest
      .fn()
      .mockImplementation(async () =>
        attempt.outcome === null ? [attempt] : [],
      ),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest
      .fn()
      .mockImplementation(
        async (_where: unknown, values: { providerRequestStartedAt: Date }) => {
          attempt.providerRequestStartedAt = values.providerRequestStartedAt;

          return { affected: 1 };
        },
      ),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(message),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const connectionRepository = {
    findOne: jest.fn().mockResolvedValue(connection),
  };
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
  const outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
  const getRepository = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === InconnectMessagingDispatchAttemptEntity)
      return attemptRepository;
    if (entity === InconnectMessagingMessageEntity) return messageRepository;
    if (entity === InconnectMessagingProviderConnectionEntity)
      return connectionRepository;
    if (entity === InconnectMessagingConversationEntity)
      return conversationRepository;
    if (entity === InconnectMessagingOutboxEventEntity) return outboxRepository;
    throw new Error('Unexpected repository');
  });
  const manager = { getRepository } as unknown as EntityManager;
  const dataSource = {
    getRepository,
    transaction: jest
      .fn()
      .mockImplementation(
        async (callback: (manager: EntityManager) => Promise<unknown>) =>
          callback(manager),
      ),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const provider = {
    capabilities: ['DISPATCH_FREEFORM', 'DISPATCH_TEMPLATE'],
    listTemplates: jest.fn(),
    dispatch: jest.fn().mockResolvedValue({
      kind: 'ACCEPTED',
      providerMessageId: 'SM123',
      providerStatus: 'queued',
    }),
  };
  const providerRegistry = { resolve: jest.fn().mockReturnValue(provider) };
  const encryption = {
    decryptVersionedOrThrow: jest
      .fn()
      .mockReturnValue(
        JSON.stringify({ accountSid: 'AC123', authToken: 'secret' }),
      ),
  };
  const outbox = { requestPublication: jest.fn().mockResolvedValue(true) };
  const service = new InconnectMessagingDispatchService(
    dataSource as never,
    attemptRepository as never,
    queue as never,
    providerRegistry as never,
    encryption as never,
    outbox as never,
  );

  return {
    service,
    attempt,
    message,
    conversation,
    attemptRepository,
    outboxRepository,
    queue,
    provider,
    outbox,
  };
};

describe('InconnectMessagingDispatchService', () => {
  it('claims, submits once and projects QUEUED to SENDING to SENT', async () => {
    const fixture = buildService();

    await fixture.service.dispatchMessage(messageId);
    expect(fixture.provider.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.provider.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId,
        externalAddressNormalized: '+525512345678',
        senderAddressNormalized: '+14155238886',
        content: { kind: 'FREEFORM_TEXT', body: 'Hola' },
      }),
    );
    expect(fixture.message.outboundState).toBe('SENT');
    expect(fixture.message.providerMessageId).toBe('SM123');
    expect(fixture.attempt.outcome).toBe('ACCEPTED');
    expect(fixture.outboxRepository.insert).toHaveBeenCalledTimes(2);
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.provider.dispatch).toHaveBeenCalledTimes(1);
  });

  it('moves an ambiguous provider outcome to UNKNOWN without automatic retry', async () => {
    const fixture = buildService();

    fixture.provider.dispatch.mockResolvedValue({ kind: 'UNKNOWN' });
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.message.outboundState).toBe('UNKNOWN');
    expect(fixture.attempt.outcome).toBe('UNKNOWN');
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.provider.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.queue.add).not.toHaveBeenCalled();
  });

  it('preserves a callback that advances the projection before SDK completion', async () => {
    const fixture = buildService();

    fixture.provider.dispatch.mockImplementation(async () => {
      fixture.message.providerMessageId = 'SM123';
      fixture.message.providerStatus = 'delivered';
      fixture.message.outboundState = 'DELIVERED';

      return {
        kind: 'ACCEPTED',
        providerMessageId: 'SM123',
        providerStatus: 'queued',
      };
    });
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.message.outboundState).toBe('DELIVERED');
    expect(fixture.message.providerStatus).toBe('delivered');
    expect(fixture.attempt.outcome).toBe('ACCEPTED');
  });

  it('does not resubmit after a lease expires once provider request started', async () => {
    const fixture = buildService();

    fixture.message.outboundState = 'SENDING';
    fixture.attempt.leaseToken = 'old-lease';
    fixture.attempt.leaseExpiresAt = new Date(Date.now() - 60_000);
    fixture.attempt.providerRequestStartedAt = new Date(Date.now() - 120_000);
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.message.outboundState).toBe('UNKNOWN');
    expect(fixture.attempt.outcome).toBe('UNKNOWN');
    expect(fixture.provider.dispatch).not.toHaveBeenCalled();
  });

  it('retries only an explicit safe pre-submit failure', async () => {
    const fixture = buildService();

    fixture.provider.dispatch.mockResolvedValue({
      kind: 'FAILED_BEFORE_SUBMIT',
      error: { code: 'TEMPORARY', message: 'Temporary', retryable: true },
    });
    await fixture.service.dispatchMessage(messageId);
    expect(fixture.message.outboundState).toBe('QUEUED');
    expect(fixture.attempt.outcome).toBe('FAILED_BEFORE_SUBMIT');
    expect(fixture.attemptRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 2 }),
    );
    expect(fixture.queue.add).toHaveBeenCalledTimes(1);
  });

  it('recovers committed work when immediate enqueue fails', async () => {
    const fixture = buildService();

    fixture.queue.add.mockRejectedValueOnce(new Error('queue down'));
    await expect(fixture.service.requestDispatch(messageId)).resolves.toBe(
      false,
    );
    await expect(fixture.service.recoverDispatchableAttempts()).resolves.toBe(
      1,
    );
    expect(fixture.queue.add).toHaveBeenCalledTimes(2);
  });

  it('revalidates and dispatches a durable template without applying the free-form window', async () => {
    const fixture = buildService();
    const template = {
      providerReference: 'opaque-template-reference',
      displayName: 'Appointment reminder',
      language: 'es',
      availability: 'AVAILABLE' as const,
      content: { kind: 'TEXT' as const, body: 'Hola {{1}}' },
      variables: [
        {
          key: '1',
          required: true,
          maxLength: 1600,
          allowsNewlines: false,
        },
      ],
    };

    fixture.message.sendMode = 'TEMPLATE';
    fixture.message.body = 'Hola Ana';
    fixture.message.templateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    fixture.message.templateProviderReference = template.providerReference;
    fixture.message.templateDisplayName = template.displayName;
    fixture.message.templateLanguage = template.language;
    fixture.message.templateVariables = { '1': 'Ana' };
    fixture.message.templateDefinitionFingerprint =
      buildInconnectMessagingTemplateDefinitionFingerprint(template);
    fixture.conversation.lastInboundAt = new Date(
      Date.now() - 25 * 60 * 60 * 1000,
    );
    fixture.provider.listTemplates.mockResolvedValue([template]);

    await fixture.service.dispatchMessage(messageId);
    expect(fixture.provider.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          kind: 'TEMPLATE',
          templateProviderReference: 'opaque-template-reference',
          variables: { '1': 'Ana' },
        },
      }),
    );
    expect(fixture.message.outboundState).toBe('SENT');
  });

  it('fails safely when a durable template is no longer available', async () => {
    const fixture = buildService();

    fixture.message.sendMode = 'TEMPLATE';
    fixture.message.templateProviderReference = 'removed-template';
    fixture.message.templateVariables = {};
    fixture.message.templateDefinitionFingerprint = 'old-fingerprint';
    fixture.provider.listTemplates.mockResolvedValue([]);

    await fixture.service.dispatchMessage(messageId);
    expect(fixture.provider.dispatch).not.toHaveBeenCalled();
    expect(fixture.message.outboundState).toBe('FAILED');
  });
});
