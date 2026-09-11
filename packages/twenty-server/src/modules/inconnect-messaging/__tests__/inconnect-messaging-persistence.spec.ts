import { DataSource, getMetadataArgsStorage, type EntityTarget } from 'typeorm';

import { CreateInconnectMessagingTransportSpineFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1788982508902-create-inconnect-messaging-transport-spine';
import { AddInconnectMessagingWebhookProjectionFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789040000000-add-inconnect-messaging-webhook-projection';
import { BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1789040000001-backfill-inconnect-messaging-webhook-projection';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingDispatchAttemptEntity } from 'src/modules/inconnect-messaging/entities/dispatch-attempt.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingProviderStatusEventEntity } from 'src/modules/inconnect-messaging/entities/provider-status-event.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';

const MESSAGING_ENTITIES: EntityTarget<object>[] = [
  InconnectMessagingConfigurationEntity,
  InconnectMessagingProviderConnectionEntity,
  InconnectMessagingConversationEntity,
  InconnectMessagingMessageEntity,
  InconnectMessagingDispatchAttemptEntity,
  InconnectMessagingWebhookReceiptEntity,
  InconnectMessagingProviderStatusEventEntity,
  InconnectMessagingOutboxEventEntity,
];

const buildMetadataDataSource = async (): Promise<DataSource> => {
  const entityTargets = [
    ...new Set(getMetadataArgsStorage().tables.map(({ target }) => target)),
  ];
  const dataSource = new DataSource({
    type: 'postgres',
    database: 'metadata-only',
    entities: entityTargets,
    schema: 'core',
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  return dataSource;
};

describe('INCONNECT Messaging persistence model', () => {
  it('keeps every entity, check, index, and foreign key represented in the Fast Instance Command', async () => {
    const dataSource = await buildMetadataDataSource();
    const query = jest.fn().mockResolvedValue(undefined);

    await new CreateInconnectMessagingTransportSpineFastInstanceCommand().up({
      query,
    } as never);
    await new AddInconnectMessagingWebhookProjectionFastInstanceCommand().up({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    for (const entity of MESSAGING_ENTITIES) {
      const metadata = dataSource.getMetadata(entity);

      expect(sql).toContain(
        `CREATE TABLE "${metadata.schema}"."${metadata.tableName}"`,
      );

      for (const check of metadata.checks) {
        expect(sql).toContain(`CONSTRAINT "${check.name}" CHECK`);
      }

      for (const index of metadata.indices) {
        expect(sql).toContain(`INDEX "${index.name}"`);
      }

      for (const foreignKey of metadata.foreignKeys) {
        expect(sql).toContain(
          `ADD CONSTRAINT "${foreignKey.name}" FOREIGN KEY`,
        );
      }
    }
  });

  it('rejects mixed linked tuples and anchors other than the configured workspace anchor', async () => {
    const dataSource = await buildMetadataDataSource();
    const metadata = dataSource.getMetadata(
      InconnectMessagingConversationEntity,
    );
    const linkedTupleCheck = metadata.checks.find(
      ({ name }) => name === 'CHK_INCONNECT_MSG_CONVERSATION_LINKED_TUPLE',
    );
    const anchorForeignKey = metadata.foreignKeys.find(
      ({ name }) => name === 'FK_INCONNECT_MSG_CONVERSATION_ANCHOR',
    );

    expect(linkedTupleCheck?.expression).toContain(
      '"linkedRecordObjectMetadataId" IS NULL AND "linkedRecordId" IS NULL',
    );
    expect(linkedTupleCheck?.expression).toContain(
      '"linkedRecordObjectMetadataId" IS NOT NULL AND "linkedRecordId" IS NOT NULL',
    );
    expect(anchorForeignKey?.columnNames).toEqual([
      'workspaceId',
      'linkedRecordObjectMetadataId',
    ]);
    expect(anchorForeignKey?.referencedColumnNames).toEqual([
      'workspaceId',
      'anchorObjectMetadataId',
    ]);
    expect(anchorForeignKey?.onDelete).toBe('RESTRICT');
  });

  it('uses composite foreign keys to reject cross-workspace internal relations', async () => {
    const dataSource = await buildMetadataDataSource();
    const compositeForeignKeyNames = [
      'FK_INCONNECT_MSG_CONFIG_ANCHOR',
      'FK_INCONNECT_MSG_CONVERSATION_CONNECTION',
      'FK_INCONNECT_MSG_CONVERSATION_ANCHOR',
      'FK_INCONNECT_MSG_MESSAGE_CONVERSATION',
      'FK_INCONNECT_MSG_MESSAGE_RETRY_OF',
      'FK_INCONNECT_MSG_ATTEMPT_MESSAGE',
      'FK_INCONNECT_MSG_WEBHOOK_CONNECTION',
      'FK_INCONNECT_MSG_STATUS_MESSAGE',
      'FK_INCONNECT_MSG_STATUS_RECEIPT',
    ];
    const foreignKeys = MESSAGING_ENTITIES.flatMap(
      (entity) => dataSource.getMetadata(entity).foreignKeys,
    );

    for (const foreignKeyName of compositeForeignKeyNames) {
      const foreignKey = foreignKeys.find(
        ({ name }) => name === foreignKeyName,
      );

      expect(foreignKey?.columnNames).toContain('workspaceId');
      expect(foreignKey?.referencedColumnNames).toContain('workspaceId');
    }
  });

  it.each([
    [
      InconnectMessagingWebhookReceiptEntity,
      'IDX_INCONNECT_MSG_WEBHOOK_IDEMPOTENCY_UNIQUE',
      ['providerConnectionId', 'eventKind', 'idempotencyKey'],
    ],
    [
      InconnectMessagingOutboxEventEntity,
      'IDX_INCONNECT_MSG_OUTBOX_DEDUPLICATION_UNIQUE',
      ['deduplicationKey'],
    ],
    [
      InconnectMessagingDispatchAttemptEntity,
      'IDX_INCONNECT_MSG_ATTEMPT_MESSAGE_NUMBER_UNIQUE',
      ['messageId', 'attemptNumber'],
    ],
    [
      InconnectMessagingMessageEntity,
      'IDX_INCONNECT_MSG_MESSAGE_CLIENT_REQUEST_UNIQUE',
      ['workspaceId', 'clientRequestId'],
    ],
    [
      InconnectMessagingMessageEntity,
      'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE',
      ['providerConnectionId', 'providerMessageId'],
    ],
    [
      InconnectMessagingConversationEntity,
      'IDX_INCONNECT_MSG_CONVERSATION_CONNECTION_ADDRESS_UNIQUE',
      ['providerConnectionId', 'externalAddressNormalized'],
    ],
    [
      InconnectMessagingProviderStatusEventEntity,
      'IDX_INCONNECT_MSG_STATUS_RECEIPT_UNIQUE',
      ['webhookReceiptId'],
    ],
  ] as [EntityTarget<object>, string, string[]][])(
    'defines required unique index %s',
    async (entity, indexName, expectedColumns) => {
      const dataSource = await buildMetadataDataSource();
      const index = dataSource
        .getMetadata(entity)
        .indices.find(({ name }) => name === indexName);

      expect(index?.isUnique).toBe(true);
      expect(index?.columns.map(({ databaseName }) => databaseName)).toEqual(
        expectedColumns,
      );
    },
  );

  it('prevents Message provider connection from diverging from Conversation', async () => {
    const dataSource = await buildMetadataDataSource();
    const foreignKey = dataSource
      .getMetadata(InconnectMessagingMessageEntity)
      .foreignKeys.find(
        ({ name }) => name === 'FK_INCONNECT_MSG_MESSAGE_CONVERSATION',
      );

    expect(foreignKey?.columnNames).toEqual([
      'conversationId',
      'providerConnectionId',
      'workspaceId',
    ]);
    expect(foreignKey?.referencedColumnNames).toEqual([
      'id',
      'providerConnectionId',
      'workspaceId',
    ]);
  });

  it('persists the required inbound timestamp contract without changing outbound rows', async () => {
    const dataSource = await buildMetadataDataSource();
    const messageMetadata = dataSource.getMetadata(
      InconnectMessagingMessageEntity,
    );
    const conversationMetadata = dataSource.getMetadata(
      InconnectMessagingConversationEntity,
    );
    const timestampCheck = messageMetadata.checks.find(
      ({ name }) => name === 'CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS',
    );

    expect(
      messageMetadata.columns.map(({ databaseName }) => databaseName),
    ).toEqual(
      expect.arrayContaining([
        'serverReceivedAt',
        'providerOccurredAt',
        'effectiveInboundAt',
        'timestampSource',
      ]),
    );
    expect(
      conversationMetadata.columns.map(({ databaseName }) => databaseName),
    ).toContain('lastInboundAt');
    expect(timestampCheck?.expression).toContain('"direction" = \'INBOUND\'');
    expect(timestampCheck?.expression).toContain('"direction" = \'OUTBOUND\'');
  });

  it('keeps projection backfills out of the fast command and validates after the slow backfill', async () => {
    const fastQuery = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingWebhookProjectionFastInstanceCommand().up({
      query: fastQuery,
    } as never);

    expect(
      fastQuery.mock.calls.some(([statement]) => /^UPDATE\s/i.test(statement)),
    ).toBe(false);
    expect(
      fastQuery.mock.calls.some(([statement]) =>
        statement.includes('CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS'),
      ),
    ).toBe(true);

    const slowQuery = jest.fn().mockResolvedValue(undefined);

    await new BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand().runDataMigration(
      { query: slowQuery } as unknown as DataSource,
    );

    expect(slowQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "core"."inconnectMessagingMessage"'),
    );
    expect(slowQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(
        'VALIDATE CONSTRAINT "CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS"',
      ),
    );
  });
});
