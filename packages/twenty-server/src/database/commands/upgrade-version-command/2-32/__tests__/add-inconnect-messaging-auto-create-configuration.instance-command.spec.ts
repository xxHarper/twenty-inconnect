import { AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand', () => {
  it('is registered by the normal instance command runner', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand,
    );
  });

  it('adds only disabled-by-default configuration with workspace-isolated references', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand().up(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'ADD "autoCreateEnabled" boolean NOT NULL DEFAULT false',
    );
    expect(sql).toContain('ADD "autoCreateAnchorObjectMetadataId" uuid');
    expect(sql).toContain('ADD "autoCreateOwnerRoleId" uuid');
    expect(sql).toContain(
      'FOREIGN KEY ("autoCreateAnchorObjectMetadataId", "workspaceId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("autoCreateOwnerRoleId", "workspaceId")',
    );
    expect(sql).toContain(
      '"autoCreateOwnerStrategy" = \'UNIQUE_ACTIVE_MEMBER_OF_ROLE\'',
    );
    expect(sql).toContain('"autoCreateLabelPolicy" = \'OMIT\'');
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\s/im);
    expect(sql).not.toContain('inconnectMessagingConversation');
  });

  it('drops only the auto-create configuration columns on downgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand().down(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('DROP COLUMN "autoCreateEnabled"');
    expect(sql).toContain('DROP COLUMN "autoCreateOwnerRoleId"');
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConfiguration"',
    );
    expect(sql).not.toContain('inconnectMessagingConversation');
  });
});
