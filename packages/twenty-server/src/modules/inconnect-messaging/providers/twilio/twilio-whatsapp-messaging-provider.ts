import { Injectable, type OnModuleInit } from '@nestjs/common';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import Twilio from 'twilio';
import { ApiPath } from 'twenty-shared/types';
import { z } from 'zod';

import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingNormalizedInbound,
  type InconnectMessagingNormalizedStatus,
  type InconnectMessagingNormalizedWebhook,
  type InconnectMessagingProvider,
  type InconnectMessagingProviderTemplate,
  type InconnectMessagingTemplateCatalogRequest,
  type InconnectMessagingWebhookNormalizationRequest,
  type InconnectMessagingWebhookRequest,
  type InconnectMessagingWebhookRoutingHints,
  type InconnectMessagingWebhookValidationRequest,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { TwilioWhatsappClientFactory } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-client.factory';
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

const TWILIO_CONTENT_SID_PATTERN = /^HX[0-9a-fA-F]{32}$/;
const TWILIO_TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z0-9]+)\s*}}/g;
const MAX_TWILIO_TEMPLATE_VARIABLES = 100;
const MAX_TWILIO_TEMPLATE_VARIABLE_LENGTH = 1600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeTwilioTextTemplate = (template: {
  sid: string;
  friendlyName: string;
  language: string;
  variables: Record<string, object>;
  types: Record<string, object>;
  approvalRequests: Record<string, object>;
}): InconnectMessagingProviderTemplate | null => {
  const whatsappApproval = template.approvalRequests.whatsapp;
  const textContent = template.types['twilio/text'];

  if (
    !TWILIO_CONTENT_SID_PATTERN.test(template.sid) ||
    template.friendlyName.trim().length === 0 ||
    template.language.trim().length === 0 ||
    !isRecord(whatsappApproval) ||
    typeof whatsappApproval.status !== 'string' ||
    whatsappApproval.status.toLowerCase() !== 'approved' ||
    !isRecord(textContent) ||
    typeof textContent.body !== 'string' ||
    textContent.body.length === 0
  ) {
    return null;
  }

  const bodyVariableKeys = Array.from(
    textContent.body.matchAll(TWILIO_TEMPLATE_VARIABLE_PATTERN),
    (match) => match[1],
  );
  const uniqueBodyVariableKeys = [...new Set(bodyVariableKeys)].sort(
    (left, right) => left.localeCompare(right, 'en', { numeric: true }),
  );
  const declaredVariableKeys = Object.keys(template.variables).sort(
    (left, right) => left.localeCompare(right, 'en', { numeric: true }),
  );

  if (
    uniqueBodyVariableKeys.length > MAX_TWILIO_TEMPLATE_VARIABLES ||
    uniqueBodyVariableKeys.some(
      (key) => key.length > 16 || !/^[A-Za-z0-9]+$/.test(key),
    ) ||
    JSON.stringify(uniqueBodyVariableKeys) !==
      JSON.stringify(declaredVariableKeys) ||
    textContent.body
      .replace(TWILIO_TEMPLATE_VARIABLE_PATTERN, '')
      .includes('{{')
  ) {
    return null;
  }

  return {
    providerReference: template.sid,
    displayName: template.friendlyName,
    language: template.language,
    availability: 'AVAILABLE',
    content: { kind: 'TEXT', body: textContent.body },
    variables: uniqueBodyVariableKeys.map((key) => ({
      key,
      required: true,
      maxLength: MAX_TWILIO_TEMPLATE_VARIABLE_LENGTH,
      allowsNewlines: false,
    })),
  };
};

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
  public readonly capabilities = [
    'NORMALIZE_WEBHOOK',
    'DISPATCH_FREEFORM',
    'DISPATCH_TEMPLATE',
  ] as const;

  public constructor(
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly clientFactory: TwilioWhatsappClientFactory,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  public onModuleInit(): void {
    this.providerRegistry.register(this);
  }

  public async dispatch(
    request: InconnectMessagingDispatchRequest,
  ): Promise<InconnectMessagingDispatchResult> {
    const credentials = twilioCredentialsSchema.safeParse(request.credentials);
    const sender = normalizeWhatsappAddress(request.senderAddressNormalized);
    const destination = normalizeWhatsappAddress(
      request.externalAddressNormalized,
    );

    if (
      !credentials.success ||
      credentials.data.accountSid === undefined ||
      sender === null ||
      destination === null ||
      (request.content.kind === 'FREEFORM_TEXT'
        ? request.content.body.trim().length === 0
        : !TWILIO_CONTENT_SID_PATTERN.test(
            request.content.templateProviderReference,
          ))
    ) {
      return {
        kind: 'FAILED_BEFORE_SUBMIT',
        error: {
          code: 'INVALID_CONNECTION',
          message: 'Provider connection is unavailable',
          retryable: false,
        },
      };
    }

    let statusCallback: string;

    try {
      const serverUrl = new URL(this.twentyConfigService.get('SERVER_URL'));

      if (
        serverUrl.protocol !== 'https:' ||
        request.callbackRoutingKey.length === 0
      ) {
        throw new Error('Invalid callback configuration');
      }

      statusCallback = new URL(
        `/${ApiPath.Webhooks}/inconnect-messaging/twilio/whatsapp/${encodeURIComponent(request.callbackRoutingKey)}/status/${encodeURIComponent(request.messageId)}`,
        serverUrl,
      ).toString();
    } catch {
      return {
        kind: 'FAILED_BEFORE_SUBMIT',
        error: {
          code: 'CALLBACK_UNAVAILABLE',
          message: 'Provider callback is unavailable',
          retryable: false,
        },
      };
    }

    try {
      const client = this.clientFactory.create(
        credentials.data.accountSid,
        credentials.data.authToken,
      );
      const content =
        request.content.kind === 'FREEFORM_TEXT'
          ? { body: request.content.body }
          : {
              contentSid: request.content.templateProviderReference,
              contentVariables: JSON.stringify(request.content.variables),
            };
      const message = await client.messages.create({
        from: `whatsapp:${sender}`,
        to: `whatsapp:${destination}`,
        ...content,
        statusCallback,
      });

      if (typeof message.sid !== 'string' || message.sid.length === 0) {
        return {
          kind: 'UNKNOWN',
          error: {
            code: 'MISSING_PROVIDER_ID',
            message: 'Provider outcome is ambiguous',
            retryable: false,
          },
        };
      }

      return {
        kind: 'ACCEPTED',
        providerMessageId: message.sid,
        providerStatus: message.status,
      };
    } catch (error) {
      // Only an explicit 4xx rejection proves that Twilio did not accept the request.
      if (
        error instanceof Twilio.RestException &&
        error.status >= 400 &&
        error.status < 500
      ) {
        return error.status === 429
          ? {
              kind: 'FAILED_BEFORE_SUBMIT',
              error: {
                code: 'PROVIDER_RATE_LIMITED',
                message: 'Provider temporarily unavailable',
                retryable: true,
              },
            }
          : {
              kind: 'REJECTED_DEFINITIVE',
              error: {
                code: 'PROVIDER_REJECTED',
                message: 'Provider rejected the message',
                retryable: false,
              },
            };
      }

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

  public async listTemplates({
    credentials,
  }: InconnectMessagingTemplateCatalogRequest): Promise<
    InconnectMessagingProviderTemplate[]
  > {
    const parsedCredentials = twilioCredentialsSchema.parse(credentials);

    if (parsedCredentials.accountSid === undefined) {
      throw new Error('Twilio account is unavailable');
    }

    const client = this.clientFactory.create(
      parsedCredentials.accountSid,
      parsedCredentials.authToken,
    );
    const templates = await client.content.v2.contentAndApprovals.list({
      channelEligibility: ['whatsapp:approved'],
      contentType: ['twilio/text'],
      limit: 1000,
    });

    return templates
      .map(normalizeTwilioTextTemplate)
      .filter(
        (template): template is InconnectMessagingProviderTemplate =>
          template !== null,
      );
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
      localMessageIdHint:
        request.localMessageIdHint !== undefined &&
        z.uuid().safeParse(request.localMessageIdHint).success
          ? request.localMessageIdHint
          : null,
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
