import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type InconnectMessagingTemplateDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';
import { type InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import {
  type InconnectMessagingProviderTemplate,
  type InconnectMessagingProvider,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { type InconnectMessagingJson } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';
import { buildInconnectMessagingTemplateDefinitionFingerprint } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-template.util';

export type InconnectMessagingCatalogTemplate =
  InconnectMessagingProviderTemplate & {
    id: string;
    definitionFingerprint: string;
  };

export type InconnectMessagingAuthorizedCatalog = {
  conversation: InconnectMessagingConversationEntity;
  supportsFreeform: boolean;
  supportsTemplates: boolean;
  catalogAvailable: boolean;
  templates: InconnectMessagingCatalogTemplate[];
};

const isJsonObject = (value: unknown): value is InconnectMessagingJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidTemplate = (
  template: InconnectMessagingProviderTemplate,
): boolean => {
  const variableKeys = new Set<string>();

  return (
    template.availability === 'AVAILABLE' &&
    template.providerReference.trim().length > 0 &&
    template.providerReference.length <= 512 &&
    template.displayName.trim().length > 0 &&
    template.displayName.length <= 256 &&
    template.language.trim().length > 0 &&
    template.language.length <= 35 &&
    template.content.kind === 'TEXT' &&
    template.content.body.length > 0 &&
    template.content.body.length <= 32_000 &&
    template.variables.length <= 100 &&
    template.variables.every((variable) => {
      const valid =
        variable.key.length > 0 &&
        variable.key.length <= 64 &&
        !variableKeys.has(variable.key) &&
        Number.isInteger(variable.maxLength) &&
        variable.maxLength > 0 &&
        variable.maxLength <= 10_000;

      variableKeys.add(variable.key);

      return valid;
    })
  );
};

@Injectable()
export class InconnectMessagingTemplateCatalogService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  async getTemplates({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingTemplateDTO[] | null> {
    const catalog = await this.getAuthorizedCatalog({
      authContext,
      conversationId,
    });

    if (catalog === null) {
      return null;
    }

    return catalog.templates.map((template) => ({
      id: template.id,
      displayName: template.displayName,
      language: template.language,
      body: template.content.body,
      variables: template.variables.map(({ key, required, maxLength }) => ({
        key,
        required,
        maxLength,
      })),
    }));
  }

  async getAuthorizedCatalog({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingAuthorizedCatalog | null> {
    const conversation =
      await this.authorizationService.findAuthorizedConversationForSend({
        authContext,
        conversationId,
      });

    if (conversation === null) {
      return null;
    }

    const providerContext = await this.resolveProviderContext(conversation);

    if (providerContext === null) {
      return {
        conversation,
        supportsFreeform: false,
        supportsTemplates: false,
        catalogAvailable: false,
        templates: [],
      };
    }

    const supportsFreeform =
      providerContext.provider.capabilities.includes('DISPATCH_FREEFORM');
    const supportsTemplates =
      providerContext.provider.capabilities.includes('DISPATCH_TEMPLATE');

    if (
      !supportsTemplates ||
      providerContext.provider.listTemplates === undefined
    ) {
      return {
        conversation,
        supportsFreeform,
        supportsTemplates,
        catalogAvailable: true,
        templates: [],
      };
    }

    try {
      const templates = await providerContext.provider.listTemplates({
        credentials: providerContext.credentials,
      });

      return {
        conversation,
        supportsFreeform,
        supportsTemplates,
        catalogAvailable: true,
        templates: templates.filter(isValidTemplate).map((template) => ({
          ...template,
          id: uuidv5(
            template.providerReference,
            conversation.providerConnectionId,
          ),
          definitionFingerprint:
            buildInconnectMessagingTemplateDefinitionFingerprint(template),
        })),
      };
    } catch {
      return {
        conversation,
        supportsFreeform,
        supportsTemplates,
        catalogAvailable: false,
        templates: [],
      };
    }
  }

  private async resolveProviderContext(
    conversation: InconnectMessagingConversationEntity,
  ): Promise<{
    provider: InconnectMessagingProvider;
    credentials: InconnectMessagingJson;
  } | null> {
    const connection = await this.dataSource
      .getRepository(InconnectMessagingProviderConnectionEntity)
      .findOne({
        where: {
          id: conversation.providerConnectionId,
          workspaceId: conversation.workspaceId,
          lifecycleStatus: 'ENABLED',
        },
      });

    if (connection === null || connection.encryptedCredentials === null) {
      return null;
    }

    try {
      const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
        connection.encryptedCredentials,
        { workspaceId: connection.workspaceId },
      );
      const credentials: unknown = JSON.parse(plaintext);

      if (!isJsonObject(credentials)) {
        return null;
      }

      return {
        credentials,
        provider: this.providerRegistry.resolve({
          provider: connection.provider,
          channel: connection.channel,
        }),
      };
    } catch {
      return null;
    }
  }
}
