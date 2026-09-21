import { AddInconnectMessagingConversationWorkStateFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790006024000-add-inconnect-messaging-conversation-work-state';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('AddInconnectMessagingConversationWorkStateFastInstanceCommand', () => {
  it('is registered as a 2.32 instance command', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddInconnectMessagingConversationWorkStateFastInstanceCommand,
    );
  });

  it('uses a PostgreSQL activation baseline without historical or member backfills', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingConversationWorkStateFastInstanceCommand().up(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      '"workStateTrackingBaselineAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      'CREATE TABLE "core"."inconnectMessagingConversationMemberState"',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("conversationId", "workspaceId")',
    );
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).not.toContain('twilio');
  });

  it('drops only Fase 9A work state on downgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AddInconnectMessagingConversationWorkStateFastInstanceCommand().down(
      { query } as never,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain(
      'DROP TABLE "core"."inconnectMessagingConversationMemberState"',
    );
    expect(sql).toContain('DROP COLUMN "pendingAt"');
    expect(sql).toContain('DROP COLUMN "workStateTrackingBaselineAt"');
    expect(sql).not.toContain('DROP TABLE "core"."inconnectMessagingMessage"');
    expect(sql).not.toContain(
      'DROP TABLE "core"."inconnectMessagingConversation"',
    );
  });
});
