import { AddInconnectMessagingContextFieldsFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790010000000-add-inconnect-messaging-context-fields';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('AddInconnectMessagingContextFieldsFastInstanceCommand', () => {
  it('is registered by the normal instance command runner', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddInconnectMessagingContextFieldsFastInstanceCommand,
    );
  });

  it('creates only the ordered context presentation allowlist', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingContextFieldsFastInstanceCommand().up({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectMessagingContextField"',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId", "objectMetadataId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("fieldMetadataId", "objectMetadataId", "workspaceId")',
    );
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain(
      'IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_FIELD_UNIQUE',
    );
    expect(sql).toContain(
      'IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_ORDINAL_UNIQUE',
    );
    expect(sql).not.toContain('messagingConfigurationId');
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT)\s/im);
  });

  it('drops only context presentation configuration on downgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingContextFieldsFastInstanceCommand().down({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('DROP TABLE "core"."inconnectMessagingContextField"');
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConversation"',
    );
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConfiguration"',
    );
  });
});
