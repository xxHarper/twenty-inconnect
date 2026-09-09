export const INCONNECT_MESSAGING_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

export type InconnectMessagingDirection =
  (typeof INCONNECT_MESSAGING_DIRECTIONS)[number];

export const INCONNECT_MESSAGING_MESSAGE_TYPES = ['TEXT'] as const;

export type InconnectMessagingMessageType =
  (typeof INCONNECT_MESSAGING_MESSAGE_TYPES)[number];

export const INCONNECT_MESSAGING_SEND_MODES = ['FREEFORM'] as const;

export type InconnectMessagingSendMode =
  (typeof INCONNECT_MESSAGING_SEND_MODES)[number];

export const INCONNECT_MESSAGING_OUTBOUND_STATES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'UNKNOWN',
] as const;

export type InconnectMessagingOutboundState =
  (typeof INCONNECT_MESSAGING_OUTBOUND_STATES)[number];

export type InconnectMessagingConnectionLifecycleStatus =
  | 'ENABLED'
  | 'DISABLED';

export type InconnectMessagingConnectionHealthStatus =
  | 'UNKNOWN'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY';

export type InconnectMessagingDispatchAttemptOutcome =
  | 'ACCEPTED'
  | 'REJECTED_DEFINITIVE'
  | 'FAILED_BEFORE_SUBMIT'
  | 'UNKNOWN';

export type InconnectMessagingInboxProcessingState =
  | 'RECEIVED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'FAILED';

export type InconnectMessagingOutboxProcessingState =
  | 'PENDING'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'FAILED';

export type InconnectMessagingJson = Record<string, unknown>;
