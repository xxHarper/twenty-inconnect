export type LeadDistributionErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_LIMITS'
  | 'DUPLICATE_LEAD'
  | 'DUPLICATE_RECIPIENT'
  | 'INVALID_QUOTAS'
  | 'QUOTA_EXCEEDS_AVAILABLE';

export class LeadDistributionError extends Error {
  constructor(public readonly code: LeadDistributionErrorCode) {
    super(code);
    this.name = 'LeadDistributionError';
  }
}
