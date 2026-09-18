import { Injectable } from '@nestjs/common';

import { v5 as uuidv5 } from 'uuid';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectMessagingTemplateDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';
import { type InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import {
  type InconnectMessagingOutboundMediaCapabilities,
  type InconnectMessagingProviderTemplate,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingAuthorizedProviderContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorized-provider-context.service';
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
  outboundMediaCapabilities: InconnectMessagingOutboundMediaCapabilities | null;
  catalogAvailable: boolean;
  templates: InconnectMessagingCatalogTemplate[];
};

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
    private readonly authorizedProviderContextService: InconnectMessagingAuthorizedProviderContextService,
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
    const providerContext =
      await this.authorizedProviderContextService.getAuthorizedContext({
        authContext,
        conversationId,
      });

    if (providerContext === null) {
      return null;
    }

    const { conversation } = providerContext;

    if (providerContext.availability === 'UNAVAILABLE') {
      return {
        conversation,
        supportsFreeform: false,
        supportsTemplates: false,
        outboundMediaCapabilities: null,
        catalogAvailable: false,
        templates: [],
      };
    }

    const supportsFreeform =
      providerContext.provider.capabilities.includes('DISPATCH_FREEFORM');
    const supportsTemplates =
      providerContext.provider.capabilities.includes('DISPATCH_TEMPLATE');
    const outboundMediaCapabilities =
      providerContext.provider.capabilities.includes('DISPATCH_MEDIA')
        ? (providerContext.provider.outboundMediaCapabilities ?? null)
        : null;

    if (
      !supportsTemplates ||
      providerContext.provider.listTemplates === undefined
    ) {
      return {
        conversation,
        supportsFreeform,
        supportsTemplates,
        outboundMediaCapabilities,
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
        outboundMediaCapabilities,
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
        outboundMediaCapabilities,
        catalogAvailable: false,
        templates: [],
      };
    }
  }
}
