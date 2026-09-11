import {
  type InconnectMessagingInboundTimestampSource,
  type InconnectMessagingJson,
  type InconnectMessagingMessageType,
  type InconnectMessagingOutboundState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type InconnectMessagingWebhookKind =
  | 'INBOUND_MESSAGE'
  | 'STATUS_CALLBACK';

export type InconnectMessagingWebhookRequest = {
  kind: InconnectMessagingWebhookKind;
  routingKey: string;
  effectiveUrl: string;
  signature: string;
  contentType: string | undefined;
  rawBody: string;
  parameters: Record<string, string | string[]>;
  serverReceivedAt: Date;
};

export type InconnectMessagingNormalizedInbound = {
  kind: 'INBOUND_MESSAGE';
  idempotencyKey: string;
  providerMessageId: string;
  externalAddressNormalized: string;
  waId: string | null;
  body: string;
  messageType: InconnectMessagingMessageType;
  serverReceivedAt: string;
  providerOccurredAt: string | null;
  effectiveInboundAt: string;
  timestampSource: InconnectMessagingInboundTimestampSource;
  providerMetadata: InconnectMessagingJson;
};

export type InconnectMessagingNormalizedStatus = {
  kind: 'STATUS_CALLBACK';
  idempotencyKey: string;
  providerMessageId: string;
  originalStatus: string;
  normalizedStatus: InconnectMessagingOutboundState;
  serverReceivedAt: string;
  providerOccurredAt: string | null;
  error: InconnectMessagingJson | null;
  providerMetadata: InconnectMessagingJson;
};

export type InconnectMessagingNormalizedUnsupportedWebhook = {
  kind: 'UNSUPPORTED';
  idempotencyKey: string;
  requestedKind: InconnectMessagingWebhookKind;
  reason: string;
  serverReceivedAt: string;
};

export type InconnectMessagingNormalizedWebhook =
  | InconnectMessagingNormalizedInbound
  | InconnectMessagingNormalizedStatus
  | InconnectMessagingNormalizedUnsupportedWebhook;

export type InconnectMessagingWebhookValidationRequest = {
  credentials: InconnectMessagingJson;
  request: InconnectMessagingWebhookRequest;
};

export type InconnectMessagingWebhookNormalizationRequest = {
  request: InconnectMessagingWebhookRequest;
  payloadHash: string;
};

export type InconnectMessagingWebhookRoutingHints = {
  inboundRoutingKey: string;
};

export const INCONNECT_MESSAGING_PROVIDER_CAPABILITIES = [
  'DISPATCH_FREEFORM',
  'DISPATCH_TEMPLATE',
  'NORMALIZE_WEBHOOK',
  'RETRIEVE_MEDIA',
  'SYNCHRONIZE_TEMPLATES',
  'CHECK_CONNECTION',
] as const;

export type InconnectMessagingProviderCapability =
  (typeof INCONNECT_MESSAGING_PROVIDER_CAPABILITIES)[number];

export type InconnectMessagingProviderKey = {
  provider: string;
  channel: string;
};

export type InconnectMessagingDispatchRequest = {
  workspaceId: string;
  providerConnectionId: string;
  messageId: string;
  externalAddressNormalized: string;
  body: string;
};

export type InconnectMessagingProviderError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type InconnectMessagingDispatchResult =
  | {
      kind: 'ACCEPTED';
      providerMessageId: string;
      providerStatus?: string;
    }
  | {
      kind: 'REJECTED_DEFINITIVE';
      error: InconnectMessagingProviderError;
    }
  | {
      kind: 'FAILED_BEFORE_SUBMIT';
      error: InconnectMessagingProviderError;
    }
  | { kind: 'UNKNOWN'; error?: InconnectMessagingProviderError };

export interface InconnectMessagingProvider {
  readonly key: InconnectMessagingProviderKey;
  readonly capabilities: readonly InconnectMessagingProviderCapability[];
  dispatch(
    request: InconnectMessagingDispatchRequest,
  ): Promise<InconnectMessagingDispatchResult>;
  getWebhookRoutingHints(
    request: InconnectMessagingWebhookRequest,
  ): InconnectMessagingWebhookRoutingHints;
  validateWebhookSignature(
    request: InconnectMessagingWebhookValidationRequest,
  ): boolean;
  normalizeWebhook(
    request: InconnectMessagingWebhookNormalizationRequest,
  ): InconnectMessagingNormalizedWebhook;
}
