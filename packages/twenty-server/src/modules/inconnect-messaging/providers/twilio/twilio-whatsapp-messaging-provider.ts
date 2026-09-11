import { Injectable, type OnModuleInit } from '@nestjs/common';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import Twilio from 'twilio';
import { z } from 'zod';

import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingNormalizedInbound,
  type InconnectMessagingNormalizedStatus,
  type InconnectMessagingNormalizedWebhook,
  type InconnectMessagingProvider,
  type InconnectMessagingWebhookNormalizationRequest,
  type InconnectMessagingWebhookRequest,
  type InconnectMessagingWebhookRoutingHints,
  type InconnectMessagingWebhookValidationRequest,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import {
  type InconnectMessagingJson,
  type InconnectMessagingMessageType,
  type InconnectMessagingOutboundState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export const TWILIO_WHATSAPP_PROVIDER_KEY = {
  provider: 'TWILIO',
  channel: 'WHATSAPP',
} as const;

const twilioCredentialsSchema = z.object({
  authToken: z.string().min(1),
  accountSid: z.string().min(1).optional(),
});

const getSingleParameter = (
  parameters: Record<string, string | string[]>,
  name: string,
): string | undefined => {
  const value = parameters[name];

  return Array.isArray(value) ? value[0] : value;
};

const getNonEmptyParameter = (
  parameters: Record<string, string | string[]>,
  name: string,
): string | undefined => {
  const value = getSingleParameter(parameters, name)?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
};

const parseProviderOccurredAt = (
  parameters: Record<string, string | string[]>,
): Date | null => {
  const rawTimestamp =
    getNonEmptyParameter(parameters, 'DateCreated') ??
    getNonEmptyParameter(parameters, 'Timestamp');

  if (rawTimestamp === undefined) {
    return null;
  }

  const timestamp = new Date(rawTimestamp);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const normalizeWhatsappAddress = (rawAddress: string): string | null => {
  const withoutChannelPrefix = rawAddress
    .trim()
    .replace(/^whatsapp:/i, '')
    .trim();
  const phoneNumber = parsePhoneNumberFromString(withoutChannelPrefix);

  return phoneNumber?.isValid() === true ? phoneNumber.number : null;
};

const resolveMessageType = (
  parameters: Record<string, string | string[]>,
): InconnectMessagingMessageType => {
  if (
    getNonEmptyParameter(parameters, 'Latitude') !== undefined &&
    getNonEmptyParameter(parameters, 'Longitude') !== undefined
  ) {
    return 'LOCATION';
  }

  const contentType = getNonEmptyParameter(
    parameters,
    'MediaContentType0',
  )?.toLowerCase();

  if (contentType?.startsWith('image/') === true) {
    return 'IMAGE';
  }

  if (contentType?.startsWith('audio/') === true) {
    return 'AUDIO';
  }

  if (contentType?.startsWith('video/') === true) {
    return 'VIDEO';
  }

  if (contentType !== undefined) {
    return 'DOCUMENT';
  }

  return 'TEXT';
};

const buildInboundProviderMetadata = (
  parameters: Record<string, string | string[]>,
): InconnectMessagingJson => {
  const mediaCount = Math.max(
    0,
    Math.min(
      10,
      Number.parseInt(getSingleParameter(parameters, 'NumMedia') ?? '0', 10) ||
        0,
    ),
  );
  const media = Array.from({ length: mediaCount }, (_, index) => ({
    contentType:
      getNonEmptyParameter(parameters, `MediaContentType${index}`) ?? null,
    providerLocator:
      getNonEmptyParameter(parameters, `MediaUrl${index}`) ?? null,
  }));
  const latitude = getNonEmptyParameter(parameters, 'Latitude');
  const longitude = getNonEmptyParameter(parameters, 'Longitude');
  const location =
    latitude !== undefined && longitude !== undefined
      ? {
          latitude,
          longitude,
          label: getNonEmptyParameter(parameters, 'Label') ?? null,
          name: getNonEmptyParameter(parameters, 'Name') ?? null,
          address: getNonEmptyParameter(parameters, 'Address') ?? null,
        }
      : null;

  return {
    provider: 'TWILIO',
    channel: 'WHATSAPP',
    accountSid: getNonEmptyParameter(parameters, 'AccountSid') ?? null,
    from: getNonEmptyParameter(parameters, 'From') ?? null,
    waId: getNonEmptyParameter(parameters, 'WaId') ?? null,
    messagingServiceSid:
      getNonEmptyParameter(parameters, 'MessagingServiceSid') ?? null,
    to: getNonEmptyParameter(parameters, 'To') ?? null,
    profileName: getNonEmptyParameter(parameters, 'ProfileName') ?? null,
    media,
    location,
  };
};

const normalizeStatus = (status: string): InconnectMessagingOutboundState => {
  switch (status.toLowerCase()) {
    case 'queued':
      return 'QUEUED';
    case 'sending':
      return 'SENDING';
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
    case 'undelivered':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
};

@Injectable()
export class TwilioWhatsappMessagingProvider
  implements InconnectMessagingProvider, OnModuleInit
{
  public readonly key = TWILIO_WHATSAPP_PROVIDER_KEY;
  public readonly capabilities = ['NORMALIZE_WEBHOOK'] as const;

  public constructor(
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
  ) {}

  public onModuleInit(): void {
    this.providerRegistry.register(this);
  }

  public async dispatch(
    _request: InconnectMessagingDispatchRequest,
  ): Promise<InconnectMessagingDispatchResult> {
    return {
      kind: 'REJECTED_DEFINITIVE',
      error: {
        code: 'TWILIO_OUTBOUND_NOT_IMPLEMENTED',
        message: 'Twilio outbound dispatch is not implemented',
        retryable: false,
      },
    };
  }

  public getWebhookRoutingHints(
    request: InconnectMessagingWebhookRequest,
  ): InconnectMessagingWebhookRoutingHints {
    return { inboundRoutingKey: request.routingKey };
  }

  public validateWebhookSignature({
    credentials,
    request,
  }: InconnectMessagingWebhookValidationRequest): boolean {
    if (request.signature.length === 0) {
      return false;
    }

    const parsedCredentials = twilioCredentialsSchema.safeParse(credentials);

    if (!parsedCredentials.success) {
      return false;
    }

    const { authToken } = parsedCredentials.data;

    if (request.contentType?.toLowerCase().includes('application/json')) {
      return Twilio.validateRequestWithBody(
        authToken,
        request.signature,
        request.effectiveUrl,
        request.rawBody,
      );
    }

    return Twilio.validateRequest(
      authToken,
      request.signature,
      request.effectiveUrl,
      request.parameters,
    );
  }

  public normalizeWebhook({
    request,
    payloadHash,
  }: InconnectMessagingWebhookNormalizationRequest): InconnectMessagingNormalizedWebhook {
    return request.kind === 'INBOUND_MESSAGE'
      ? this.normalizeInbound(request, payloadHash)
      : this.normalizeStatus(request, payloadHash);
  }

  private normalizeInbound(
    request: InconnectMessagingWebhookRequest,
    payloadHash: string,
  ): InconnectMessagingNormalizedWebhook {
    const providerMessageId = getNonEmptyParameter(
      request.parameters,
      'MessageSid',
    );
    const rawFrom = getNonEmptyParameter(request.parameters, 'From');
    const externalAddressNormalized =
      rawFrom === undefined ? null : normalizeWhatsappAddress(rawFrom);

    if (providerMessageId === undefined || externalAddressNormalized === null) {
      return this.unsupported(request, payloadHash, 'MALFORMED_INBOUND');
    }

    const providerOccurredAt = parseProviderOccurredAt(request.parameters);
    const effectiveInboundAt = providerOccurredAt ?? request.serverReceivedAt;
    const normalized: InconnectMessagingNormalizedInbound = {
      kind: 'INBOUND_MESSAGE',
      idempotencyKey: providerMessageId,
      providerMessageId,
      externalAddressNormalized,
      waId: getNonEmptyParameter(request.parameters, 'WaId') ?? null,
      body: getSingleParameter(request.parameters, 'Body') ?? '',
      messageType: resolveMessageType(request.parameters),
      serverReceivedAt: request.serverReceivedAt.toISOString(),
      providerOccurredAt: providerOccurredAt?.toISOString() ?? null,
      effectiveInboundAt: effectiveInboundAt.toISOString(),
      timestampSource: providerOccurredAt === null ? 'SERVER' : 'PROVIDER',
      providerMetadata: buildInboundProviderMetadata(request.parameters),
    };

    return normalized;
  }

  private normalizeStatus(
    request: InconnectMessagingWebhookRequest,
    payloadHash: string,
  ): InconnectMessagingNormalizedWebhook {
    const providerMessageId = getNonEmptyParameter(
      request.parameters,
      'MessageSid',
    );
    const originalStatus = getNonEmptyParameter(
      request.parameters,
      'MessageStatus',
    );

    if (providerMessageId === undefined || originalStatus === undefined) {
      return this.unsupported(request, payloadHash, 'MALFORMED_STATUS');
    }

    const errorCode = getNonEmptyParameter(request.parameters, 'ErrorCode');
    const errorMessage = getNonEmptyParameter(
      request.parameters,
      'ErrorMessage',
    );
    const providerOccurredAt = parseProviderOccurredAt(request.parameters);
    const normalized: InconnectMessagingNormalizedStatus = {
      kind: 'STATUS_CALLBACK',
      idempotencyKey: [
        providerMessageId,
        originalStatus,
        errorCode ?? 'none',
      ].join(':'),
      providerMessageId,
      originalStatus,
      normalizedStatus: normalizeStatus(originalStatus),
      serverReceivedAt: request.serverReceivedAt.toISOString(),
      providerOccurredAt: providerOccurredAt?.toISOString() ?? null,
      error:
        errorCode === undefined && errorMessage === undefined
          ? null
          : {
              providerStatus: originalStatus,
              providerErrorCode: errorCode ?? null,
              providerErrorMessage: errorMessage ?? null,
            },
      providerMetadata: {
        provider: 'TWILIO',
        channel: 'WHATSAPP',
        accountSid:
          getNonEmptyParameter(request.parameters, 'AccountSid') ?? null,
        messagingServiceSid:
          getNonEmptyParameter(request.parameters, 'MessagingServiceSid') ??
          null,
      },
    };

    return normalized;
  }

  private unsupported(
    request: InconnectMessagingWebhookRequest,
    payloadHash: string,
    reason: string,
  ): InconnectMessagingNormalizedWebhook {
    return {
      kind: 'UNSUPPORTED',
      idempotencyKey: `payload:${payloadHash}`,
      requestedKind: request.kind,
      reason,
      serverReceivedAt: request.serverReceivedAt.toISOString(),
    };
  }
}
