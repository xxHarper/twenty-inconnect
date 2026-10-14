import { type InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';

import { createSessionConnectionVerification } from 'src/database/scripts/inconnect-exact-upgrade/connection-identity';
import {
  APPROVED_COMMANDS,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { requirePhysicalExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/isolation';
import {
  type PhysicalSnapshot,
  preparePhysicalStep,
  validatePhysicalStage,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/step-plan';
import { validateTargetContract } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

// Test-only staged adapter. Every entry rejects before loading commands. A future
// PG1 supervisor must supply freshly inspected PRE and POST state on verified
// sessions. This adapter never implements transaction or tracking persistence.
export const runPhysicalRegisteredStep = async (
  input: unknown,
  commandIdentity: unknown,
  runner: Pick<InstanceCommandRunnerService, 'runFastInstanceCommand'>,
  inspect: () => Promise<PhysicalSnapshot>,
): Promise<void> => {
  requirePhysicalExecutionSafety();
  const contract = validateTargetContract(input);
  const step = preparePhysicalStep(commandIdentity, await inspect());
  const { getRegisteredInstanceCommandMetadata } =
    await import('src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator');
  const command =
    step.command === APPROVED_COMMANDS[0]
      ? new (
          await import('src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305698-add-inconnect-messaging-auto-create-configuration')
        ).AddInconnectMessagingAutoCreateConfigurationFastInstanceCommand()
      : new (
          await import('src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790793305700-add-inconnect-messaging-automation-principal')
        ).AddInconnectMessagingAutomationPrincipalFastInstanceCommand();
  const metadata = getRegisteredInstanceCommandMetadata(command.constructor);
  requireCondition(
    metadata?.type === 'fast' &&
      `${metadata.version}_${command.constructor.name}_${metadata.timestamp}` ===
        step.command,
    'Registered command identity differs',
  );
  const result = await runner.runFastInstanceCommand({
    command,
    name: step.command,
    connectionVerification: createSessionConnectionVerification(
      contract.expected,
    ),
  });
  if (result.status === 'failed') throw result.error;
  requireCondition(
    result.status === 'success',
    'Unexpected already-executed command',
  );
  // POST failure after acknowledged COMMIT is a verification failure, never a
  // claim that the runner rolled back. No automatic next command or retry.
  validatePhysicalStage(step.afterStage, await inspect());
};
