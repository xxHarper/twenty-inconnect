import { type QueryRunner } from 'typeorm';

import { CreateInconnectMessagingTransportSpineFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1788982508902-create-inconnect-messaging-transport-spine';

const TABLES = [
  'inconnectMessagingConfiguration',
  'inconnectMessagingProviderConnection',
  'inconnectMessagingConversation',
  'inconnectMessagingMessage',
  'inconnectMessagingDispatchAttempt',
  'inconnectMessagingWebhookReceipt',
  'inconnectMessagingProviderStatusEvent',
  'inconnectMessagingOutboxEvent',
] as const;

describe('CreateInconnectMessagingTransportSpineFastInstanceCommand', () => {
  it('creates only the eight Phase 2 tables with their critical constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new CreateInconnectMessagingTransportSpineFastInstanceCommand().up({
      query,
    } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([statement]) => statement as string);
    const sql = statements.join('\n');

    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE "core"."${table}"`);
    }

    expect(
      statements.filter((statement) => statement.startsWith('CREATE TABLE')),
    ).toHaveLength(TABLES.length);
    expect(sql).not.toContain('inconnectCommercialTeam');
    expect(sql).toContain('CHK_INCONNECT_MSG_CONVERSATION_LINKED_TUPLE');
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId", "linkedRecordObjectMetadataId") REFERENCES "core"."inconnectMessagingConfiguration"("workspaceId","anchorObjectMetadataId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("conversationId", "providerConnectionId", "workspaceId") REFERENCES "core"."inconnectMessagingConversation"("id","providerConnectionId","workspaceId")',
    );
    expect(sql).toContain('IDX_INCONNECT_MSG_WEBHOOK_IDEMPOTENCY_UNIQUE');
    expect(sql).toContain('IDX_INCONNECT_MSG_OUTBOX_DEDUPLICATION_UNIQUE');
    expect(sql).toContain('IDX_INCONNECT_MSG_ATTEMPT_MESSAGE_NUMBER_UNIQUE');
    expect(sql).toContain('IDX_INCONNECT_MSG_MESSAGE_CLIENT_REQUEST_UNIQUE');
    expect(sql).toContain('IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE');
  });

  it('drops all Phase 2 tables in dependency-safe order', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new CreateInconnectMessagingTransportSpineFastInstanceCommand().down({
      query,
    } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([statement]) => statement as string);

    for (const table of TABLES) {
      expect(statements).toContain(`DROP TABLE "core"."${table}"`);
    }

    expect(
      statements.indexOf(
        'DROP TABLE "core"."inconnectMessagingProviderStatusEvent"',
      ),
    ).toBeLessThan(
      statements.indexOf('DROP TABLE "core"."inconnectMessagingMessage"'),
    );
    expect(
      statements.indexOf('DROP TABLE "core"."inconnectMessagingMessage"'),
    ).toBeLessThan(
      statements.indexOf('DROP TABLE "core"."inconnectMessagingConversation"'),
    );
    expect(
      statements.indexOf('DROP TABLE "core"."inconnectMessagingConversation"'),
    ).toBeLessThan(
      statements.indexOf(
        'DROP TABLE "core"."inconnectMessagingProviderConnection"',
      ),
    );
    expect(
      statements.indexOf(
        'DROP TABLE "core"."inconnectMessagingProviderConnection"',
      ),
    ).toBeLessThan(
      statements.indexOf(
        'DROP TABLE "core"."inconnectMessagingConfiguration"',
      ),
    );
  });

  it('keeps every PostgreSQL identifier within the 63-byte limit', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new CreateInconnectMessagingTransportSpineFastInstanceCommand().up({
      query,
    } as unknown as QueryRunner);

    const identifiers = query.mock.calls
      .map(([statement]) => statement as string)
      .flatMap((statement) =>
        [...statement.matchAll(/"(PK_|FK_|CHK_|IDX_)([^"]+)"/g)].map(
          ([identifier]) => identifier.slice(1, -1),
        ),
      );

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.every((identifier) => identifier.length <= 63)).toBe(
      true,
    );
  });
});
