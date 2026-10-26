import { randomUUID } from 'node:crypto';

import {
  durableFixture,
  durableEvent,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/__tests__/durable-inbound.fixtures';
import {
  identifier,
  initial,
  epoch,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  conversation,
  gateRow,
  sessionRow,
  step,
  type ReadFixture,
  type Step,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/__tests__/attention-reader.fixtures';
import {
  ATTENTION_SESSION_SQL,
  ATTENTION_CONFIGURATION_SQL,
  ATTENTION_ROOT_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import {
  ATTENTION_DEFER_SQL,
  ATTENTION_COMPLETE_SQL,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer-sql';
import { writerRunner } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { type ConversationAttentionState } from 'src/modules/inconnect-messaging/attention-domain';
import { RECEIPT_INGRESS_SCHEMA_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import { prepareTrackedInbound } from '../prepare-tracked-inbound';
import * as sql from '../tracked-inbound-sql';

export const causalFixture = async ({
  fresh = true,
  duplicate = false,
  fixture = {},
  before = initial(),
  form = {},
}: {
  fresh?: boolean;
  duplicate?: boolean;
  fixture?: ReadFixture;
  before?: ConversationAttentionState;
  form?: Record<string, string>;
} = {}) => {
  const durable = await durableFixture(fixture, before, form);
  const webhook = durable.normalized;
  const receiptParameters = [
    identifier(27),
    scope.workspaceId,
    scope.providerConnectionId,
  ];
  const parameters = [
    scope.workspaceId,
    scope.conversationId,
    scope.providerConnectionId,
  ];
  const locator = {
    id: identifier(27),
    workspaceId: scope.workspaceId,
    providerConnectionId: scope.providerConnectionId,
    eventKind: 'INBOUND_MESSAGE',
    idempotencyKey: webhook.providerMessageId,
    payloadHash: durable.stored.payloadHash,
    normalizedMetadata: webhook,
    version: durable.stored.ingressContractVersion,
  };
  const lease = {
    id: identifier(27),
    processingState: 'PROCESSING',
    leaseToken: identifier(28),
    leaseValid: true,
    attemptCount: 1,
    unfinished: true,
  };
  const root = {
    conversation: conversation(before.status, before.revision),
    epoch: { ...epoch },
  };
  if (fresh)
    root.epoch.bootstrapReference = JSON.stringify([
      'new-inbound-conversation-v1',
      identifier(27),
      scope.conversationId,
    ]);
  const session = () => step(ATTENTION_SESSION_SQL, [], [sessionRow]);
  const controls = (statement: string) => {
    const records: unknown[] = [];
    return [
      session(),
      {
        ...step(statement, [], []),
        result: { records, raw: records, affected: null },
      },
      session(),
    ];
  };
  const prefix = [
    session(),
    step(ATTENTION_CONFIGURATION_SQL, [scope.workspaceId], [{ ...gateRow }]),
    step(
      RECEIPT_INGRESS_SCHEMA_SQL,
      [],
      [{ installed: true, compatible: true }],
    ),
    step(sql.INBOUND_LOCATOR_SQL, receiptParameters, [locator]),
    step(
      sql.INBOUND_CONNECTION_SQL,
      [scope.workspaceId, scope.providerConnectionId],
      [{ id: scope.providerConnectionId }],
    ),
    ...controls(ATTENTION_DEFER_SQL),
    step(
      sql.INBOUND_CREATE_CONVERSATION_SQL,
      [
        scope.workspaceId,
        scope.providerConnectionId,
        webhook.externalAddressNormalized,
        scope.conversationId,
        webhook.waId,
      ],
      fresh ? [{ id: scope.conversationId }] : [],
    ),
    step(
      sql.INBOUND_LOCK_CONVERSATION_SQL,
      [
        scope.workspaceId,
        scope.providerConnectionId,
        webhook.externalAddressNormalized,
      ],
      [
        {
          id: scope.conversationId,
          workspaceId: scope.workspaceId,
          providerConnectionId: scope.providerConnectionId,
          externalAddressNormalized: webhook.externalAddressNormalized,
        },
      ],
    ),
    step(ATTENTION_ROOT_SQL, parameters, [
      fresh
        ? {
            conversation: {
              ...conversation(),
              attentionTrackingEpochId: null,
              attentionStatus: null,
              attentionRevision: null,
            },
            epoch: null,
          }
        : root,
    ]),
  ];
  const ids = [scope.conversationId];
  if (fresh) {
    ids.push(scope.trackingEpochId);
    prefix.push(
      step(
        sql.INBOUND_CREATE_EPOCH_SQL,
        [...parameters, scope.trackingEpochId, root.epoch.bootstrapReference],
        [{ id: scope.trackingEpochId }],
      ),
      step(
        sql.INBOUND_PREPARE_POINTER_SQL,
        [...parameters, scope.trackingEpochId],
        [{ id: scope.conversationId }],
      ),
      step(
        sql.INBOUND_READY_EPOCH_SQL,
        [...parameters, scope.trackingEpochId],
        [{ id: scope.trackingEpochId }],
      ),
      step(ATTENTION_ROOT_SQL, parameters, [root]),
    );
  }
  prefix.push(
    step(sql.INBOUND_LOCK_RECEIPT_SQL, receiptParameters, [
      { id: identifier(27) },
    ]),
    step(sql.INBOUND_LOCATOR_SQL, receiptParameters, [locator]),
    step(sql.INBOUND_RECEIPT_LEASE_SQL, receiptParameters, [lease]),
    step(
      sql.INBOUND_MESSAGE_SQL,
      [scope.providerConnectionId, webhook.providerMessageId],
      duplicate
        ? [
            {
              id: identifier(10),
              workspaceId: scope.workspaceId,
              conversationId: scope.conversationId,
              providerConnectionId: scope.providerConnectionId,
              attentionTrackingEpochId: scope.trackingEpochId,
              direction: 'INBOUND',
            },
          ]
        : [],
    ),
  );
  if (!duplicate) {
    ids.push(identifier(10));
    prefix.push(
      step(
        sql.INBOUND_INSERT_MESSAGE_SQL,
        [
          ...parameters,
          scope.trackingEpochId,
          identifier(10),
          webhook.messageType,
          webhook.body,
          webhook.providerMessageId,
          JSON.stringify(webhook.providerMetadata),
          webhook.serverReceivedAt,
          webhook.providerOccurredAt,
          webhook.effectiveInboundAt,
          webhook.timestampSource,
        ],
        [{ id: identifier(10) }],
      ),
    );
    const attachments = webhook.attachments as {
      ordinal: number;
      type: string;
      providerMediaLocator: string | null;
      declaredMimeType: string | null;
      safeFilename: string;
    }[];
    for (const attachment of attachments) {
      const id = identifier(50 + attachment.ordinal);
      ids.push(id);
      prefix.push(
        step(
          sql.INBOUND_INSERT_ATTACHMENT_SQL,
          [
            id,
            scope.workspaceId,
            scope.providerConnectionId,
            identifier(10),
            attachment.ordinal,
            attachment.type,
            attachment.providerMediaLocator,
            attachment.declaredMimeType,
            attachment.safeFilename,
            attachment.providerMediaLocator !== null &&
            attachment.declaredMimeType !== null
              ? 'PENDING'
              : 'FAILED',
            attachment.providerMediaLocator !== null &&
            attachment.declaredMimeType !== null
              ? null
              : 'MALFORMED_PROVIDER_MEDIA_METADATA',
          ],
          [{ id }],
        ),
      );
    }
    prefix.push(
      step(
        sql.INBOUND_UPDATE_ACTIVITY_SQL,
        [...parameters, webhook.effectiveInboundAt, webhook.waId],
        [{ id: scope.conversationId }],
      ),
    );
  }
  // Keep R3/III-A/II/C1/reducer real. Only the driver boundary is scripted.
  for (const entry of durable.scenario.steps) {
    entry.rows = entry.rows.map((row) =>
      row !== null && typeof row === 'object' && 'epoch' in row
        ? { ...row, epoch: root.epoch }
        : row,
    );
  }
  ids.push(
    ...[
      durable.scenario.ids.auditId,
      durable.scenario.ids.effectId,
      durable.scenario.ids.receiptId,
      durable.scenario.ids.intentId,
      durable.scenario.ids.outboxId,
    ].filter((id): id is string => id !== null),
  );
  const payload = {
    messageId: identifier(10),
    conversationId: scope.conversationId,
    providerConnectionId: scope.providerConnectionId,
    messageType: webhook.messageType,
    effectiveInboundAt: webhook.effectiveInboundAt,
  };
  const key = `inconnect-messaging:receipt:${identifier(27)}:message`;
  const suffix: Step[] = duplicate
    ? [
        step(
          sql.INBOUND_ORIGINAL_OUTBOX_SQL,
          [key],
          [
            {
              id: identifier(200),
              workspaceId: scope.workspaceId,
              aggregateType: 'MESSAGE',
              aggregateId: identifier(10),
              eventType: 'INBOUND_MESSAGE_RECEIVED',
              immutablePayload: payload,
              deduplicationKey: key,
            },
          ],
        ),
      ]
    : [
        step(
          sql.INBOUND_INSERT_OUTBOX_SQL,
          [
            identifier(200),
            scope.workspaceId,
            identifier(10),
            JSON.stringify(payload),
            key,
          ],
          [{ id: identifier(200) }],
        ),
      ];
  if (!duplicate) ids.push(identifier(200));
  suffix.push(
    step(
      sql.INBOUND_FINALIZE_RECEIPT_SQL,
      [...receiptParameters, identifier(28)],
      [{ id: identifier(27) }],
    ),
    ...controls(ATTENTION_COMPLETE_SQL),
    session(),
  );
  const steps = [...prefix, ...durable.scenario.steps, ...suffix];
  const claim = {
    receiptId: identifier(27),
    workspaceId: scope.workspaceId,
    providerConnectionId: scope.providerConnectionId,
    leaseToken: identifier(28),
  };
  const start = () => {
    const queue = [...ids];
    jest.mocked(randomUUID).mockImplementation(() => {
      const id = queue.shift();
      if (!id) throw new Error('Unexpected UUID');
      return id as ReturnType<typeof randomUUID>;
    });
    const harness = writerRunner(steps);
    Object.assign(harness.runner.manager, {
      query: async (statement: string, values: unknown[]) =>
        (await harness.queryRunner.query(statement, values, true)).records,
    });
    return {
      ...harness,
      prepare: () =>
        prepareTrackedInbound({ queryRunner: harness.queryRunner, claim }),
      claim,
    };
  };
  return {
    durable,
    root,
    locator,
    lease,
    steps,
    ids,
    claim,
    start,
    event: durableEvent(),
  };
};
