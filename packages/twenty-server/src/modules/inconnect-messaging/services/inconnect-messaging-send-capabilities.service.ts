import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectMessagingSendCapabilitiesDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-template.dto';
import {
  getInconnectMessagingAllowedMimeTypesForType,
  getInconnectMessagingOutboundMaximumBytes,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-media-policy.constant';
import { InconnectMessagingAuthorizedProviderContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorized-provider-context.service';
import {
  INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS,
  isInconnectMessagingFreeformWindowOpen,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-session-window.policy';
import { INCONNECT_MESSAGING_ATTACHMENT_TYPES } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Injectable()
export class InconnectMessagingSendCapabilitiesService {
  constructor(
    private readonly authorizedProviderContextService: InconnectMessagingAuthorizedProviderContextService,
  ) {}

  async getCapabilities({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingSendCapabilitiesDTO | null> {
    const providerContext =
      await this.authorizedProviderContextService.getAuthorizedContext({
        authContext,
        conversationId,
      });

    if (providerContext === null) {
      return null;
    }

    const provider =
      providerContext.availability === 'AVAILABLE'
        ? providerContext.provider
        : null;
    const supportsFreeform =
      provider?.capabilities.includes('DISPATCH_FREEFORM') ?? false;
    const supportsTemplates =
      provider?.capabilities.includes('DISPATCH_TEMPLATE') ?? false;
    const mediaCapabilities =
      provider?.capabilities.includes('DISPATCH_MEDIA') === true
        ? (provider.outboundMediaCapabilities ?? null)
        : null;
    const now = new Date();
    const isWindowOpen = isInconnectMessagingFreeformWindowOpen({
      lastInboundAt: providerContext.conversation.lastInboundAt,
      now,
    });
    const canSendFreeform = supportsFreeform && isWindowOpen;
    const canSendTemplate = supportsTemplates;
    const freeformWindowExpiresAt =
      isWindowOpen && providerContext.conversation.lastInboundAt !== null
        ? new Date(
            providerContext.conversation.lastInboundAt.getTime() +
              INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS,
          )
        : null;
    const mediaTypes = mediaCapabilities
      ? INCONNECT_MESSAGING_ATTACHMENT_TYPES.map((type) => ({
          type,
          mimeTypes: getInconnectMessagingAllowedMimeTypesForType(type).filter(
            (mimeType) =>
              mediaCapabilities.supportedMimeTypesByType[type].includes(
                mimeType,
              ),
          ),
          maxBytes: getInconnectMessagingOutboundMaximumBytes(type),
          captionSupported:
            mediaCapabilities.captionSupportedTypes.includes(type),
        })).filter(({ mimeTypes }) => mimeTypes.length > 0)
      : [];

    return {
      canSend: canSendFreeform || canSendTemplate,
      canSendFreeform,
      canSendTemplate,
      canSendMedia:
        canSendFreeform &&
        mediaCapabilities !== null &&
        mediaCapabilities.maximumAttachments > 0 &&
        mediaTypes.length > 0,
      maxMediaItems: mediaCapabilities?.maximumAttachments ?? 0,
      mediaTypes,
      sessionWindowState: isWindowOpen ? 'OPEN' : 'CLOSED',
      freeformWindowExpiresAt,
      freeformUnavailableReason: canSendFreeform
        ? null
        : supportsFreeform
          ? 'SESSION_WINDOW_CLOSED'
          : 'PROVIDER_UNAVAILABLE',
      templateUnavailableReason: canSendTemplate
        ? null
        : 'TEMPLATES_UNSUPPORTED',
    };
  }
}
