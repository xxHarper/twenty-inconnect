import { Injectable, type OnModuleInit } from '@nestjs/common';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import Twilio from 'twilio';
import { ApiPath } from 'twenty-shared/types';
import { z } from 'zod';

import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingMediaRetrievalRequest,
  type InconnectMessagingMediaRetrievalResult,
  type InconnectMessagingNormalizedInbound,
  type InconnectMessagingNormalizedInboundAttachment,
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
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
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

const twilioCredentialsSchema = z
  .object({
    authToken: z.string().min(1),
    accountSid: z.string().min(1).optional(),
    apiKeySid: z.string().min(1).optional(),
    apiKeySecret: z.string().min(1).optional(),
  })
  .refine(
    ({ apiKeySid, apiKeySecret }) =>
      (apiKeySid === undefined) === (apiKeySecret === undefined),
  );

const TWILIO_CONTENT_SID_PATTERN = /^HX[0-9a-fA-F]{32}$/;
const TWILIO_TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z0-9]+)\s*}}/g;
const MAX_TWILIO_TEMPLATE_VARIABLES = 100;
const MAX_TWILIO_TEMPLATE_VARIABLE_LENGTH = 1600;
const TWILIO_ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
const TWILIO_MESSAGE_SID_PATTERN = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const TWILIO_MEDIA_SID_PATTERN = /^ME[0-9a-fA-F]{32}$/;
const TWILIO_MEDIA_HOSTNAME = 'api.twilio.com';
const TWILIO_MEDIA_REDIRECT_HOSTNAME = 'mms.twiliocdn.com';
const TWILIO_MEDIA_TIMEOUT_MILLISECONDS = 15_000;

const normalizeMimeType = (value: string): string =>
  value.split(';', 1)[0].trim().toLowerCase();

const validateTwilioMediaLocator = ({
  locator,
  accountSid,
  providerMessageId,
}: {
  locator: string;
  accountSid: string;
  providerMessageId: string;
}): URL | null => {
  try {
    const url = new URL(locator);
    const pathMatch = url.pathname.match(
      /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/((?:SM|MM)[0-9a-fA-F]{32})\/Media\/(ME[0-9a-fA-F]{32})(?:\.json)?$/,
    );

    if (
      url.protocol !== 'https:' ||
      url.hostname !== TWILIO_MEDIA_HOSTNAME ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      pathMatch === null ||
      pathMatch[1] !== accountSid ||
      pathMatch[2] !== providerMessageId ||
      !TWILIO_ACCOUNT_SID_PATTERN.test(pathMatch[1]) ||
      !TWILIO_MESSAGE_SID_PATTERN.test(pathMatch[2]) ||
      !TWILIO_MEDIA_SID_PATTERN.test(pathMatch[3])
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
};

const validateTwilioMediaRedirect = (
  location: string,
  base: URL,
): URL | null => {
  try {
    const url = new URL(location, base);

    return url.protocol === 'https:' &&
      url.hostname === TWILIO_MEDIA_REDIRECT_HOSTNAME &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
      ? url
      : null;
  } catch {
    return null;
  }
};

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

const resolveAttachmentType = (
  contentType: string | undefined,
): InconnectMessagingNormalizedInboundAttachment['type'] => {
  const normalized = contentType?.toLowerCase();

  if (normalized === 'image/webp') return 'STICKER';
  if (normalized?.startsWith('image/') === true) return 'IMAGE';
  if (normalized?.startsWith('audio/') === true) return 'AUDIO';
  if (normalized?.startsWith('video/') === true) return 'VIDEO';
  if (
    normalized === 'text/vcard' ||
    normalized === 'text/x-vcard' ||
    normalized === 'application/vcard'
  ) {
    return 'CONTACT';
  }

  return 'DOCUMENT';
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

  const contentType = getNonEmptyParameter(parameters, 'MediaContentType0');

  if (contentType !== undefined) return resolveAttachmentType(contentType);

  return 'TEXT';
};

const sanitizeInboundFilename = (body: string, ordinal: number): string => {
  const basename = body
    .trim()
    .split(/[\\/]/)
    .slice(-1)[0]
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._() -]/gu, '_')
    .slice(0, 180);

  return basename && basename.length > 0
    ? basename
    : `attachment-${ordinal + 1}`;
};

const buildInboundAttachments = (
  parameters: Record<string, string | string[]>,
): InconnectMessagingNormalizedInboundAttachment[] => {
  const parsedCount = Number.parseInt(
    getSingleParameter(parameters, 'NumMedia') ?? '0',
    10,
  );
  const mediaCount = Number.isInteger(parsedCount)
    ? Math.max(0, Math.min(10, parsedCount))
    : 0;
  const body = getSingleParameter(parameters, 'Body') ?? '';

  return Array.from({ length: mediaCount }, (_, ordinal) => {
    const declaredMimeType =
      getNonEmptyParameter(parameters, `MediaContentType${ordinal}`) ?? null;

    return {
      ordinal,
      type: resolveAttachmentType(declaredMimeType ?? undefined),
      providerMediaLocator:
        getNonEmptyParameter(parameters, `MediaUrl${ordinal}`) ?? null,
      declaredMimeType,
      safeFilename: sanitizeInboundFilename(body, ordinal),
    };
  });
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
    'RETRIEVE_MEDIA',
  ] as const;

  public constructor(
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly clientFactory: TwilioWhatsappClientFactory,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly secureHttpClientService: SecureHttpClientService,
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

  public async retrieveMedia({
    credentials,
    providerMessageId,
    providerMediaLocator,
    declaredMimeType,
    maximumBytes,
  }: InconnectMessagingMediaRetrievalRequest): Promise<InconnectMessagingMediaRetrievalResult> {
    const parsedCredentials = twilioCredentialsSchema.safeParse(credentials);

    if (
      !parsedCredentials.success ||
      parsedCredentials.data.accountSid === undefined ||
      !TWILIO_ACCOUNT_SID_PATTERN.test(parsedCredentials.data.accountSid) ||
      !TWILIO_MESSAGE_SID_PATTERN.test(providerMessageId)
    ) {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    const initialUrl = validateTwilioMediaLocator({
      locator: providerMediaLocator,
      accountSid: parsedCredentials.data.accountSid,
      providerMessageId,
    });

    if (initialUrl === null) {
      return {
        kind: 'DEFINITIVE_FAILURE',
        code: 'SECURITY_VALIDATION_FAILED',
      };
    }

    const username =
      parsedCredentials.data.apiKeySid ?? parsedCredentials.data.accountSid;
    const password =
      parsedCredentials.data.apiKeySecret ?? parsedCredentials.data.authToken;
    const client = this.secureHttpClientService.getHttpClient({
      timeout: TWILIO_MEDIA_TIMEOUT_MILLISECONDS,
      maxRedirects: 0,
      maxContentLength: maximumBytes,
      maxBodyLength: maximumBytes,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    let currentUrl = initialUrl;

    try {
      for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
        const response = await client.get<ArrayBuffer>(currentUrl.toString(), {
          headers:
            redirectCount === 0
              ? {
                  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                }
              : undefined,
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          const redirectUrl =
            typeof location === 'string'
              ? validateTwilioMediaRedirect(location, currentUrl)
              : null;

          if (redirectUrl === null || redirectCount === 2) {
            return {
              kind: 'DEFINITIVE_FAILURE',
              code: 'SECURITY_VALIDATION_FAILED',
            };
          }

          currentUrl = redirectUrl;
          continue;
        }

        if (response.status === 404 || response.status === 410) {
          return {
            kind: 'DEFINITIVE_FAILURE',
            code: 'PROVIDER_MEDIA_UNAVAILABLE',
          };
        }

        if (response.status < 200 || response.status >= 300) {
          return response.status >= 500 || response.status === 429
            ? { kind: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' }
            : {
                kind: 'DEFINITIVE_FAILURE',
                code: 'SECURITY_VALIDATION_FAILED',
              };
        }

        const contentLength = Number(response.headers['content-length']);
        const content = Buffer.from(response.data);

        if (
          (Number.isFinite(contentLength) && contentLength > maximumBytes) ||
          content.length > maximumBytes
        ) {
          return {
            kind: 'DEFINITIVE_FAILURE',
            code: 'SIZE_LIMIT_EXCEEDED',
          };
        }

        const responseMimeType =
          typeof response.headers['content-type'] === 'string'
            ? normalizeMimeType(response.headers['content-type'])
            : '';

        if (
          responseMimeType.length === 0 ||
          responseMimeType !== normalizeMimeType(declaredMimeType)
        ) {
          return { kind: 'DEFINITIVE_FAILURE', code: 'MIME_MISMATCH' };
        }

        return { kind: 'SUCCESS', content, mimeType: responseMimeType };
      }
    } catch {
      return { kind: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' };
    }

    return {
      kind: 'DEFINITIVE_FAILURE',
      code: 'SECURITY_VALIDATION_FAILED',
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
      attachments: buildInboundAttachments(request.parameters),
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
