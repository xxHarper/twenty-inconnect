import { AddInconnectMessagingTemplateIntentFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789473600000-add-inconnect-messaging-template-intent';

describe('AddInconnectMessagingTemplateIntentFastInstanceCommand', () => {
  it('adds provider-neutral durable template audit columns and checks', async () => {
    const statements: string[] = [];
    const query = jest.fn().mockImplementation((statement: string) => {
      statements.push(statement);
    });

    await new AddInconnectMessagingTemplateIntentFastInstanceCommand().up({
      query,
    } as never);

    expect(statements.join('\n')).toContain('"templateId" uuid');
    expect(statements.join('\n')).toContain('"templateProviderReference" text');
    expect(statements.join('\n')).toContain('"templateVariables" jsonb');
    expect(statements.join('\n')).toContain(
      'CHK_INCONNECT_MSG_MESSAGE_TEMPLATE',
    );
    expect(statements.join('\n')).toContain("'TEMPLATE'");
  });

  it('restores the prior FREEFORM-only contract on down', async () => {
    const statements: string[] = [];
    const query = jest.fn().mockImplementation((statement: string) => {
      statements.push(statement);
    });

    await new AddInconnectMessagingTemplateIntentFastInstanceCommand().down({
      query,
    } as never);

    expect(statements.join('\n')).toContain(
      'SET "sendMode" = \'FREEFORM\' WHERE "sendMode" = \'TEMPLATE\'',
    );
    expect(statements[statements.length - 1]).toContain(
      'DROP COLUMN "templateId"',
    );
  });
});
