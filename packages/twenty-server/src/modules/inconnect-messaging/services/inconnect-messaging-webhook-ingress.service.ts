import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { verifyTwilioWebhook } from 'src/modules/inconnect-messaging/webhook-ingress/authenticated-inbound';
import {
  INBOUND_INGRESS_POLICY,
  type InboundIngressPolicy,
} from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';
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
    @Optional()
    @Inject(INBOUND_INGRESS_POLICY)
    private readonly ingressPolicy?: InboundIngressPolicy,
  ) {}

  public async acceptTwilioWhatsappWebhook(
    request: InconnectMessagingWebhookRequest,
  ): Promise<void> {
    const verified = await verifyTwilioWebhook(
      request,
      this.providerRegistry,
      this.providerConnectionRoutingService,
      this.ingressPolicy,
    );
    const { connection, normalizedWebhook, capability } = verified;
    const receipt =
      capability === null
        ? await this.webhookReceiptService.persistAndRequestProcessing({
            workspaceId: connection.workspaceId,
            providerConnectionId: connection.id,
            normalizedWebhook,
            rawBody: verified.request.rawBody,
            firstReceivedAt: verified.request.serverReceivedAt,
          })
        : (
            await this.webhookReceiptService.persistAuthenticatedInbound(
              capability,
            )
          ).receipt;

    this.logger.log(
      JSON.stringify({
        receiptId: receipt.id,
        provider: 'TWILIO',
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
