import { type AttentionProjectionEvaluation } from 'src/modules/inconnect-messaging/attention-adapter/evaluate-attention-projection';
import { type AttentionReaderResult } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';
import { readObject } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  nullableRowValue,
  rowChoice,
  rowObject,
  rowScope,
  rowText,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import { attentionScopeKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';
import { type AttentionWriterAdmission } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { failAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-session';

export type AttentionWriterRead = Extract<
  AttentionReaderResult,
  { ok: true }
>['value'];

export const validateAttentionAdmission = (
  value: AttentionWriterAdmission | null,
  read: AttentionWriterRead,
  evaluation: AttentionProjectionEvaluation,
  providerStatusEventId: string | null,
): AttentionWriterAdmission => {
  if (value === null)
    return failAttentionWrite('AUTHORITY_REQUIRED', '$.admission');
  const admission = readObject(
    {
      scope: rowObject(rowScope),
      eventKey: rowText(1024),
      fingerprint: rowText(16384),
      authorityKind: rowChoice(['HUMAN', 'BACKEND', 'PROVIDER'] as const),
      actorWorkspaceMemberId: nullableRowValue(rowUuid),
      authenticationReference: rowText(16384),
      correlationReference: nullableRowValue(rowText(16384)),
      evidenceId: nullableRowValue(rowText(16384)),
      providerStatusEventId: nullableRowValue(rowUuid),
      outboundAdmission: nullableRowValue(
        rowChoice(['APPLIED', 'CONSUMED'] as const),
      ),
    },
    value,
  );
  const { plan } = read;
  const event = plan.input.event;
  const humanActor =
    event.kind === 'MANUAL_ACTION' || event.kind === 'MESSAGES_READ'
      ? event.actorWorkspaceMemberId
      : event.kind === 'RESPONSE_INTENDED' &&
          event.intent.provenance.kind === 'HUMAN'
        ? event.intent.provenance.actorWorkspaceMemberId
        : null;
  const kind =
    event.kind === 'PROVIDER_EVIDENCE'
      ? 'PROVIDER'
      : humanActor !== null
        ? 'HUMAN'
        : 'BACKEND';
  if (
    attentionScopeKey(admission.scope) !==
      attentionScopeKey(plan.input.scope) ||
    admission.eventKey !== plan.identity.eventKey ||
    admission.fingerprint !== plan.identity.fingerprint ||
    admission.authorityKind !== kind ||
    admission.actorWorkspaceMemberId !== humanActor ||
    (event.kind === 'PROVIDER_EVIDENCE'
      ? admission.correlationReference === null ||
        admission.evidenceId !== event.evidence.evidenceId ||
        admission.providerStatusEventId !== providerStatusEventId ||
        providerStatusEventId === null ||
        (evaluation.delta.effect !== null
          ? admission.outboundAdmission !== 'APPLIED'
          : admission.outboundAdmission === null)
      : admission.evidenceId !== null ||
        admission.providerStatusEventId !== null ||
        admission.outboundAdmission !== null)
  )
    return failAttentionWrite('AUTHORITY_REQUIRED', '$.admission.binding');
  return admission;
};
