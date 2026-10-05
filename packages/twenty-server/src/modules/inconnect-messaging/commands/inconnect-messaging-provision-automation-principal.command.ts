import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';
import { isValidUuid } from 'twenty-shared/utils';

import { InconnectMessagingAutomationPrincipalProvisioningService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal-provisioning.service';

type ProvisionAutomationPrincipalCommandOptions = {
  workspaceId?: string;
};

@Command({
  name: 'inconnect:messaging:provision-automation-principal',
  description:
    'Idempotently provision the reserved INCONNECT Messaging automation principal for one workspace',
})
export class InconnectMessagingProvisionAutomationPrincipalCommand extends CommandRunner {
  private readonly logger = new Logger(
    InconnectMessagingProvisionAutomationPrincipalCommand.name,
  );

  constructor(
    private readonly provisioningService: InconnectMessagingAutomationPrincipalProvisioningService,
  ) {
    super();
  }

  override async run(
    _passedParams: string[],
    options: ProvisionAutomationPrincipalCommandOptions,
  ): Promise<void> {
    if (!options.workspaceId || !isValidUuid(options.workspaceId)) {
      throw new Error('--workspace-id must be a valid UUID');
    }

    await this.provisioningService.provision({
      workspaceId: options.workspaceId,
    });
    this.logger.log(
      'INCONNECT Messaging automation principal is provisioned and ready for validation',
    );
  }

  @Option({
    flags: '--workspace-id <uuid>',
    description: 'Workspace UUID to provision explicitly',
    required: true,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }
}
