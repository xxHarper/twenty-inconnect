export type InconnectMessagingRealtimeEventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_STATUS_CHANGED';

export type InconnectMessagingRealtimeHint = {
  eventId: string;
  eventType: InconnectMessagingRealtimeEventType;
  conversationId: string;
  messageId: string | null;
  occurredAt: Date;
};
