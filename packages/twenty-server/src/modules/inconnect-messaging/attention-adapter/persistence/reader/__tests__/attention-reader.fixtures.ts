import { type QueryRunner } from 'typeorm';

import {
  type AttentionConversationColumns,
  type AttentionEffectRow,
  type AttentionMessageColumns,
  type AttentionReceiptRow,
  type AttentionResponseIntentRow,
  type AttentionTransitionAuditRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { type AttentionEvent } from 'src/modules/inconnect-messaging/attention-domain';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import {
  epoch,
  inbound,
  physicalRows,
  scope,
  timestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_CONVERSATION_LOCK_SQL,
  ATTENTION_EFFECT_LINKS_SQL,
  ATTENTION_ORIGINAL_AUDIT_SQL,
  ATTENTION_ROOT_SQL,
  ATTENTION_SESSION_SQL,
  ATTENTION_SLOTS_SQL,
  ATTENTION_SOURCE_MESSAGE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { readAttentionProjection } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/read-attention-projection';

export const conversation = (
  status: 'PENDING' | 'ATTENDED' = 'ATTENDED',
  revision = '0',
): AttentionConversationColumns => ({
  id: scope.conversationId,
  workspaceId: scope.workspaceId,
  providerConnectionId: scope.providerConnectionId,
  attentionTrackingEpochId: scope.trackingEpochId,
  attentionStatus: status,
  attentionRevision: revision,
  pendingAt: status === 'PENDING' ? timestamp : null,
});
export const sessionRow = {
  isolation: 'read committed',
  readOnly: 'off',
  rowSecurity: 'off',
  inRecovery: false,
  backendPid: 41,
  transactionId: '18446744073709551615',
  statementTimeout: '10000',
  lockTimeout: '2000',
};
export const gateRow = {
  workspaceId: scope.workspaceId,
  installed: true,
  mode: 'ENABLED',
  protocolVersion: 1,
  gateUpdatedAt: timestamp,
};
export const parametersC = [
  scope.workspaceId,
  scope.conversationId,
  scope.providerConnectionId,
];
export const parametersS = [...parametersC, scope.trackingEpochId];
export const structured = (records: unknown[]) => ({
  records,
  raw: records,
  affected: records.length,
});
export type Step = {
  sql: string;
  parameters: readonly unknown[];
  rows: unknown[];
  error?: unknown;
  result?: unknown;
  onQuery?: () => void | Promise<void>;
};
export const step = (
  sql: string,
  parameters: readonly unknown[],
  rows: unknown[],
): Step => ({ sql, parameters, rows });

// A script of exact SQL/parameters/order expectations. Assertion mismatches are
// retained outside the reader catch boundary so error tests cannot swallow them.
export const mockRunner = (steps: Step[]) => {
  const calls: { sql: string; parameters: unknown[]; structured: boolean }[] =
    [];
  const mismatches: unknown[] = [];
  const connection = { isInitialized: true, options: { type: 'postgres' } };
  const manager = { connection, queryRunner: null as unknown };
  const runner = {
    manager,
    connection,
    mode: 'master',
    transactionDepth: 1,
    databaseConnection: {},
    isTransactionActive: true,
    isReleased: false,
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(
      async (
        sql: string,
        parameters: unknown[],
        useStructuredResult: boolean,
      ) => {
        const index = calls.length;
        calls.push({ sql, parameters, structured: useStructuredResult });
        const expected = steps[index];
        if (
          !expected ||
          sql !== expected.sql ||
          JSON.stringify(parameters) !== JSON.stringify(expected.parameters) ||
          useStructuredResult !== true
        ) {
          mismatches.push({ index, sql, parameters });
          throw new Error('Unexpected SQL/parameters/order');
        }
        await expected.onQuery?.();
        if (expected.error) throw expected.error;
        return expected.result ?? structured(expected.rows);
      },
    ),
  };
  manager.queryRunner = runner;
  return {
    runner,
    // Only the test double is narrowed; production accepts an actual QueryRunner.
    queryRunner: runner as unknown as QueryRunner,
    calls,
    done: () => {
      expect(mismatches).toEqual([]);
      expect(calls).toHaveLength(steps.length);
      expect(calls.length).toBeLessThanOrEqual(11);
      for (const method of [
        runner.connect,
        runner.startTransaction,
        runner.commitTransaction,
        runner.rollbackTransaction,
        runner.release,
      ])
        expect(method).not.toHaveBeenCalled();
      expect(calls.every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
    },
  };
};

export const bundle = (
  rows: ReturnType<typeof physicalRows>,
  registration?: ReturnType<typeof physicalRows>,
) => {
  const registered =
    registration ??
    (rows.effect.eventKind === 'RESPONSE_INTENDED' ? rows : undefined);
  return {
    effect: rows.effect,
    canonicalReceipt: rows.canonicalReceipt,
    canonicalAudit: rows.canonicalAudit,
    message: rows.message ?? null,
    intent: rows.intent ?? null,
    providerStatus: rows.providerStatus ?? null,
    webhook: rows.providerStatus?.webhookReceiptId ? rows.webhook : null,
    registrationEffect: registered?.effect ?? null,
    registrationReceipt: registered?.canonicalReceipt ?? null,
    registrationAudit: registered?.canonicalAudit ?? null,
    registrationMessage: registered?.message ?? null,
  };
};
export type ReadFixture = {
  event?: AttentionEvent;
  current?: AttentionConversationColumns;
  receipt?: AttentionReceiptRow | null;
  effect?: AttentionEffectRow | null;
  intent?: AttentionResponseIntentRow | null;
  originalAudit?: AttentionTransitionAuditRow;
  bundles?: Record<string, ReturnType<typeof bundle>>;
};
export const script = (fixture: ReadFixture = {}) => {
  const event = fixture.event ?? inbound();
  const current = fixture.current ?? conversation();
  const receipt = fixture.receipt ?? null;
  const effect = fixture.effect ?? null;
  const intent = fixture.intent ?? null;
  const identity = getAttentionEventIdentity(event);
  const lookup =
    event.kind === 'PROVIDER_EVIDENCE'
      ? 'INTENT_ID'
      : event.kind === 'RESPONSE_INTENDED'
        ? 'MESSAGE_ID'
        : 'NONE';
  const root = { conversation: current, epoch };
  const slots = {
    ...root,
    receiptPresent: receipt !== null,
    receipt,
    effectPresent: effect !== null,
    effect,
    intentPresent: intent !== null,
    intent,
  };
  const steps = [
    step(ATTENTION_SESSION_SQL, [], [sessionRow]),
    step(ATTENTION_CONFIGURATION_SQL, [scope.workspaceId], [gateRow]),
    step(ATTENTION_CONVERSATION_LOCK_SQL, parametersC, [
      {
        id: scope.conversationId,
        workspaceId: scope.workspaceId,
        providerConnectionId: scope.providerConnectionId,
      },
    ]),
    step(ATTENTION_ROOT_SQL, parametersC, [root]),
  ];
  const messageId =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent.messageId
      : event.kind === 'INBOUND_RECEIVED' || event.kind === 'PROVIDER_EVIDENCE'
        ? event.messageId
        : null;
  if (messageId !== null) {
    const message: AttentionMessageColumns = {
      id: messageId,
      workspaceId: scope.workspaceId,
      conversationId: scope.conversationId,
      providerConnectionId: scope.providerConnectionId,
      attentionTrackingEpochId: scope.trackingEpochId,
      direction: event.kind === 'INBOUND_RECEIVED' ? 'INBOUND' : 'OUTBOUND',
      sendMode:
        event.kind === 'INBOUND_RECEIVED'
          ? null
          : event.kind === 'RESPONSE_INTENDED'
            ? event.intent.format
            : 'TEMPLATE',
      providerMessageId: 'provider-message',
    };
    steps.push(
      step(
        ATTENTION_SOURCE_MESSAGE_SQL,
        [...parametersC, messageId],
        [{ message }],
      ),
    );
  }
  steps.push(
    step(
      ATTENTION_SLOTS_SQL[lookup],
      [
        ...parametersS,
        event.eventKey,
        identity.effectKey,
        ...(lookup === 'NONE'
          ? []
          : [
              event.kind === 'PROVIDER_EVIDENCE'
                ? event.intentId
                : event.kind === 'RESPONSE_INTENDED'
                  ? event.intent.messageId
                  : '',
            ]),
      ],
      [slots],
    ),
  );
  const addBundle = (effectId: string) =>
    steps.push(
      step(
        ATTENTION_EFFECT_LINKS_SQL,
        [...parametersS, effectId],
        [fixture.bundles?.[effectId]],
      ),
    );
  if (effect !== null) addBundle(effect.id);
  if (receipt !== null) {
    addBundle(receipt.effectId);
    steps.push(
      step(
        ATTENTION_ORIGINAL_AUDIT_SQL,
        [...parametersS, receipt.originalAuditId],
        [{ audit: fixture.originalAudit }],
      ),
    );
  }
  if (intent !== null) addBundle(intent.registeredEffectId);
  steps.push(step(ATTENTION_SESSION_SQL, [], [sessionRow]));
  return { event, steps, root, slots };
};
export const runScript = async (fixture: ReadFixture = {}) => {
  const scenario = script(fixture);
  const harness = mockRunner(scenario.steps);
  const result = await readAttentionProjection({
    queryRunner: harness.queryRunner,
    input: { scope, event: scenario.event },
  });
  harness.done();
  return result;
};
