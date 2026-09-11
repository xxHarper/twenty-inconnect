import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { TWILIO_WHATSAPP_PROVIDER_KEY } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';

@Injectable()
export class InconnectMessagingWebhookIngressService {
  private readonly logger = new Logger(
    InconnectMessagingWebhookIngressService.name,
  );

  public constructor(
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly providerConnectionRoutingService: InconnectMessagingProviderConnectionRoutingService,
    private readonly webhookReceiptService: InconnectMessagingWebhookReceiptService,
  ) {}

  public async acceptTwilioWhatsappWebhook(
    request: InconnectMessagingWebhookRequest,
  ): Promise<void> {
    const provider = this.providerRegistry.resolve(
      TWILIO_WHATSAPP_PROVIDER_KEY,
    );
    const routingHints = provider.getWebhookRoutingHints(request);
    const { connection, credentials } =
      await this.providerConnectionRoutingService.resolveEnabledConnection({
        providerKey: provider.key,
        routingHints,
      });

    if (!provider.validateWebhookSignature({ credentials, request })) {
      throw new ForbiddenException('Invalid Twilio webhook signature');
    }

    const payloadHash = this.webhookReceiptService.computePayloadHash(
      request.rawBody,
    );
    const normalizedWebhook = provider.normalizeWebhook({
      request,
      payloadHash,
    });
    const receipt =
      await this.webhookReceiptService.persistAndRequestProcessing({
        workspaceId: connection.workspaceId,
        providerConnectionId: connection.id,
        normalizedWebhook,
        rawBody: request.rawBody,
        firstReceivedAt: request.serverReceivedAt,
      });

    this.logger.log(
      JSON.stringify({
        receiptId: receipt.id,
        provider: provider.key.provider,
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
        eventKind: normalizedWebhook.kind,
        processingResult: 'RECEIVED',
      }),
    );
  }
}

export const isInconnectMessagingWebhookException = (
  error: unknown,
): error is InconnectMessagingWebhookException =>
  error instanceof InconnectMessagingWebhookException;
