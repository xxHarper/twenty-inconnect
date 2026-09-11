export type InconnectMessagingWebhookErrorCategory =
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_AMBIGUOUS'
  | 'CONNECTION_DISABLED'
  | 'CREDENTIALS_UNAVAILABLE'
  | 'INVALID_SIGNATURE'
  | 'PAYLOAD_CONFLICT'
  | 'MALFORMED_PAYLOAD'
  | 'UNSUPPORTED_EVENT'
  | 'MESSAGE_NOT_FOUND'
  | 'RECEIPT_NOT_PROCESSABLE';

export class InconnectMessagingWebhookException extends Error {
  public constructor(
    public readonly category: InconnectMessagingWebhookErrorCategory,
    public readonly retryable: boolean,
  ) {
    super(category);
    this.name = InconnectMessagingWebhookException.name;
  }
}
