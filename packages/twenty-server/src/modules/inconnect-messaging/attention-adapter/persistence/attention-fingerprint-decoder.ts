import {
  type AttentionEvent,
  type AttentionScope,
  type ResponseProvenance,
} from 'src/modules/inconnect-messaging/attention-domain';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import {
  rejectAttentionRow,
  rowEventKind,
  rowFormat,
  rowProviderStatus,
  rowProvenanceKind,
  rowRevision,
  rowStatus,
  rowText,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';

// The fingerprint is the existing v1 ordered tuple, not a new serialized event.
export const eventFromAttentionFingerprint = (
  fingerprint: string,
  eventKey: string,
  scope: AttentionScope,
): AttentionEvent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fingerprint);
  } catch {
    return rejectAttentionRow('INVALID_VALUE', '$.fingerprint');
  }
  if (!Array.isArray(parsed))
    return rejectAttentionRow('WRONG_TYPE', '$.fingerprint');
  const tuple: unknown[] = parsed;
  const kind = rowEventKind(tuple[0], '$.fingerprint.kind');
  const at = <TValue>(
    index: number,
    decode: (value: unknown, path: string) => TValue,
  ) => decode(tuple[index], `$.fingerprint[${index}]`);
  const common = { scope: { ...scope }, eventKey };
  let event: AttentionEvent;
  switch (kind) {
    case 'INBOUND_RECEIVED':
      event = { ...common, kind, messageId: at(1, rowUuid) };
      break;
    case 'MESSAGES_READ':
      event = { ...common, kind, actorWorkspaceMemberId: at(1, rowUuid) };
      break;
    case 'MANUAL_ACTION':
      event = {
        ...common,
        kind,
        intentId: at(1, rowText(128)),
        actorWorkspaceMemberId: at(2, rowUuid),
        action: at(3, rowStatus),
        observedRevision: at(4, rowRevision),
      };
      break;
    case 'RESPONSE_INTENDED': {
      const provenanceKind = at(6, rowProvenanceKind);
      const authorityReference = at(8, rowText(16384));
      if (provenanceKind !== 'HUMAN' && tuple[7] !== null)
        return rejectAttentionRow(
          'INVALID_CAUSAL_REFERENCE',
          '$.fingerprint.actor',
        );
      const provenance: ResponseProvenance =
        provenanceKind === 'HUMAN'
          ? {
              kind: provenanceKind,
              actorWorkspaceMemberId: at(7, rowUuid),
              authorityReference,
            }
          : { kind: provenanceKind, authorityReference };
      event = {
        ...common,
        kind,
        intent: {
          intentId: at(1, rowText(128)),
          messageId: at(2, rowUuid),
          contentFingerprint: at(3, rowText(16384)),
          coveredRevision: at(4, rowRevision),
          format: at(5, rowFormat),
          provenance,
        },
      };
      break;
    }
    case 'PROVIDER_EVIDENCE':
      event = {
        ...common,
        kind,
        intentId: at(1, rowText(128)),
        messageId: at(2, rowUuid),
        evidence: {
          providerMessageId: at(3, rowText(16384)),
          evidenceId: at(4, rowText(16384)),
          status: at(5, rowProviderStatus),
        },
      };
      break;
  }
  if (getAttentionEventIdentity(event).fingerprint !== fingerprint)
    return rejectAttentionRow('INVALID_VALUE', '$.fingerprint');
  return event;
};
