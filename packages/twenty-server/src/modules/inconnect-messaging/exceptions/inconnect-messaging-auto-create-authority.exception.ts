export const InconnectMessagingAutoCreateAuthorityExceptionCode = {
  AUTHORITY_DENIED: 'AUTHORITY_DENIED',
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  SCOPE_MISMATCH: 'SCOPE_MISMATCH',
} as const;

export type InconnectMessagingAutoCreateAuthorityExceptionCode =
  (typeof InconnectMessagingAutoCreateAuthorityExceptionCode)[keyof typeof InconnectMessagingAutoCreateAuthorityExceptionCode];

export class InconnectMessagingAutoCreateAuthorityException extends Error {
  constructor(
    message: string,
    public readonly code: InconnectMessagingAutoCreateAuthorityExceptionCode,
  ) {
    super(message);
    this.name = 'InconnectMessagingAutoCreateAuthorityException';
  }
}
