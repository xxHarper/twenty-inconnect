import { type AttentionEvent } from 'src/modules/inconnect-messaging/attention-domain/conversation-attention.types';

// Malformed runtime revisions must reach validation, including raw bigint input.
const revisionIdentity = (revision: string) =>
  typeof revision === 'string' ? revision : null;

// Ordered tuples avoid property-order differences and delimiter collisions.
export const getAttentionEventIdentity = (event: AttentionEvent) => {
  switch (event.kind) {
    case 'INBOUND_RECEIVED':
      return {
        effectKey: JSON.stringify(['INBOUND', event.messageId]),
        fingerprint: JSON.stringify([event.kind, event.messageId]),
      };
    case 'MESSAGES_READ':
      return {
        effectKey: JSON.stringify(['READ', event.eventKey]),
        fingerprint: JSON.stringify([event.kind, event.actorWorkspaceMemberId]),
      };
    case 'MANUAL_ACTION':
      return {
        effectKey: JSON.stringify([
          'MANUAL',
          event.actorWorkspaceMemberId,
          event.intentId,
        ]),
        fingerprint: JSON.stringify([
          event.kind,
          event.intentId,
          event.actorWorkspaceMemberId,
          event.action,
          revisionIdentity(event.observedRevision),
        ]),
      };
    case 'RESPONSE_INTENDED': {
      const intent = event.intent;

      return {
        effectKey: JSON.stringify(['RESPONSE', intent.intentId]),
        fingerprint: JSON.stringify([
          event.kind,
          intent.intentId,
          intent.messageId,
          intent.contentFingerprint,
          revisionIdentity(intent.coveredRevision),
          intent.format,
          intent.provenance.kind,
          intent.provenance.kind === 'HUMAN'
            ? intent.provenance.actorWorkspaceMemberId
            : null,
          intent.provenance.authorityReference,
        ]),
      };
    }
    case 'PROVIDER_EVIDENCE':
      return {
        effectKey: JSON.stringify([
          'EVIDENCE',
          event.evidence.providerMessageId,
          event.evidence.evidenceId,
        ]),
        fingerprint: JSON.stringify([
          event.kind,
          event.intentId,
          event.messageId,
          event.evidence.providerMessageId,
          event.evidence.evidenceId,
          event.evidence.status,
        ]),
      };
  }
};
