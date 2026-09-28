import { AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790550000000-add-inconnect-messaging-phone-identity-fields';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand', () => {
  it('is registered by the normal instance command runner', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand,
    );
  });

  it('creates an anchor-bound ordered phone identity configuration', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand().up({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectMessagingPhoneIdentityField"',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("workspaceId", "objectMetadataId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("fieldMetadataId", "objectMetadataId", "workspaceId")',
    );
    expect(sql).toContain(`CHECK ("role" IN ('PRIMARY', 'MATCH_ONLY'))`);
    expect(sql).toContain(
      `WHERE "role" = 'PRIMARY'`,
    );
    expect(sql).toContain(
      'IDX_INCONNECT_MSG_PHONE_IDENTITY_WORKSPACE_FIELD_UNIQUE',
    );
    expect(sql).toContain(
      'IDX_INCONNECT_MSG_PHONE_IDENTITY_WORKSPACE_ORDINAL_UNIQUE',
    );
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT)\s/im);
  });

  it('drops only phone identity configuration on downgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingPhoneIdentityFieldsFastInstanceCommand().down(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'DROP TABLE "core"."inconnectMessagingPhoneIdentityField"',
    );
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConfiguration"',
    );
  });
});
