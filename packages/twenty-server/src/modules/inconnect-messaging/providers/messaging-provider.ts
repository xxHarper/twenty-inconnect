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
}
