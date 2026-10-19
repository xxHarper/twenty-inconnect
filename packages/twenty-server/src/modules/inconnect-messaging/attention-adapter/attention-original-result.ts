import { type OriginalAttentionResult } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';

// JSONB and serialization may reorder object properties; compare explicit fields.
export const originalAttentionResultKey = (
  original: OriginalAttentionResult,
): string => {
  const { audit } = original;
  const { provenance, evidence } = audit;

  return JSON.stringify([
    original.kind,
    original.reason,
    [
      audit.scope.workspaceId,
      audit.scope.conversationId,
      audit.scope.providerConnectionId,
    ],
    audit.eventKey,
    audit.effectKey,
    audit.eventKind,
    [audit.before.status, audit.before.revision],
    [audit.after.status, audit.after.revision],
    audit.attentionChanged,
    audit.intentId,
    audit.messageId,
    audit.actorWorkspaceMemberId,
    audit.coveredRevision,
    provenance === null
      ? null
      : [
          provenance.kind,
          provenance.kind === 'HUMAN'
            ? provenance.actorWorkspaceMemberId
            : null,
          provenance.authorityReference,
        ],
    evidence === null
      ? null
      : [evidence.evidenceId, evidence.providerMessageId, evidence.status],
    audit.successPolicy,
  ]);
};
