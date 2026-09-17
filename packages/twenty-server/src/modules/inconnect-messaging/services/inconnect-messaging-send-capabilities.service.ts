import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectMessagingSendCapabilitiesDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';
import { InconnectMessagingTemplateCatalogService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-template-catalog.service';
import {
  INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS,
  isInconnectMessagingFreeformWindowOpen,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';

@Injectable()
export class InconnectMessagingSendCapabilitiesService {
  constructor(
    private readonly templateCatalogService: InconnectMessagingTemplateCatalogService,
  ) {}

  async getCapabilities({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingSendCapabilitiesDTO | null> {
    const catalog = await this.templateCatalogService.getAuthorizedCatalog({
      authContext,
      conversationId,
    });

    if (catalog === null) {
      return null;
    }

    const now = new Date();
    const isWindowOpen = isInconnectMessagingFreeformWindowOpen({
      lastInboundAt: catalog.conversation.lastInboundAt,
      now,
    });
    const canSendFreeform = catalog.supportsFreeform && isWindowOpen;
    const canSendTemplate =
      catalog.supportsTemplates &&
      catalog.catalogAvailable &&
      catalog.templates.length > 0;
    const freeformWindowExpiresAt =
      isWindowOpen && catalog.conversation.lastInboundAt !== null
        ? new Date(
            catalog.conversation.lastInboundAt.getTime() +
              INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS,
          )
        : null;

    return {
      canSend: canSendFreeform || canSendTemplate,
      canSendFreeform,
      canSendTemplate,
      sessionWindowState: isWindowOpen ? 'OPEN' : 'CLOSED',
      freeformWindowExpiresAt,
      freeformUnavailableReason: canSendFreeform
        ? null
        : catalog.supportsFreeform
          ? 'SESSION_WINDOW_CLOSED'
          : 'PROVIDER_UNAVAILABLE',
      templateUnavailableReason: canSendTemplate
        ? null
        : !catalog.supportsTemplates
          ? 'TEMPLATES_UNSUPPORTED'
          : !catalog.catalogAvailable
            ? 'TEMPLATE_CATALOG_UNAVAILABLE'
            : 'NO_TEMPLATES_AVAILABLE',
    };
  }
}
