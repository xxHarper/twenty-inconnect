import { AddInconnectMessagingAutomationPrincipalFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305700-add-inconnect-messaging-automation-principal';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('AddInconnectMessagingAutomationPrincipalFastInstanceCommand', () => {
  it('is registered by the normal instance command runner', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddInconnectMessagingAutomationPrincipalFastInstanceCommand,
    );
  });

  it('adds only a nullable server-owned UserWorkspace reference', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingAutomationPrincipalFastInstanceCommand().up({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('ADD "automationUserWorkspaceId" uuid');
    expect(sql).toContain(
      'FOREIGN KEY ("automationUserWorkspaceId") REFERENCES "core"."userWorkspace"("id")',
    );
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\s/im);
    expect(sql).not.toContain('autoCreateEnabled" = true');
  });

  it('drops only the automation reference on downgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingAutomationPrincipalFastInstanceCommand().down(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'DROP CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE"',
    );
    expect(sql).toContain('DROP COLUMN "automationUserWorkspaceId"');
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConfiguration"',
    );
  });
});
