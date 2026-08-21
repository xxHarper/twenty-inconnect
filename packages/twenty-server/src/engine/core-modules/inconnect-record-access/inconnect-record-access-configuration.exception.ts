export const InconnectRecordAccessConfigurationExceptionCode = {
  CACHE_REVOCATION_FAILED: 'CACHE_REVOCATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
} as const;

export type InconnectRecordAccessConfigurationExceptionCode =
  (typeof InconnectRecordAccessConfigurationExceptionCode)[keyof typeof InconnectRecordAccessConfigurationExceptionCode];

export class InconnectRecordAccessConfigurationException extends Error {
  constructor(
    message: string,
    public readonly code: InconnectRecordAccessConfigurationExceptionCode,
  ) {
    super(message);
    this.name = InconnectRecordAccessConfigurationException.name;
  }
}
