import {
  type AttentionEffectRow,
  type AttentionEpochRow,
  type AttentionResponseIntentRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import {
  mapAttentionEffect,
  mapAttentionIntent,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence-mappers';
import {
  decodeAttentionEffectRow,
  decodeAttentionResponseIntentRow,
  decodeAttentionProviderStatusColumns,
  decodeAttentionTransitionAuditRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import {
  type AttentionReadSession,
  decodeReadValue,
  failAttentionRead,
  readObject,
  unknownReadValue,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import { ATTENTION_EFFECT_LINKS_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';

export const attentionScopeParameters = (
  epoch: AttentionEpochRow,
): readonly string[] => [
  epoch.workspaceId,
  epoch.conversationId,
  epoch.providerConnectionId,
  epoch.id,
];

// Missing mandatory dependents remain explicit nulls for the accepted mappers.
export const readAttentionEffectLinks = async (
  session: AttentionReadSession,
  epoch: AttentionEpochRow,
  effectId: string,
) => {
  const row = readObject(
    {
      effect: unknownReadValue,
      canonicalReceipt: unknownReadValue,
      canonicalAudit: unknownReadValue,
      message: unknownReadValue,
      intent: unknownReadValue,
      providerStatus: unknownReadValue,
      webhook: unknownReadValue,
      registrationEffect: unknownReadValue,
      registrationReceipt: unknownReadValue,
      registrationAudit: unknownReadValue,
      registrationMessage: unknownReadValue,
    },
    await session.one(ATTENTION_EFFECT_LINKS_SQL, [
      ...attentionScopeParameters(epoch),
      effectId,
    ]),
  );
  const effect = decodeReadValue(decodeAttentionEffectRow(row.effect));
  if (effect.id !== effectId)
    return failAttentionRead('INVALID_CAUSAL_REFERENCE', '$.effect.id');
  const rows = { epoch, ...row };
  const logicalEffect = decodeReadValue(mapAttentionEffect(rows));
  const knownEffects = [logicalEffect];
  let logicalIntent = null;
  const originals = [logicalEffect.original];
  if (effect.responseIntentId !== null) {
    const intent = decodeReadValue(
      decodeAttentionResponseIntentRow(row.intent),
    );
    knownEffects.push(
      decodeReadValue(
        mapAttentionEffect({
          epoch,
          intent,
          effect: row.registrationEffect,
          canonicalReceipt: row.registrationReceipt,
          canonicalAudit: row.registrationAudit,
          message: row.registrationMessage,
        }),
      ),
    );
    logicalIntent = decodeReadValue(
      mapAttentionIntent({
        epoch,
        intent,
        effect: row.registrationEffect,
        canonicalReceipt: row.registrationReceipt,
        canonicalAudit: row.registrationAudit,
        message: row.registrationMessage,
      }),
    );
  }
  if (logicalIntent !== null) {
    const original = decodeReadValue(
      decodeAttentionTransitionAuditRow(row.registrationAudit),
    ).result;
    if (original.kind === 'CONFLICT')
      return failAttentionRead('IMPOSSIBLE_RESULT', '$.registrationAudit');
    originals.push({ ...original, kind: original.kind });
  }
  if (effect.eventKind === 'PROVIDER_EVIDENCE') {
    const status = decodeReadValue(
      decodeAttentionProviderStatusColumns(row.providerStatus),
    );
    // This retained evidence flag is required by C2-I-B; it does not authenticate
    // a new callback or prove current outbound admission.
    if (!status.appliedToProjection)
      return failAttentionRead(
        'INVALID_CAUSAL_REFERENCE',
        '$.providerStatus.appliedToProjection',
      );
  }
  return {
    rows,
    effect,
    logicalEffect,
    logicalIntent,
    originals,
    knownEffects,
  };
};

// Compare decoded field order, never raw JSONB property order. This verifies
// that the independently selected point matches the linked row in this read.
export const requireSameAttentionEffect = (
  point: AttentionEffectRow,
  linked: AttentionEffectRow,
) => {
  if (JSON.stringify(point) !== JSON.stringify(linked))
    return failAttentionRead('SNAPSHOT_CHANGED', '$.effect');
};
export const requireSameAttentionIntent = (
  point: AttentionResponseIntentRow,
  linked: unknown,
) => {
  const intent = decodeReadValue(decodeAttentionResponseIntentRow(linked));
  if (JSON.stringify(point) !== JSON.stringify(intent))
    return failAttentionRead('SNAPSHOT_CHANGED', '$.intent');
};
