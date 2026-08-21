export const InconnectRecordAccessConfigurationExceptionCode = {
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
