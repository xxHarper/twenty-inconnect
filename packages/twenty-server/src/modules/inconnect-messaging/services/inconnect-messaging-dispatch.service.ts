import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import {
  DataSource,
  IsNull,
  LessThanOrEqual,
  type EntityManager,
  type Repository,
} from 'typeorm';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { INCONNECT_MESSAGING_DISPATCH_JOB_NAME } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-dispatch-job-name.constant';
import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { createInconnectMessagingOutboundOutboxEvent } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbound-outbox.util';
import { isInconnectMessagingFreeformWindowOpen } from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';
import { resolveInconnectMessagingOutboundStateTransition } from 'src/modules/inconnect-messaging/state-machine/outbound-message-state-machine';
import {
  type InconnectMessagingJson,
  type InconnectMessagingOutboundState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';
import { buildInconnectMessagingTemplateDefinitionFingerprint } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-template.util';

const LEASE_MILLISECONDS = 5 * 60 * 1000;
const RETRY_DELAY_MILLISECONDS = 15 * 1000;
const MAX_SAFE_ATTEMPTS = 3;
const RECOVERY_BATCH_SIZE = 100;

type Claim = {
  attemptId: string;
  leaseToken: string;
  message: InconnectMessagingMessageEntity;
};

@Injectable()
export class InconnectMessagingDispatchService {
  private readonly logger = new Logger(InconnectMessagingDispatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- Recovery scans durable attempts across workspaces; the claimed Message and Connection remain workspace constrained.
    @InjectRepository(InconnectMessagingDispatchAttemptEntity)
    private readonly attemptRepository: Repository<InconnectMessagingDispatchAttemptEntity>,
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly outboxService: InconnectMessagingOutboxService,
  ) {}

  async requestDispatch(messageId: string): Promise<boolean> {
    try {
      await this.messageQueueService.add(
        INCONNECT_MESSAGING_DISPATCH_JOB_NAME,
        { messageId },
        { id: `inconnect-messaging-dispatch:${messageId}`, retryLimit: 0 },
      );

      return true;
    } catch {
      this.logger.warn(
        JSON.stringify({ messageId, result: 'ENQUEUE_FAILED_RECOVERABLE' }),
      );

      return false;
    }
  }

  async recoverDispatchableAttempts(now = new Date()): Promise<number> {
    const attempts = await this.attemptRepository.find({
      select: ['messageId'],
      where: [
        {
          outcome: IsNull(),
          startedAt: LessThanOrEqual(now),
          leaseToken: IsNull(),
        },
        {
          outcome: IsNull(),
          startedAt: LessThanOrEqual(now),
          leaseExpiresAt: LessThanOrEqual(now),
        },
      ],
      order: { startedAt: 'ASC' },
      take: RECOVERY_BATCH_SIZE,
    });
    let enqueued = 0;

    for (const attempt of attempts) {
      if (await this.requestDispatch(attempt.messageId)) {
        enqueued += 1;
      }
    }

    return enqueued;
  }

  async dispatchMessage(messageId: string): Promise<void> {
    const { claim, event } = await this.claim(messageId);

    if (event !== null) {
      await this.outboxService.requestPublication(event);
    }

    if (claim === null) {
      return;
    }

    const result = await this.sendToProvider(claim);
    const completed = await this.complete(claim, result);

    if (completed.event !== null) {
      await this.outboxService.requestPublication(completed.event);
    }

    if (completed.retry) {
      await this.requestDispatch(messageId);
    }
  }

  private async claim(messageId: string): Promise<{
    claim: Claim | null;
    event: InconnectMessagingOutboxPublicationRequest | null;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const attemptRepository = manager.getRepository(
        InconnectMessagingDispatchAttemptEntity,
      );
      const attempt = await attemptRepository.findOne({
        where: { messageId, outcome: IsNull() },
        order: { attemptNumber: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();

      if (
        attempt === null ||
        attempt.startedAt > now ||
        (attempt.leaseExpiresAt !== null && attempt.leaseExpiresAt > now)
      ) {
        return { claim: null, event: null };
      }

      const messageRepository = manager.getRepository(
        InconnectMessagingMessageEntity,
      );
      const message = await messageRepository.findOne({
        where: {
          id: messageId,
          workspaceId: attempt.workspaceId,
          direction: 'OUTBOUND',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        message === null ||
        !['QUEUED', 'SENDING'].includes(message.outboundState ?? '')
      ) {
        return { claim: null, event: null };
      }

      if (attempt.providerRequestStartedAt !== null) {
        // A crashed or late worker may have reached Twilio. Never submit this intent again.
        attempt.outcome = 'UNKNOWN';
        attempt.completedAt = now;
        attempt.error = { category: 'LEASE_EXPIRED_AFTER_SUBMIT_START' };
        await attemptRepository.save(attempt);
        const event = await this.transition(
          manager,
          message,
          'UNKNOWN',
          `attempt:${attempt.id}:expired`,
        );

        return { claim: null, event };
      }

      const leaseToken = randomUUID();

      attempt.leaseToken = leaseToken;
      attempt.leaseExpiresAt = new Date(now.getTime() + LEASE_MILLISECONDS);
      await attemptRepository.save(attempt);
      const event =
        message.outboundState === 'QUEUED'
          ? await this.transition(
              manager,
              message,
              'SENDING',
              `attempt:${attempt.id}:sending`,
            )
          : null;

      return { claim: { attemptId: attempt.id, leaseToken, message }, event };
    });
  }

  private async sendToProvider(
    claim: Claim,
  ): Promise<InconnectMessagingDispatchResult> {
    const { message } = claim;
    const connection = await this.dataSource
      .getRepository(InconnectMessagingProviderConnectionEntity)
      .findOne({
        where: {
          id: message.providerConnectionId,
          workspaceId: message.workspaceId,
          lifecycleStatus: 'ENABLED',
        },
      });
    const conversation = await this.dataSource
      .getRepository(InconnectMessagingConversationEntity)
      .findOne({
        where: {
          id: message.conversationId,
          workspaceId: message.workspaceId,
          providerConnectionId: message.providerConnectionId,
        },
      });

    if (
      connection === null ||
      conversation === null ||
      connection.encryptedCredentials === null
    ) {
      return this.preSubmitFailure('CONNECTION_UNAVAILABLE');
    }

    if (
      message.type !== 'TEXT' ||
      !['FREEFORM', 'TEMPLATE'].includes(message.sendMode ?? '')
    ) {
      return this.preSubmitFailure('UNSUPPORTED_CONTENT');
    }

    if (
      message.sendMode === 'FREEFORM' &&
      !isInconnectMessagingFreeformWindowOpen({
        lastInboundAt: conversation.lastInboundAt,
        now: new Date(),
      })
    ) {
      return this.preSubmitFailure('SESSION_WINDOW_CLOSED');
    }

    let credentials: InconnectMessagingJson;

    try {
      const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
        connection.encryptedCredentials,
        { workspaceId: connection.workspaceId },
      );
      const parsed: unknown = JSON.parse(plaintext);

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return this.preSubmitFailure('CREDENTIALS_UNAVAILABLE');
      }

      credentials = parsed as InconnectMessagingJson;
    } catch {
      return this.preSubmitFailure('CREDENTIALS_UNAVAILABLE');
    }

    let provider;

    try {
      provider = this.providerRegistry.resolve({
        provider: connection.provider,
        channel: connection.channel,
      });

      const requiredCapability =
        message.sendMode === 'FREEFORM'
          ? 'DISPATCH_FREEFORM'
          : 'DISPATCH_TEMPLATE';

      if (!provider.capabilities.includes(requiredCapability)) {
        return this.preSubmitFailure('PROVIDER_UNAVAILABLE');
      }
    } catch {
      return this.preSubmitFailure('PROVIDER_UNAVAILABLE');
    }

    let content: InconnectMessagingDispatchRequest['content'];

    if (message.sendMode === 'FREEFORM') {
      content = { kind: 'FREEFORM_TEXT', body: message.body };
    } else {
      if (
        message.templateProviderReference === null ||
        message.templateVariables === null ||
        message.templateDefinitionFingerprint === null
      ) {
        return this.preSubmitFailure('TEMPLATE_UNAVAILABLE');
      }

      if (provider.listTemplates === undefined) {
        return this.preSubmitFailure('TEMPLATE_UNAVAILABLE');
      }

      let currentTemplates;

      try {
        currentTemplates = await provider.listTemplates({ credentials });
      } catch {
        return this.preSubmitFailure('TEMPLATE_CATALOG_UNAVAILABLE', true);
      }

      const currentTemplate = currentTemplates.find(
        (template) =>
          template.availability === 'AVAILABLE' &&
          template.providerReference === message.templateProviderReference,
      );

      if (
        currentTemplate === undefined ||
        buildInconnectMessagingTemplateDefinitionFingerprint(
          currentTemplate,
        ) !== message.templateDefinitionFingerprint
      ) {
        return this.preSubmitFailure('TEMPLATE_UNAVAILABLE');
      }

      content = {
        kind: 'TEMPLATE',
        templateProviderReference: message.templateProviderReference,
        variables: message.templateVariables,
      };
    }

    // Persist this marker before any SDK send call. A crash after it is conservatively UNKNOWN.
    const marked = await this.attemptRepository.update(
      { id: claim.attemptId, leaseToken: claim.leaseToken, outcome: IsNull() },
      { providerRequestStartedAt: new Date() },
    );

    if (marked.affected !== 1) {
      return {
        kind: 'UNKNOWN',
        error: {
          code: 'LEASE_LOST',
          message: 'Provider outcome is ambiguous',
          retryable: false,
        },
      };
    }

    try {
      return await provider.dispatch({
        workspaceId: message.workspaceId,
        providerConnectionId: message.providerConnectionId,
        messageId: message.id,
        externalAddressNormalized: conversation.externalAddressNormalized,
        senderAddressNormalized: connection.normalizedSenderAddress,
        callbackRoutingKey: connection.inboundRoutingKey,
        credentials,
        content,
      });
    } catch {
      return {
        kind: 'UNKNOWN',
        error: {
          code: 'PROVIDER_OUTCOME_UNKNOWN',
          message: 'Provider outcome is ambiguous',
          retryable: false,
        },
      };
    }
  }

  private preSubmitFailure(
    code: string,
    retryable = false,
  ): InconnectMessagingDispatchResult {
    return {
      kind: 'FAILED_BEFORE_SUBMIT',
      error: {
        code,
        message: 'Message could not be submitted',
        retryable,
      },
    };
  }

  private async complete(
    claim: Claim,
    result: InconnectMessagingDispatchResult,
  ): Promise<{
    event: InconnectMessagingOutboxPublicationRequest | null;
    retry: boolean;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const attemptRepository = manager.getRepository(
        InconnectMessagingDispatchAttemptEntity,
      );
      const attempt = await attemptRepository.findOne({
        where: { id: claim.attemptId, leaseToken: claim.leaseToken },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        attempt === null ||
        (attempt.outcome !== null && attempt.outcome !== 'UNKNOWN')
      ) {
        return { event: null, retry: false };
      }

      const messageRepository = manager.getRepository(
        InconnectMessagingMessageEntity,
      );
      const message = await messageRepository.findOne({
        where: { id: claim.message.id, workspaceId: claim.message.workspaceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (message === null || message.outboundState === null) {
        return { event: null, retry: false };
      }

      const now = new Date();
      const shouldRetry =
        result.kind === 'FAILED_BEFORE_SUBMIT' &&
        result.error.retryable &&
        attempt.attemptNumber < MAX_SAFE_ATTEMPTS &&
        message.outboundState === 'SENDING';
      let targetState: InconnectMessagingOutboundState;

      if (result.kind === 'ACCEPTED') {
        targetState = 'SENT';
        if (
          message.providerMessageId !== null &&
          message.providerMessageId !== result.providerMessageId
        ) {
          throw new Error('Provider message identity conflict');
        }

        message.providerMessageId = result.providerMessageId;
      } else if (shouldRetry) {
        targetState = 'QUEUED';
      } else if (result.kind === 'UNKNOWN') {
        targetState = 'UNKNOWN';
      } else {
        targetState = 'FAILED';
      }

      const transition = resolveInconnectMessagingOutboundStateTransition({
        currentState: message.outboundState,
        targetState,
        trigger: shouldRetry ? 'SAFE_RETRY_PRE_SUBMIT' : 'PROVIDER_CALLBACK',
      });

      if (transition.kind === 'APPLIED') {
        message.outboundState = transition.state;
        if (result.kind === 'ACCEPTED') {
          message.providerStatus = result.providerStatus ?? null;
          message.sentAt ??= now;
        } else if (targetState === 'FAILED') {
          message.failedAt ??= now;
        }

        if (result.kind !== 'ACCEPTED') {
          message.error = {
            category: result.error?.code ?? 'PROVIDER_OUTCOME_UNKNOWN',
          };
        }
      }

      await messageRepository.save(message);
      attempt.outcome = result.kind;
      attempt.completedAt = now;
      attempt.error =
        result.kind === 'ACCEPTED'
          ? null
          : { category: result.error?.code ?? 'PROVIDER_OUTCOME_UNKNOWN' };
      attempt.providerMetadata =
        result.kind === 'ACCEPTED'
          ? { providerMessageId: result.providerMessageId }
          : null;
      attempt.leaseToken = null;
      attempt.leaseExpiresAt = null;
      await attemptRepository.save(attempt);

      if (shouldRetry) {
        await attemptRepository.insert({
          workspaceId: message.workspaceId,
          messageId: message.id,
          attemptNumber: attempt.attemptNumber + 1,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: new Date(now.getTime() + RETRY_DELAY_MILLISECONDS),
          providerRequestStartedAt: null,
          completedAt: null,
          outcome: null,
          error: null,
          providerMetadata: null,
        });
      }

      const event =
        transition.kind === 'APPLIED'
          ? await createInconnectMessagingOutboundOutboxEvent({
              manager,
              workspaceId: message.workspaceId,
              messageId: message.id,
              eventType: 'OUTBOUND_MESSAGE_STATUS_CHANGED',
              deduplicationKey: `inconnect-messaging:attempt:${attempt.id}:${targetState}`,
            })
          : null;

      return { event, retry: shouldRetry };
    });
  }

  private async transition(
    manager: EntityManager,
    message: InconnectMessagingMessageEntity,
    targetState: InconnectMessagingOutboundState,
    deduplicationKey: string,
  ): Promise<InconnectMessagingOutboxPublicationRequest | null> {
    if (message.outboundState === null) {
      return null;
    }

    const transition = resolveInconnectMessagingOutboundStateTransition({
      currentState: message.outboundState,
      targetState,
      trigger:
        targetState === 'SENDING' ? 'DISPATCH_STARTED' : 'PROVIDER_CALLBACK',
    });

    if (transition.kind !== 'APPLIED') {
      return null;
    }

    message.outboundState = transition.state;
    if (targetState === 'UNKNOWN') {
      message.error = { category: 'LEASE_EXPIRED_AFTER_SUBMIT_START' };
    }

    await manager.getRepository(InconnectMessagingMessageEntity).save(message);

    return createInconnectMessagingOutboundOutboxEvent({
      manager,
      workspaceId: message.workspaceId,
      messageId: message.id,
      eventType: 'OUTBOUND_MESSAGE_STATUS_CHANGED',
      deduplicationKey,
    });
  }
}
