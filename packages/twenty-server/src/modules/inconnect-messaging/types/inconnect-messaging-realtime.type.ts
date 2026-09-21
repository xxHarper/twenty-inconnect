export type InconnectMessagingRealtimeEventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_STATUS_CHANGED'
  | 'MESSAGE_UPDATED'
  | 'CONVERSATION_UPDATED';

export type InconnectMessagingRealtimeHint = {
  eventId: string;
  eventType: InconnectMessagingRealtimeEventType;
  conversationId: string;
  messageId: string | null;
  occurredAt: Date;
};
