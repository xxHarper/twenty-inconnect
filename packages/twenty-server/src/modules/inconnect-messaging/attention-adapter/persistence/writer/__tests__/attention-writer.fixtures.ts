import { type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

import {
  apply,
  identifier,
  inbound,
  initial,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  script,
  sessionRow,
  step,
  structured,
  type ReadFixture,
  type Step,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { type ConversationAttentionState } from 'src/modules/inconnect-messaging/attention-domain';
import { getAttentionEventIdentity } from 'src/modules/inconnect-messaging/attention-domain/attention-event-identity';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import * as sql from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import {
  type AttentionWriterAdmission,
  type AttentionWriterInput,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';

export const parameters = [
  scope.workspaceId,
  scope.conversationId,
  scope.providerConnectionId,
  scope.trackingEpochId,
];
export const manual = (
  action: 'PENDING' | 'ATTENDED',
  observedRevision: string,
) => ({
  kind: 'MANUAL_ACTION' as const,
  scope,
  eventKey: 'manual',
  intentId: 'manual-intent',
  actorWorkspaceMemberId: identifier(12),
  action,
  observedRevision,
});
export const writerScript = (
  fixture: ReadFixture = {},
  before: ConversationAttentionState = initial(),
) => {
  const event = fixture.event ?? inbound();
  const reading = script({ ...fixture, event });
  const full = apply(before, event);
  const { state: _state, ...outcome } = full;
  const identity = getAttentionEventIdentity(event);
  // Independent complete-ledger oracle, NOT C1 delta or the writer mapping.
  const effectNew =
    full.kind !== 'CONFLICT' &&
    !before.receipts.some(
      (receipt) => receipt.effectKey === identity.effectKey,
    );
  const receiptNew =
    full.kind !== 'CONFLICT' &&
    !before.receipts.some((receipt) => receipt.eventKey === event.eventKey);
  const intentNew =
    event.kind === 'RESPONSE_INTENDED' && full.kind === 'APPLIED';
  let nextId = 100;
  const ids = {
    auditId: identifier(nextId++),
    effectId: effectNew ? identifier(nextId++) : null,
    receiptId: receiptNew ? identifier(nextId++) : null,
    intentId: intentNew ? identifier(nextId++) : null,
    outboxId: full.audit.attentionChanged ? identifier(nextId++) : null,
  };
  const cause: AttentionWriterInput['causal'] = {
    webhook:
      event.kind === 'INBOUND_RECEIVED' || event.kind === 'PROVIDER_EVIDENCE'
        ? { id: identifier(27), leaseToken: identifier(28) }
        : null,
    providerStatusEventId:
      event.kind === 'PROVIDER_EVIDENCE' ? identifier(25) : null,
  };
  const actor =
    event.kind === 'MANUAL_ACTION' || event.kind === 'MESSAGES_READ'
      ? event.actorWorkspaceMemberId
      : event.kind === 'RESPONSE_INTENDED' &&
          event.intent.provenance.kind === 'HUMAN'
        ? event.intent.provenance.actorWorkspaceMemberId
        : null;
  const admission: AttentionWriterAdmission = {
    scope,
    eventKey: event.eventKey,
    fingerprint: identity.fingerprint,
    authorityKind:
      event.kind === 'PROVIDER_EVIDENCE'
        ? 'PROVIDER'
        : actor === null
          ? 'BACKEND'
          : 'HUMAN',
    actorWorkspaceMemberId: actor,
    authenticationReference: 'current-verified-authority',
    correlationReference:
      event.kind === 'PROVIDER_EVIDENCE' ? 'backend-evidence-binding-v1' : null,
    providerStatusEventId: cause.providerStatusEventId,
    evidenceId:
      event.kind === 'PROVIDER_EVIDENCE' ? event.evidence.evidenceId : null,
    outboundAdmission:
      event.kind === 'PROVIDER_EVIDENCE'
        ? effectNew
          ? 'APPLIED'
          : 'CONSUMED'
        : null,
  };
  const sessionStep = () => step(ATTENTION_SESSION_SQL, [], [sessionRow]);
  const steps: Step[] = [
    sessionStep(),
    ...reading.steps,
    sessionStep(),
    sessionStep(),
  ];
  if (cause.webhook !== null)
    steps.push(
      step(
        sql.ATTENTION_WEBHOOK_LOCK_SQL,
        [...parameters.slice(0, 3), cause.webhook.id, cause.webhook.leaseToken],
        [
          {
            id: cause.webhook.id,
            workspaceId: scope.workspaceId,
            providerConnectionId: scope.providerConnectionId,
            eventKind:
              event.kind === 'INBOUND_RECEIVED'
                ? 'INBOUND_MESSAGE'
                : 'STATUS_CALLBACK',
            leaseValid: true,
          },
        ],
      ),
    );
  const messageId =
    event.kind === 'RESPONSE_INTENDED'
      ? event.intent.messageId
      : event.kind === 'PROVIDER_EVIDENCE' || event.kind === 'INBOUND_RECEIVED'
        ? event.messageId
        : null;
  if (messageId !== null)
    steps.push(
      step(
        sql.ATTENTION_CAUSAL_MESSAGE_SQL,
        [...parameters, messageId],
        [
          {
            id: messageId,
            direction:
              event.kind === 'INBOUND_RECEIVED' ? 'INBOUND' : 'OUTBOUND',
            sendMode:
              event.kind === 'INBOUND_RECEIVED'
                ? null
                : event.kind === 'RESPONSE_INTENDED'
                  ? event.intent.format
                  : 'TEMPLATE',
            providerMessageId: 'provider-message',
            outboundState:
              event.kind === 'PROVIDER_EVIDENCE'
                ? event.evidence.status
                : event.kind === 'RESPONSE_INTENDED'
                  ? 'QUEUED'
                  : null,
            createdHere: effectNew && event.kind !== 'PROVIDER_EVIDENCE',
            updatedHere: event.kind === 'PROVIDER_EVIDENCE' && effectNew,
          },
        ],
      ),
    );
  if (event.kind === 'PROVIDER_EVIDENCE')
    steps.push(
      step(
        sql.ATTENTION_CAUSAL_STATUS_SQL,
        [
          ...parameters,
          messageId,
          cause.providerStatusEventId,
          identity.effectKey,
          identity.fingerprint,
        ],
        [
          {
            id: cause.providerStatusEventId,
            webhookReceiptId: cause.webhook?.id ?? null,
            normalizedStatus: event.evidence.status,
            appliedToProjection: true,
            createdHere: effectNew,
            consumedBinding: !effectNew,
          },
        ],
      ),
    );
  const control = (statement: string) => {
    const records: unknown[] = [];
    steps.push(
      sessionStep(),
      {
        ...step(statement, [], []),
        result: { records, raw: records, affected: null },
      },
      sessionStep(),
    );
  };
  const insert = (statement: string, values: unknown[], id: string | null) =>
    steps.push(step(statement, values, [{ id }]));
  control(sql.ATTENTION_DEFER_SQL);
  if (effectNew)
    insert(
      sql.ATTENTION_INSERT_EFFECT_SQL,
      [
        ...parameters,
        ids.effectId,
        identity.effectKey,
        identity.fingerprint,
        ids.receiptId,
        event.kind,
        full.audit.messageId,
        event.kind === 'RESPONSE_INTENDED' || event.kind === 'PROVIDER_EVIDENCE'
          ? full.audit.intentId
          : null,
        cause.providerStatusEventId,
      ],
      ids.effectId,
    );
  insert(
    sql.ATTENTION_INSERT_AUDIT_SQL,
    [
      ...parameters,
      ids.auditId,
      event.eventKey,
      identity.effectKey,
      identity.fingerprint,
      JSON.stringify(outcome),
      admission.authorityKind,
      admission.authenticationReference,
      admission.correlationReference,
    ],
    ids.auditId,
  );
  if (receiptNew)
    steps.push(
      step(
        sql.ATTENTION_INSERT_RECEIPT_SQL,
        [
          ...parameters,
          ids.receiptId,
          event.eventKey,
          ids.auditId,
          identity.effectKey,
          identity.fingerprint,
        ],
        [{ id: ids.receiptId, effectId: ids.effectId ?? fixture.effect?.id }],
      ),
    );
  if (intentNew && event.kind === 'RESPONSE_INTENDED') {
    const intent = event.intent;
    insert(
      sql.ATTENTION_INSERT_INTENT_SQL,
      [
        ...parameters,
        ids.intentId,
        intent.intentId,
        intent.messageId,
        intent.contentFingerprint,
        intent.coveredRevision,
        intent.provenance.kind,
        intent.provenance.kind === 'HUMAN'
          ? intent.provenance.actorWorkspaceMemberId
          : null,
        intent.provenance.authorityReference,
        intent.format,
        ids.effectId,
      ],
      ids.intentId,
    );
  }
  if (full.audit.attentionChanged) {
    insert(
      sql.ATTENTION_UPDATE_CONVERSATION_SQL,
      [
        ...parameters,
        full.audit.before.status,
        full.audit.before.revision,
        full.audit.after.status,
        full.audit.after.revision,
      ],
      scope.conversationId,
    );
    insert(
      sql.ATTENTION_INSERT_OUTBOX_SQL,
      [...parameters, ids.outboxId, identity.effectKey],
      ids.outboxId,
    );
  }
  control(sql.ATTENTION_COMPLETE_SQL);
  return {
    steps,
    event,
    cause,
    admission,
    full,
    outcome,
    ids,
    readerLength: reading.steps.length,
  };
};

export const writerRunner = (steps: Step[]) => {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
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
      async (statement: string, values: unknown[], useStructured: boolean) => {
        const expected = steps[calls.length];
        calls.push({ sql: statement, parameters: values });
        if (
          !expected ||
          statement !== expected.sql ||
          JSON.stringify(values) !== JSON.stringify(expected.parameters) ||
          !useStructured
        ) {
          mismatches.push({ index: calls.length - 1, statement, values });
          throw new Error('Unexpected SQL/order/parameters');
        }
        await expected.onQuery?.();
        if (expected.error) throw expected.error;
        return expected.result ?? structured(expected.rows);
      },
    ),
  };
  manager.queryRunner = runner;
  const done = () => {
    expect(mismatches).toEqual([]);
    expect(calls).toHaveLength(steps.length);
    for (const method of [
      runner.connect,
      runner.startTransaction,
      runner.commitTransaction,
      runner.rollbackTransaction,
      runner.release,
    ])
      expect(method).not.toHaveBeenCalled();
  };
  return { runner, queryRunner: runner as unknown as QueryRunner, calls, done };
};
export const runWriter = async (scenario: ReturnType<typeof writerScript>) => {
  let count = 100;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => identifier(count++) as ReturnType<typeof randomUUID>,
    );
  const harness = writerRunner(scenario.steps);
  const admit = jest.fn(async () => scenario.admission);
  const result = await prepareAttentionWrite({
    queryRunner: harness.queryRunner,
    input: { scope, event: scenario.event },
    causal: scenario.cause,
    admit,
  });
  harness.done();
  return { result, harness, admit };
};
