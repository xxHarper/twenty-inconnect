import { Injectable } from '@nestjs/common';

import { createHash, randomUUID } from 'crypto';

import { DataSource } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import {
  ConflictError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingDispatchService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-dispatch.service';
import {
  type InconnectMessagingCatalogTemplate,
  InconnectMessagingTemplateCatalogService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-template-catalog.service';
import {
  type InconnectMessagingOutboxPublicationRequest,
  InconnectMessagingOutboxService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { createInconnectMessagingOutboundOutboxEvent } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbound-outbox.util';
import { isInconnectMessagingFreeformWindowOpen } from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';
import { renderInconnectMessagingTemplateBody } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-template.util';

const MAX_BODY_LENGTH = 4096;

type TemplateVariableInput = { key: string; value: string };

type NormalizedSendIntent =
  | { mode: 'FREEFORM'; body: string }
  | {
      mode: 'TEMPLATE';
      templateId: string;
      variables: Record<string, string>;
    };

@Injectable()
export class InconnectMessagingSendService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly dispatchService: InconnectMessagingDispatchService,
    private readonly outboxService: InconnectMessagingOutboxService,
    private readonly templateCatalogService: InconnectMessagingTemplateCatalogService,
  ) {}

  async sendMessage({
    authContext,
    conversationId,
    clientRequestId,
    mode,
    body,
    templateId,
    templateVariables,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    clientRequestId: string;
    mode: string;
    body?: string;
    templateId?: string;
    templateVariables?: TemplateVariableInput[];
  }): Promise<{ messageId: string; outboundState: string }> {
    const authorizedConversation =
      await this.authorizationService.findAuthorizedConversationForSend({
        authContext,
        conversationId,
      });

    if (authorizedConversation === null || !isUserAuthContext(authContext)) {
      throw new NotFoundError('Conversation not found');
    }

    const workspaceId = authContext.workspace.id;
    const actorId = authContext.workspaceMemberId;
    const intent = this.normalizeIntent({
      mode,
      body,
      templateId,
      templateVariables,
    });
    const scopedClientRequestId = uuidv5(
      `${actorId}:${conversationId}:${clientRequestId}`,
      workspaceId,
    );
    const requestFingerprint = this.buildRequestFingerprint({
      workspaceId,
      actorId,
      conversationId,
      clientRequestId,
      intent,
    });
    const alreadyPersisted = await this.dataSource
      .getRepository(InconnectMessagingMessageEntity)
      .findOne({
        where: {
          workspaceId,
          clientRequestId: scopedClientRequestId,
          direction: 'OUTBOUND',
        },
      });

    if (alreadyPersisted !== null) {
      if (alreadyPersisted.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
      }

      return {
        messageId: alreadyPersisted.id,
        outboundState: alreadyPersisted.outboundState ?? 'QUEUED',
      };
    }

    let selectedTemplate: InconnectMessagingCatalogTemplate | null = null;

    if (intent.mode === 'TEMPLATE') {
      const catalog = await this.templateCatalogService.getAuthorizedCatalog({
        authContext,
        conversationId,
      });

      selectedTemplate =
        catalog?.catalogAvailable === true
          ? (catalog.templates.find(
              (template) => template.id === intent.templateId,
            ) ?? null)
          : null;

      if (selectedTemplate === null) {
        throw new UserInputError('Template is unavailable', {
          subCode: 'TEMPLATE_UNAVAILABLE',
        });
      }

      this.validateTemplateVariables(selectedTemplate, intent.variables);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const messageRepository = manager.getRepository(
        InconnectMessagingMessageEntity,
      );
      const existing = await messageRepository.findOne({
        where: {
          workspaceId,
          clientRequestId: scopedClientRequestId,
          direction: 'OUTBOUND',
        },
      });

      if (existing !== null) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
        }

        return {
          messageId: existing.id,
          outboundState: existing.outboundState ?? 'QUEUED',
          created: false,
          event: null,
        };
      }

      const conversation = await manager
        .getRepository(InconnectMessagingConversationEntity)
        .findOne({
          where: { id: conversationId, workspaceId },
          lock: { mode: 'pessimistic_write' },
        });

      if (
        conversation === null ||
        conversation.providerConnectionId !==
          authorizedConversation.providerConnectionId ||
        conversation.linkedRecordId !== authorizedConversation.linkedRecordId ||
        conversation.linkedRecordObjectMetadataId !==
          authorizedConversation.linkedRecordObjectMetadataId
      ) {
        throw new NotFoundError('Conversation not found');
      }

      const stillAuthorized =
        await this.authorizationService.findAuthorizedConversationForSend({
          authContext,
          conversationId,
        });

      if (stillAuthorized === null) {
        throw new NotFoundError('Conversation not found');
      }

      // The persisted effective inbound instant, not caller data, controls free-form permission.
      if (
        intent.mode === 'FREEFORM' &&
        !isInconnectMessagingFreeformWindowOpen({
          lastInboundAt: conversation.lastInboundAt,
          now: new Date(),
        })
      ) {
        throw new UserInputError('Free-form messaging window is closed', {
          subCode: 'SESSION_WINDOW_CLOSED',
        });
      }

      const connection = await manager
        .getRepository(InconnectMessagingProviderConnectionEntity)
        .findOne({
          where: {
            id: conversation.providerConnectionId,
            workspaceId,
            lifecycleStatus: 'ENABLED',
          },
        });

      if (connection === null || connection.encryptedCredentials === null) {
        throw new UserInputError('Messaging provider is unavailable', {
          subCode: 'PROVIDER_UNAVAILABLE',
        });
      }

      try {
        const provider = this.providerRegistry.resolve({
          provider: connection.provider,
          channel: connection.channel,
        });

        const requiredCapability =
          intent.mode === 'FREEFORM'
            ? 'DISPATCH_FREEFORM'
            : 'DISPATCH_TEMPLATE';

        if (!provider.capabilities.includes(requiredCapability)) {
          throw new Error('Unsupported provider capability');
        }
      } catch {
        throw new UserInputError('Messaging provider is unavailable', {
          subCode: 'PROVIDER_UNAVAILABLE',
        });
      }

      const messageId = randomUUID();
      let templateAudit: InconnectMessagingCatalogTemplate | null = null;
      let renderedBody: string;

      if (intent.mode === 'FREEFORM') {
        renderedBody = intent.body;
      } else {
        if (selectedTemplate === null) {
          throw new UserInputError('Template is unavailable', {
            subCode: 'TEMPLATE_UNAVAILABLE',
          });
        }

        templateAudit = selectedTemplate;
        renderedBody = renderInconnectMessagingTemplateBody({
          body: templateAudit.content.body,
          variables: intent.variables,
        });
      }

      await messageRepository
        .createQueryBuilder()
        .insert()
        .values({
          id: messageId,
          workspaceId,
          conversationId,
          providerConnectionId: connection.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          sendMode: intent.mode,
          body: renderedBody,
          templateId: templateAudit?.id ?? null,
          templateProviderReference: templateAudit?.providerReference ?? null,
          templateDisplayName: templateAudit?.displayName ?? null,
          templateLanguage: templateAudit?.language ?? null,
          templateVariables:
            intent.mode === 'TEMPLATE' ? intent.variables : null,
          templateDefinitionFingerprint:
            templateAudit?.definitionFingerprint ?? null,
          outboundState: 'QUEUED',
          providerMessageId: null,
          providerStatus: null,
          clientRequestId: scopedClientRequestId,
          requestFingerprint,
          retryOfMessageId: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          error: null,
          providerMetadata: null,
          serverReceivedAt: null,
          providerOccurredAt: null,
          effectiveInboundAt: null,
          timestampSource: null,
        })
        .orIgnore()
        .execute();

      const persisted = await messageRepository.findOne({
        where: {
          workspaceId,
          clientRequestId: scopedClientRequestId,
          direction: 'OUTBOUND',
        },
      });

      if (persisted === null) {
        throw new Error('Outbound message persistence failed');
      }

      if (persisted.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
      }

      if (persisted.id !== messageId) {
        return {
          messageId: persisted.id,
          outboundState: persisted.outboundState ?? 'QUEUED',
          created: false,
          event: null,
        };
      }

      await manager
        .getRepository(InconnectMessagingDispatchAttemptEntity)
        .insert({
          workspaceId,
          messageId,
          attemptNumber: 1,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: new Date(),
          providerRequestStartedAt: null,
          completedAt: null,
          outcome: null,
          error: null,
          providerMetadata: null,
        });

      const event = await createInconnectMessagingOutboundOutboxEvent({
        manager,
        workspaceId,
        messageId,
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        deduplicationKey: `inconnect-messaging:message:${messageId}:created`,
      });

      return { messageId, outboundState: 'QUEUED', created: true, event };
    });

    // Both transports are best-effort after commit; PostgreSQL recovery is authoritative.
    if (created.created) {
      await this.dispatchService.requestDispatch(created.messageId);
      if (created.event !== null) {
        await this.outboxService.requestPublication(
          created.event as InconnectMessagingOutboxPublicationRequest,
        );
      }
    }

    return {
      messageId: created.messageId,
      outboundState: created.outboundState,
    };
  }

  async sendFreeformText(args: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    clientRequestId: string;
    body: string;
  }): Promise<{ messageId: string; outboundState: string }> {
    return this.sendMessage({ ...args, mode: 'FREEFORM' });
  }

  private normalizeIntent({
    mode,
    body,
    templateId,
    templateVariables,
  }: {
    mode: string;
    body?: string;
    templateId?: string;
    templateVariables?: TemplateVariableInput[];
  }): NormalizedSendIntent {
    if (mode === 'FREEFORM') {
      if (
        body === undefined ||
        body.trim().length === 0 ||
        body.length > MAX_BODY_LENGTH ||
        templateId !== undefined ||
        templateVariables !== undefined
      ) {
        throw new UserInputError('Invalid message', {
          subCode: 'INVALID_MESSAGE',
        });
      }

      return { mode, body };
    }

    if (
      mode !== 'TEMPLATE' ||
      body !== undefined ||
      templateId === undefined ||
      templateId.length === 0
    ) {
      throw new UserInputError('Invalid message mode', {
        subCode: 'INVALID_MESSAGE_MODE',
      });
    }

    const variables: Record<string, string> = {};

    for (const variable of templateVariables ?? []) {
      if (
        variable.key.length === 0 ||
        Object.prototype.hasOwnProperty.call(variables, variable.key)
      ) {
        throw new UserInputError('Invalid template variables', {
          subCode: 'INVALID_TEMPLATE_VARIABLES',
        });
      }

      variables[variable.key] = variable.value;
    }

    return {
      mode,
      templateId,
      variables: Object.fromEntries(
        Object.entries(variables).sort(([left], [right]) =>
          left.localeCompare(right, 'en', { numeric: true }),
        ),
      ),
    };
  }

  private validateTemplateVariables(
    template: InconnectMessagingCatalogTemplate,
    variables: Record<string, string>,
  ): void {
    const expectedKeys = template.variables
      .map(({ key }) => key)
      .sort((left, right) =>
        left.localeCompare(right, 'en', { numeric: true }),
      );
    const actualKeys = Object.keys(variables).sort((left, right) =>
      left.localeCompare(right, 'en', { numeric: true }),
    );
    const variablesAreValid =
      JSON.stringify(expectedKeys) === JSON.stringify(actualKeys) &&
      template.variables.every((definition) => {
        const value = variables[definition.key];

        return (
          typeof value === 'string' &&
          (!definition.required || value.trim().length > 0) &&
          value.length <= definition.maxLength &&
          (definition.allowsNewlines || !/[\r\n]/.test(value))
        );
      });

    if (!variablesAreValid) {
      throw new UserInputError('Invalid template variables', {
        subCode: 'INVALID_TEMPLATE_VARIABLES',
      });
    }
  }

  private buildRequestFingerprint({
    workspaceId,
    actorId,
    conversationId,
    clientRequestId,
    intent,
  }: {
    workspaceId: string;
    actorId: string;
    conversationId: string;
    clientRequestId: string;
    intent: NormalizedSendIntent;
  }): string {
    const content =
      intent.mode === 'FREEFORM'
        ? ['TEXT', 'FREEFORM', intent.body]
        : ['TEXT', 'TEMPLATE', intent.templateId, intent.variables];

    return createHash('sha256')
      .update(
        JSON.stringify([
          workspaceId,
          actorId,
          conversationId,
          clientRequestId,
          ...content,
        ]),
      )
      .digest('hex');
  }
}
