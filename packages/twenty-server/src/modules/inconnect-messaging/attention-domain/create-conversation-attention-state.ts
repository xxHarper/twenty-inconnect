import {
  type AttentionScope,
  type ConversationAttentionState,
} from 'src/modules/inconnect-messaging/attention-domain/conversation-attention.types';

// Only for a new domain aggregate; historical Pending needs an approved bootstrap.
export const createConversationAttentionState = (
  scope: AttentionScope,
): ConversationAttentionState => ({
  scope: { ...scope },
  status: 'ATTENDED',
  revision: '0',
  responseIntents: [],
  receipts: [],
});
