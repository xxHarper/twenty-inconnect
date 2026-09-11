import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  type RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { type InconnectMessagingWebhookKind } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import {
  InconnectMessagingWebhookIngressService,
  isInconnectMessagingWebhookException,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';

type TwilioWebhookRequest = Request<{ routingKey: string }>;

const normalizeParameters = (
  body: unknown,
): Record<string, string | string[]> => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid Twilio webhook body');
  }

  const parameters: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      parameters[name] = value;
      continue;
    }

    if (
      Array.isArray(value) &&
      value.every((arrayValue) => typeof arrayValue === 'string')
    ) {
      parameters[name] = value;
      continue;
    }

    throw new BadRequestException('Invalid Twilio webhook parameter');
  }

  return parameters;
};

@Controller()
export class InconnectMessagingWebhookController {
  public constructor(
    private readonly webhookIngressService: InconnectMessagingWebhookIngressService,
  ) {}

  @Post(
    `${ApiPath.Webhooks}/inconnect-messaging/twilio/whatsapp/:routingKey/inbound`,
  )
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  @HttpCode(200)
  public async handleInbound(
    @Req() request: RawBodyRequest<TwilioWebhookRequest>,
  ): Promise<void> {
    await this.handle(request, 'INBOUND_MESSAGE');
  }

  @Post(
    `${ApiPath.Webhooks}/inconnect-messaging/twilio/whatsapp/:routingKey/status`,
  )
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  @HttpCode(200)
  public async handleStatus(
    @Req() request: RawBodyRequest<TwilioWebhookRequest>,
  ): Promise<void> {
    await this.handle(request, 'STATUS_CALLBACK');
  }

  private async handle(
    request: RawBodyRequest<TwilioWebhookRequest>,
    kind: InconnectMessagingWebhookKind,
  ): Promise<void> {
    if (request.rawBody === undefined) {
      throw new BadRequestException('Missing Twilio webhook body');
    }

    try {
      await this.webhookIngressService.acceptTwilioWhatsappWebhook({
        kind,
        routingKey: request.params.routingKey,
        effectiveUrl: `${request.protocol}://${request.host}${request.originalUrl}`,
        signature: request.get('x-twilio-signature') ?? '',
        contentType: request.get('content-type'),
        rawBody: request.rawBody.toString('utf8'),
        parameters: normalizeParameters(request.body as unknown),
        serverReceivedAt: new Date(),
      });
    } catch (error) {
      if (
        isInconnectMessagingWebhookException(error) &&
        [
          'CONNECTION_NOT_FOUND',
          'CONNECTION_AMBIGUOUS',
          'CONNECTION_DISABLED',
          'CREDENTIALS_UNAVAILABLE',
        ].includes(error.category)
      ) {
        throw new NotFoundException('Messaging provider connection not found');
      }

      throw error;
    }
  }
}
