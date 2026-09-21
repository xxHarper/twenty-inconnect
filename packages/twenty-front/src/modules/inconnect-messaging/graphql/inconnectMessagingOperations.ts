import { gql } from '@apollo/client';

export const INCONNECT_MESSAGING_CONVERSATIONS = gql`
  query InconnectMessagingConversations(
    $search: String
    $workState: InconnectMessagingConversationWorkStateFilter
    $paging: InconnectMessagingPaging
  ) {
    inconnectMessagingConversations(
      search: $search
      workState: $workState
      paging: $paging
    ) {
      edges {
        cursor
        node {
          id
          externalAddress
          isLinked
          isFavorite
          isUnread
          isPending
          lastInboundAt
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const INCONNECT_MESSAGING_CONVERSATION = gql`
  query InconnectMessagingConversation($id: UUID!) {
    inconnectMessagingConversation(id: $id) {
      id
      externalAddress
      isLinked
      isFavorite
      isUnread
      isPending
      lastInboundAt
      createdAt
    }
  }
`;

export const INCONNECT_MESSAGING_MESSAGES = gql`
  query InconnectMessagingMessages(
    $conversationId: UUID!
    $paging: InconnectMessagingPaging
  ) {
    inconnectMessagingMessages(
      conversationId: $conversationId
      paging: $paging
    ) {
      edges {
        cursor
        node {
          id
          direction
          type
          body
          sendMode
          outboundState
          displayAt
          location {
            latitude
            longitude
            label
            name
            address
          }
          media {
            id
            type
            filename
            contentType
            size
            availabilityState
            accessUrl
          }
          template {
            id
            displayName
            language
            variables {
              key
              value
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const INCONNECT_MESSAGING_SEND_CAPABILITIES = gql`
  query InconnectMessagingSendCapabilities($conversationId: UUID!) {
    inconnectMessagingSendCapabilities(conversationId: $conversationId) {
      canSend
      canSendFreeform
      canSendTemplate
      canSendMedia
      maxMediaItems
      mediaTypes {
        type
        mimeTypes
        maxBytes
        captionSupported
      }
      sessionWindowState
      freeformWindowExpiresAt
      freeformUnavailableReason
      templateUnavailableReason
    }
  }
`;

export const CREATE_INCONNECT_MESSAGING_OUTBOUND_UPLOAD = gql`
  mutation CreateInconnectMessagingOutboundUpload(
    $input: CreateInconnectMessagingOutboundUploadInput!
  ) {
    createInconnectMessagingOutboundUpload(input: $input) {
      uploadId
      state
      type
      filename
      size
      contentType
      uploadUrl
      uploadContentType
      expiresAt
    }
  }
`;

export const COMPLETE_INCONNECT_MESSAGING_OUTBOUND_UPLOAD = gql`
  mutation CompleteInconnectMessagingOutboundUpload($uploadId: UUID!) {
    completeInconnectMessagingOutboundUpload(uploadId: $uploadId) {
      uploadId
      state
      type
      filename
      size
      contentType
      expiresAt
    }
  }
`;

export const INCONNECT_MESSAGING_TEMPLATES = gql`
  query InconnectMessagingTemplates($conversationId: UUID!) {
    inconnectMessagingTemplates(conversationId: $conversationId) {
      id
      displayName
      language
      body
      variables {
        key
        required
        maxLength
      }
    }
  }
`;

export const SEND_INCONNECT_MESSAGING_MESSAGE = gql`
  mutation SendInconnectMessagingMessage(
    $input: SendInconnectMessagingMessageInput!
  ) {
    sendInconnectMessagingMessage(input: $input) {
      messageId
      outboundState
    }
  }
`;

export const ON_INCONNECT_MESSAGING_EVENT = gql`
  subscription OnInconnectMessagingEvent {
    onInconnectMessagingEvent {
      eventId
      eventType
      conversationId
    }
  }
`;
