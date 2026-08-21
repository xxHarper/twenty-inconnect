import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';
import { isValidUuid } from 'twenty-shared/utils';

import { InconnectRecordAccessEnvironmentImportService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-environment-import.service';
import { type InconnectRecordAccessEnvironmentImportPlan } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-environment-import.type';

type InconnectRecordAccessImportEnvCommandOptions = {
  workspaceId?: string;
  dryRun?: boolean;
};

@Command({
  name: 'inconnect:record-access:import-env',
  description:
    'Validate or initially publish one workspace INCONNECT ENV policy into PostgreSQL',
})
export class InconnectRecordAccessImportEnvCommand extends CommandRunner {
  private readonly logger = new Logger(
    InconnectRecordAccessImportEnvCommand.name,
  );

  constructor(
    private readonly environmentImportService: InconnectRecordAccessEnvironmentImportService,
  ) {
    super();
  }

  override async run(
    _passedParams: string[],
    options: InconnectRecordAccessImportEnvCommandOptions,
  ): Promise<void> {
    const workspaceId = options.workspaceId;

    if (!workspaceId || !isValidUuid(workspaceId)) {
      throw new Error('--workspace-id must be a valid UUID');
    }

    const result = await this.environmentImportService.importEnvironment({
      workspaceId,
      dryRun: options.dryRun === true,
    });

    this.logPlan(result.plan);

    if (result.published === false) {
      this.logger.log('Dry-run complete: PostgreSQL was not modified');

      return;
    }

    this.logger.log(
      `Published revision ${result.published.revision}; cache status: ${result.published.cacheStatus}`,
    );
  }

  @Option({
    flags: '--workspace-id <uuid>',
    description: 'Workspace UUID whose ENV block will be imported',
    required: true,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '--dry-run',
    description: 'Resolve and validate without writing PostgreSQL or cache',
  })
  parseDryRun(): boolean {
    return true;
  }

  private logPlan(plan: InconnectRecordAccessEnvironmentImportPlan): void {
    this.logger.log(
      `Workspace: ${plan.workspaceDisplayName ?? 'Unnamed'} (${plan.workspaceId})`,
    );
    this.logger.log(
      `Enforcement: ${plan.enforcementMode}; current revision: ${plan.currentRevision ?? 'absent'}; publish revision: ${plan.publishRevision}`,
    );
    this.logger.log(
      `Validation: ${plan.validationStatus}; Managed Objects: ${plan.managedObjectCount}; Policies: ${plan.policyCount}`,
    );

    for (const managedObject of plan.managedObjects) {
      this.logger.log(
        `Object ${managedObject.objectLabel} (${managedObject.objectMetadataId}); owner ${managedObject.ownerFieldLabel} (${managedObject.ownerFieldMetadataId}); requirement ${managedObject.ownerRequirement}`,
      );
    }

    for (const policy of plan.policies) {
      this.logger.log(
        `Policy ${policy.objectLabel} / ${policy.roleLabel} (${policy.roleId}): records=${policy.recordEffect}, create=${policy.createPolicy}, transfer=${policy.ownerTransferPolicy}, missingOwner=${policy.missingOwnerPolicy}${policy.defaultOwnerRoleId ? `, defaultRole=${policy.defaultOwnerRoleLabel} (${policy.defaultOwnerRoleId})` : ''}`,
      );
    }
  }
}
