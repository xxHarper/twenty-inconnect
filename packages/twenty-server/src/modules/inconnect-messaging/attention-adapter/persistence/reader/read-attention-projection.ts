import {
  type AttentionProjectionFacts,
  type LogicalAttentionIntent,
  type LogicalAttentionEffect,
  type OriginalAttentionResult,
  type AttentionTrackingScope,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { eventFromAttentionFingerprint } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-fingerprint-decoder';
import { requireAttentionScope } from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-relational-validation';
import { originalAttentionResultKey } from 'src/modules/inconnect-messaging/attention-adapter/attention-original-result';
import { copyAttentionEvent } from 'src/modules/inconnect-messaging/attention-adapter/attention-event-copy';
import {
  planAttentionProjection,
  reconstructAttentionProjection,
} from 'src/modules/inconnect-messaging/attention-adapter/attention-projection';
import { identifyAttentionEffect } from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';
import {
  mapAttentionReceipt,
  mapAttentionSnapshot,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence-mappers';
import {
  decodeAttentionConversationColumns,
  decodeAttentionEffectRow,
  decodeAttentionEpochRow,
  decodeAttentionMessageColumns,
  decodeAttentionReceiptRow,
  decodeAttentionResponseIntentRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-decoders';
import {
  decodeAttentionValue,
  rowBoolean,
  nullableRowValue,
  rowTimestamp,
  rowText,
  rowObject,
  rowScope,
  rowUuid,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-row-codec';
import {
  attentionScopeParameters,
  readAttentionEffectLinks,
  requireSameAttentionEffect,
  requireSameAttentionIntent,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-links';
import {
  AttentionReadFailure,
  createAttentionReadSession,
  decodeReadValue,
  failAttentionRead,
  readObject,
  unknownReadValue,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-session';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_ORIGINAL_AUDIT_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SLOTS_SQL,
  ATTENTION_SOURCE_MESSAGE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  type AttentionReaderInput,
  type AttentionReaderResult,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader.types';

// The only entry point always takes both locks. No caller-supplied plan, facts,
// negative-cache result or "already locked" flag can bypass this sequence.
export const readAttentionProjection = async ({
  queryRunner,
  input,
}: AttentionReaderInput): Promise<AttentionReaderResult> => {
  try {
    decodeReadValue(decodeAttentionValue(rowObject(rowScope), input.scope));
    const identity = identifyAttentionEffect(input);
    if (!identity.ok) return failAttentionRead('INVALID_PROJECTION', '$.input');
    // Freeze routing and identity before the first asynchronous boundary.
    const requested = copyAttentionEvent(input);
    decodeReadValue(
      decodeAttentionValue(() => {
        rowText(1024)(identity.value.eventKey, '$.input.eventKey');
        rowText(1024)(identity.value.effectKey, '$.input.effectKey');
        rowText(16384)(identity.value.fingerprint, '$.input.fingerprint');
        return eventFromAttentionFingerprint(
          identity.value.fingerprint,
          identity.value.eventKey,
          requested.scope,
        );
      }, requested),
    );
    const scope = requested.scope;
    const checkPointScope = (point: AttentionTrackingScope) =>
      decodeReadValue(
        decodeAttentionValue(() => requireAttentionScope(scope, point), point),
      );
    const conversationParameters = [
      scope.workspaceId,
      scope.conversationId,
      scope.providerConnectionId,
    ];
    const session = createAttentionReadSession(queryRunner);
    await session.verify();
    const configurations = await session.query(ATTENTION_CONFIGURATION_SQL, [
      scope.workspaceId,
    ]);
    if (configurations.length === 0)
      return failAttentionRead('GATE_MISSING', '$.configuration');
    if (configurations.length !== 1)
      return failAttentionRead('INCOMPLETE_PROJECTION', '$.configuration');
    const gate = readObject(
      {
        workspaceId: rowUuid,
        installed: rowBoolean,
        mode: unknownReadValue,
        protocolVersion: unknownReadValue,
        gateUpdatedAt: nullableRowValue(rowTimestamp),
      },
      configurations[0],
    );
    if (gate.workspaceId !== scope.workspaceId)
      return failAttentionRead('SCOPE_MISMATCH', '$.configuration');
    if (!gate.installed)
      return failAttentionRead('SCHEMA_NOT_INSTALLED', '$.configuration');
    if (
      typeof gate.mode !== 'string' ||
      !['DISABLED', 'PREPARING', 'ENABLED', 'SUSPENDED'].includes(gate.mode) ||
      (gate.protocolVersion !== null &&
        (typeof gate.protocolVersion !== 'number' ||
          !Number.isSafeInteger(gate.protocolVersion) ||
          gate.protocolVersion <= 0)) ||
      (gate.mode !== 'DISABLED' && gate.gateUpdatedAt === null)
    )
      return failAttentionRead('INVALID_CONFIGURATION', '$.configuration');
    if (gate.mode === 'DISABLED')
      return failAttentionRead('TRACKING_DISABLED', '$.configuration');
    if (gate.mode === 'PREPARING')
      return failAttentionRead('TRACKING_PREPARING', '$.configuration');
    if (gate.mode === 'SUSPENDED')
      return failAttentionRead('TRACKING_SUSPENDED', '$.configuration');
    if (gate.mode !== 'ENABLED' || gate.protocolVersion !== 1)
      return failAttentionRead(
        'INCOMPATIBLE_VERSION',
        '$.configuration.protocolVersion',
      );

    const locks = await session.query(
      ATTENTION_CONVERSATION_LOCK_SQL,
      conversationParameters,
    );
    if (locks.length === 0)
      return failAttentionRead('CONVERSATION_MISSING', '$.conversation');
    if (locks.length !== 1)
      return failAttentionRead('INCOMPLETE_PROJECTION', '$.conversation');
    const locked = readObject(
      { id: rowUuid, workspaceId: rowUuid, providerConnectionId: rowUuid },
      locks[0],
    );
    if (
      locked.id !== scope.conversationId ||
      locked.workspaceId !== scope.workspaceId ||
      locked.providerConnectionId !== scope.providerConnectionId
    )
      return failAttentionRead('SCOPE_MISMATCH', '$.conversation');

    const root = readObject(
      { conversation: unknownReadValue, epoch: unknownReadValue },
      await session.one(ATTENTION_ROOT_SQL, conversationParameters),
    );
    const conversation = decodeReadValue(
      decodeAttentionConversationColumns(root.conversation),
    );
    if (
      conversation.id !== scope.conversationId ||
      conversation.workspaceId !== scope.workspaceId ||
      conversation.providerConnectionId !== scope.providerConnectionId
    )
      return failAttentionRead('SCOPE_MISMATCH', '$.conversation');
    if (conversation.attentionTrackingEpochId === null)
      return failAttentionRead('EPOCH_UNPREPARED', '$.conversation');
    if (root.epoch === null)
      return failAttentionRead('EPOCH_MISSING', '$.epoch');
    const epoch = decodeReadValue(decodeAttentionEpochRow(root.epoch));
    if (
      conversation.attentionTrackingEpochId !== scope.trackingEpochId ||
      epoch.id !== scope.trackingEpochId
    )
      return failAttentionRead('SCOPE_MISMATCH', '$.epoch');
    const snapshot = decodeReadValue(mapAttentionSnapshot(conversation, epoch));
    if (epoch.lifecycle === 'PREPARING')
      return failAttentionRead('EPOCH_PREPARING', '$.epoch');
    if (epoch.lifecycle === 'SUSPENDED')
      return failAttentionRead('EPOCH_SUSPENDED', '$.epoch');
    if (epoch.lifecycle === 'CLOSED')
      return failAttentionRead('EPOCH_CLOSED', '$.epoch');
    const planned = planAttentionProjection(snapshot, requested);
    if (!planned.ok) return failAttentionRead('INVALID_PROJECTION', '$.plan');
    const plan = planned.value;
    const event = plan.input.event;
    const sourceMessageId =
      event.kind === 'RESPONSE_INTENDED'
        ? event.intent.messageId
        : event.kind === 'INBOUND_RECEIVED' ||
            event.kind === 'PROVIDER_EVIDENCE'
          ? event.messageId
          : null;
    let sourceMessage = null;
    if (sourceMessageId !== null) {
      decodeReadValue(decodeAttentionValue(rowUuid, sourceMessageId));
      const source = readObject(
        { message: unknownReadValue },
        await session.one(ATTENTION_SOURCE_MESSAGE_SQL, [
          ...conversationParameters,
          sourceMessageId,
        ]),
      );
      sourceMessage = decodeReadValue(
        decodeAttentionMessageColumns(source.message),
      );
      if (
        sourceMessage.id !== sourceMessageId ||
        sourceMessage.workspaceId !== scope.workspaceId ||
        sourceMessage.conversationId !== scope.conversationId ||
        sourceMessage.providerConnectionId !== scope.providerConnectionId ||
        sourceMessage.attentionTrackingEpochId !== epoch.id
      )
        return failAttentionRead('SCOPE_MISMATCH', '$.sourceMessage');
      if (
        sourceMessage.direction !==
          (event.kind === 'INBOUND_RECEIVED' ? 'INBOUND' : 'OUTBOUND') ||
        (event.kind === 'PROVIDER_EVIDENCE' &&
          sourceMessage.providerMessageId !== event.evidence.providerMessageId)
      )
        return failAttentionRead('INVALID_CAUSAL_REFERENCE', '$.sourceMessage');
    }
    const parameters = [
      ...attentionScopeParameters(epoch),
      plan.identity.eventKey,
      plan.identity.effectKey,
    ];
    if (plan.intentLookup.kind !== 'NONE')
      parameters.push(plan.intentLookup.value);
    const slots = readObject(
      {
        conversation: unknownReadValue,
        epoch: unknownReadValue,
        receiptPresent: rowBoolean,
        receipt: unknownReadValue,
        effectPresent: rowBoolean,
        effect: unknownReadValue,
        intentPresent: rowBoolean,
        intent: unknownReadValue,
      },
      await session.one(
        ATTENTION_SLOTS_SQL[plan.intentLookup.kind],
        parameters,
      ),
    );
    const freshConversation = decodeReadValue(
      decodeAttentionConversationColumns(slots.conversation),
    );
    const freshEpoch = decodeReadValue(decodeAttentionEpochRow(slots.epoch));
    if (
      JSON.stringify(conversation) !== JSON.stringify(freshConversation) ||
      JSON.stringify(epoch) !== JSON.stringify(freshEpoch)
    )
      return failAttentionRead('SNAPSHOT_CHANGED', '$.root');
    for (const [present, row] of [
      [slots.receiptPresent, slots.receipt],
      [slots.effectPresent, slots.effect],
      [slots.intentPresent, slots.intent],
    ]) {
      if (present !== (row !== null))
        return failAttentionRead('INCOMPLETE_PROJECTION', '$.slots');
    }
    const knownIntents: LogicalAttentionIntent[] = [];
    const knownEffects: LogicalAttentionEffect[] = [];
    const originals: OriginalAttentionResult[] = [];
    const remember = (
      linked: Awaited<ReturnType<typeof readAttentionEffectLinks>>,
    ) => {
      originals.push(...linked.originals);
      knownEffects.push(...linked.knownEffects);
      if (linked.logicalIntent !== null)
        knownIntents.push(linked.logicalIntent);
    };
    let effect = null;
    if (slots.effectPresent) {
      const point = decodeReadValue(decodeAttentionEffectRow(slots.effect));
      checkPointScope(point);
      const linked = await readAttentionEffectLinks(session, epoch, point.id);
      remember(linked);
      requireSameAttentionEffect(point, linked.effect);
      effect = linked.logicalEffect;
    }
    let eventReceipt = null;
    if (slots.receiptPresent) {
      const point = decodeReadValue(decodeAttentionReceiptRow(slots.receipt));
      checkPointScope(point);
      const linked = await readAttentionEffectLinks(
        session,
        epoch,
        point.effectId,
      );
      remember(linked);
      const original = readObject(
        { audit: unknownReadValue },
        await session.one(ATTENTION_ORIGINAL_AUDIT_SQL, [
          ...attentionScopeParameters(epoch),
          point.originalAuditId,
        ]),
      );
      eventReceipt = decodeReadValue(
        mapAttentionReceipt({
          ...linked.rows,
          receipt: point,
          originalAudit: original.audit,
        }),
      );
    }
    let intent = null;
    if (slots.intentPresent) {
      const point = decodeReadValue(
        decodeAttentionResponseIntentRow(slots.intent),
      );
      checkPointScope(point);
      const linked = await readAttentionEffectLinks(
        session,
        epoch,
        point.registeredEffectId,
      );
      remember(linked);
      requireSameAttentionIntent(point, linked.rows.intent);
      if (linked.logicalIntent === null)
        return failAttentionRead('INCOMPLETE_DATA', '$.intent.registration');
      intent = linked.logicalIntent;
    }
    const facts: AttentionProjectionFacts = { effect, eventReceipt, intent };
    if (eventReceipt !== null) originals.push(eventReceipt.original);
    // Compare only bounded supplied history, including registration witnesses.
    // One epoch revision cannot describe two different attention statuses.
    const statuses = new Map<string, string>([
      [snapshot.revision, snapshot.status],
      [epoch.bootstrapRevision, epoch.bootstrapStatus],
    ]);
    for (const original of originals) {
      for (const state of [original.audit.before, original.audit.after]) {
        if (
          BigInt(state.revision) > BigInt(snapshot.revision) ||
          (statuses.has(state.revision) &&
            statuses.get(state.revision) !== state.status)
        )
          return failAttentionRead('IMPOSSIBLE_RESULT', '$.history');
        statuses.set(state.revision, state.status);
      }
    }
    const effectsByKey = new Map<string, string>();
    for (const known of knownEffects) {
      const signature = JSON.stringify([
        known.fingerprint,
        known.canonicalEventKey,
        originalAttentionResultKey(known.original),
      ]);
      if (
        effectsByKey.has(known.effectKey) &&
        effectsByKey.get(known.effectKey) !== signature
      )
        return failAttentionRead(
          'INVALID_CAUSAL_REFERENCE',
          '$.knownConsumption',
        );
      effectsByKey.set(known.effectKey, signature);
      if (
        (known.effectKey === plan.identity.effectKey && effect === null) ||
        (known.canonicalEventKey === plan.identity.eventKey &&
          eventReceipt === null)
      )
        return failAttentionRead('INCOMPLETE_PROJECTION', '$.knownConsumption');
    }
    for (const known of knownIntents) {
      if (BigInt(known.intent.coveredRevision) > BigInt(snapshot.revision))
        return failAttentionRead(
          'IMPOSSIBLE_RESULT',
          '$.intent.coveredRevision',
        );
      const matches =
        plan.intentLookup.kind === 'INTENT_ID'
          ? known.intent.intentId === plan.intentLookup.value
          : plan.intentLookup.kind === 'MESSAGE_ID' &&
            known.intent.messageId === plan.intentLookup.value;
      if (
        matches &&
        (intent === null || JSON.stringify(known) !== JSON.stringify(intent))
      )
        return failAttentionRead('INCOMPLETE_PROJECTION', '$.intent.slot');
    }
    if (!reconstructAttentionProjection(plan, facts).ok)
      return failAttentionRead('INVALID_PROJECTION', '$.facts');
    await session.verify();
    return {
      ok: true,
      value: {
        plan,
        facts,
        epoch,
        sourceMessage,
        unresolved: [
          'CURRENT_AUTHORITY',
          'SOURCE_AUTHENTICATION_AND_CORRELATION',
          'EVIDENCE_ID_BINDING_AND_OUTBOUND_ADMISSION',
          'PHYSICAL_POSTGRESQL_ACCEPTANCE',
        ],
      },
    };
  } catch (error) {
    if (error instanceof AttentionReadFailure)
      return { ok: false, error: error.failure };
    throw error;
  }
};
