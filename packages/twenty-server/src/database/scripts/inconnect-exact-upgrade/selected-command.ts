import {
  APPROVED_COMMANDS,
  type Request,
  requireCondition,
  requestSchema,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration';
import { AddInconnectMessagingAutomationPrincipalFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305700-add-inconnect-messaging-automation-principal';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';
import {
  createSessionConnectionVerification,
  type ExpectedIdentity,
} from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';

export const runSelectedCommand = async (
  input: Request,
  runner: Pick<InstanceCommandRunnerService, 'runFastInstanceCommand'>,
  expectedIdentity: ExpectedIdentity,
): Promise<
  Awaited<ReturnType<InstanceCommandRunnerService['runFastInstanceCommand']>>
> => {
  const request = requestSchema.parse(input);

  requireCondition(
    request.mode === 'execute' &&
      request.confirmExecute === request.command &&
      Boolean(request.backupManifest),
    'Exact execution opt-in and backup required',
  );
  const command =
    request.command === APPROVED_COMMANDS[0]
      ? new AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand()
      : new AddInconnectMessagingAutomationPrincipalFastInstanceCommand();
  const metadata = getRegisteredInstanceCommandMetadata(command.constructor);

  requireCondition(
    metadata?.type === 'fast' &&
      `${metadata.version}_${command.constructor.name}_${metadata.timestamp}` ===
        request.command,
    'Runtime decorator identity differs from the approved registration',
  );
  return runner.runFastInstanceCommand({
    command,
    name: request.command,
    connectionVerification:
      createSessionConnectionVerification(expectedIdentity),
  });
};
