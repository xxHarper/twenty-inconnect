import { randomUUID } from 'node:crypto';

import { type DurableInboundAttentionInput } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound.types';
import {
  DURABLE_INBOUND_FACT_SQL,
  DURABLE_INBOUND_RECEIPT_LOCK_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';
import { prepareDurableInboundAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/prepare-durable-inbound-attention-write';
import {
  identifier,
  initial,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  type ReadFixture,
  step,
  sessionRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import { ATTENTION_SESSION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  writerScript,
  writerRunner,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { ATTENTION_INSERT_AUDIT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { type ConversationAttentionState } from 'src/modules/inconnect-messaging/attention-domain';
import { originRequest } from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin.fixtures';
import {
  protectedFixture,
  protectedRequest,
} from 'src/modules/inconnect-messaging/webhook-ingress/__tests__/authenticated-ingress.fixtures';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import { READ_RECEIPT_INGRESS_CONTRACT_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';

export const durableEvent = () => ({
  kind: 'INBOUND_RECEIVED' as const,
  scope: {
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId,
    providerConnectionId: scope.providerConnectionId,
  },
  eventKey: JSON.stringify(['whatsapp-inbound-v1', identifier(27)]),
  messageId: identifier(10),
});
export const durableFixture = async (
  fixture: ReadFixture = {},
  before: ConversationAttentionState = initial(),
  form: Record<string, string> = {},
) => {
  // Positive provenance is emitted by the actual R2 verifier/capability/persister,
  // with the real local Twilio SDK. Only I/O is mocked. No trusted=true oracle.
  const issuance = protectedFixture();
  Object.assign(issuance.connection, {
    encryptedCredentials: 'enc:v2:source-only-fixture',
  });
  const request = {
    ...originRequest({ MessageSid: 'provider-message', ...form }),
    ingressTransport: protectedRequest().ingressTransport,
  };
  await issuance.ingress.acceptTwilioWhatsappWebhook(request);
  const stored: Record<string, unknown> = JSON.parse(
    JSON.stringify(issuance.state.original),
  );
  const normalized = stored.normalizedMetadata as Record<string, unknown>;
  const attachments = normalized.attachments as Record<string, unknown>[];
  const fact: Record<string, unknown> = {
    receiptId: stored.id,
    workspaceId: stored.workspaceId,
    providerConnectionId: stored.providerConnectionId,
    eventKind: stored.eventKind,
    idempotencyKey: stored.idempotencyKey,
    payloadHash: stored.payloadHash,
    normalizedMetadata: normalized,
    firstReceivedAt: stored.firstReceivedAt,
    processingState: 'PROCESSING',
    leaseToken: identifier(28),
    leaseValid: true,
    attemptCount: 1,
    processedAt: null,
    connectionId: issuance.connection.id,
    connectionWorkspaceId: issuance.connection.workspaceId,
    provider: issuance.connection.provider,
    channel: issuance.connection.channel,
    lifecycleStatus: issuance.connection.lifecycleStatus,
    inboundRoutingKey: issuance.connection.inboundRoutingKey,
    credentialsVersion: issuance.connection.credentialsVersion,
    credentialsConfigured:
      issuance.connection.encryptedCredentials?.startsWith('enc:v2:') === true,
    routingCount: '1',
    conversationId: scope.conversationId,
    externalAddressNormalized: normalized.externalAddressNormalized,
    currentEpochId: scope.trackingEpochId,
    messageId: identifier(10),
    messageConversationId: scope.conversationId,
    messageWorkspaceId: scope.workspaceId,
    messageConnectionId: scope.providerConnectionId,
    originEpochId: scope.trackingEpochId,
    direction: 'INBOUND',
    type: normalized.messageType,
    body: normalized.body,
    sendMode: null,
    outboundState: null,
    providerMessageId: normalized.providerMessageId,
    providerMetadata: JSON.parse(JSON.stringify(normalized.providerMetadata)),
    serverReceivedAt: normalized.serverReceivedAt,
    providerOccurredAt: normalized.providerOccurredAt,
    effectiveInboundAt: normalized.effectiveInboundAt,
    timestampSource: normalized.timestampSource,
    attachments: attachments.map(
      ({ providerMediaLocator: _locator, ...intent }) => intent,
    ),
  };
  const scenario = writerScript(
    { ...fixture, event: fixture.event ?? durableEvent() },
    before,
  );
  const parameters = [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
    scope.trackingEpochId,
    identifier(27),
  ];
  const schema = { installed: true, compatible: true };
  // The version is read from the serialized actual INSERT, never an API input.
  const version = { installed: true, version: stored.ingressContractVersion };
  const session = () => step(ATTENTION_SESSION_SQL, [], [sessionRow]);
  scenario.steps.splice(
    scenario.readerLength + 2,
    0,
    session(),
    step(RECEIPT_INGRESS_SCHEMA_SQL, [], [schema]),
    step(DURABLE_INBOUND_RECEIPT_LOCK_SQL, parameters, [{ id: stored.id }]),
    session(),
    step(
      READ_RECEIPT_INGRESS_CONTRACT_SQL,
      [stored.id, scope.workspaceId, scope.providerConnectionId],
      [version],
    ),
    session(),
    step(DURABLE_INBOUND_FACT_SQL, [...parameters, identifier(10)], [fact]),
    session(),
  );
  for (const statement of scenario.steps) {
    if (statement.sql === ATTENTION_INSERT_AUDIT_SQL) {
      statement.parameters = [
        ...statement.parameters.slice(0, -2),
        JSON.stringify([
          'durable-inbound-t1-v1',
          stored.id,
          stored.payloadHash,
        ]),
        JSON.stringify([
          'inbound-cause-v1',
          stored.id,
          identifier(10),
          normalized.providerMessageId,
        ]),
      ];
    }
  }
  const stopAfter = (sql: string, followingSessions = 0) => {
    const index = scenario.steps.findIndex((entry) => entry.sql === sql);
    if (index < 0) throw new Error('Missing expected step');
    scenario.steps.splice(index + 1);
    for (let count = 0; count < followingSessions; count++)
      scenario.steps.push(session());
  };
  const start = () => {
    let nextId = 100;
    jest
      .mocked(randomUUID)
      .mockImplementation(
        () => identifier(nextId++) as ReturnType<typeof randomUUID>,
      );
    const harness = writerRunner(scenario.steps);
    // Original manager routing, matching EntityManager.query's runner ownership.
    // The driver script remains strict, including the SQL and full parameters.
    const managerQuery = jest.fn(async (sql: string, values: unknown[]) => {
      const result = await harness.queryRunner.query(sql, values, true);
      return result.records;
    });
    Object.assign(harness.runner.manager, { query: managerQuery });
    const input: DurableInboundAttentionInput = {
      queryRunner: harness.queryRunner,
      scope: { ...scope },
      receiptId: String(stored.id),
      leaseToken: identifier(28),
      messageId: identifier(10),
    };
    return {
      ...harness,
      input,
      managerQuery,
      prepare: () => prepareDurableInboundAttentionWrite(input),
    };
  };
  return {
    issuance,
    stored,
    normalized,
    fact,
    schema,
    version,
    scenario,
    stopAfter,
    start,
  };
};
