import { Injectable } from '@nestjs/common';

import { DataSource, type EntityManager } from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';

@Injectable()
export class InconnectMessagingAutomationRecordAccessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordAccessConfigurationService: InconnectRecordAccessConfigurationService,
  ) {}

  async validatePolicy({
    configuration,
    expectedRoleId,
    lock,
    manager,
    queryRunner,
    coreQueryBuilderService,
    workspaceId,
  }: {
    configuration: InconnectMessagingConfigurationEntity;
    expectedRoleId: string;
    lock: boolean;
    manager?: EntityManager;
    queryRunner?: WorkspaceQueryRunner;
    coreQueryBuilderService?: WorkspaceQueryRunnerCoreQueryBuilderService;
    workspaceId: string;
  }): Promise<boolean> {
    const createCoreQueryBuilder = <TEntity extends object>(
      target: new () => TEntity,
      alias: string,
    ) => {
      if (manager !== undefined) {
        return manager.getRepository(target).createQueryBuilder(alias);
      }

      if (queryRunner === undefined || coreQueryBuilderService === undefined) {
        throw new Error('Core query context is required');
      }

      return coreQueryBuilderService.createCoreQueryBuilder({
        queryRunner,
        target,
        alias,
      });
    };
    const recordAccessConfigurationQuery = createCoreQueryBuilder(
      InconnectRecordAccessConfigurationEntity,
      'recordAccessConfiguration',
    ).where('recordAccessConfiguration.workspaceId = :workspaceId', {
      workspaceId,
    });
    const managedObjectQuery = createCoreQueryBuilder(
      InconnectRecordAccessManagedObjectEntity,
      'managedObject',
    )
      .where('managedObject.workspaceId = :workspaceId', { workspaceId })
      .andWhere('managedObject.objectMetadataId = :objectMetadataId', {
        objectMetadataId: configuration.anchorObjectMetadataId,
      });
    const policiesQuery = createCoreQueryBuilder(
      InconnectRecordAccessPolicyEntity,
      'policy',
    )
      .where('policy.workspaceId = :workspaceId', { workspaceId })
      .andWhere('policy.roleId = :roleId', { roleId: expectedRoleId });

    if (lock) {
      recordAccessConfigurationQuery.setLock('pessimistic_read');
      managedObjectQuery.setLock('pessimistic_read');
      policiesQuery.setLock('pessimistic_read');
    }

    const [recordAccessConfiguration, managedObjects, policies] =
      await Promise.all([
        recordAccessConfigurationQuery.getOne(),
        managedObjectQuery.getMany(),
        policiesQuery.getMany(),
      ]);

    return (
      recordAccessConfiguration?.enforcementMode === 'MANAGED' &&
      managedObjects.length === 1 &&
      managedObjects[0].ownerRequirement === 'required' &&
      policies.length === 1 &&
      policies[0].managedObjectId === managedObjects[0].id &&
      policies[0].principalType === 'WORKSPACE_MEMBER' &&
      policies[0].recordEffect === 'ownRecords' &&
      policies[0].createPolicy === 'standardPermissionsOnly' &&
      policies[0].ownerTransferPolicy === 'denied' &&
      policies[0].missingOwnerPolicy === 'requireExplicit' &&
      policies[0].defaultOwnerRoleId === null
    );
  }

  async reconcilePolicy({
    roleId,
    workspaceId,
  }: {
    roleId: string;
    workspaceId: string;
  }): Promise<void> {
    const configuration = await this.dataSource
      .getRepository(InconnectRecordAccessConfigurationEntity)
      .findOne({ where: { workspaceId } });
    const managedObjects = await this.dataSource
      .getRepository(InconnectRecordAccessManagedObjectEntity)
      .find({ where: { workspaceId } });
    const policies = await this.dataSource
      .getRepository(InconnectRecordAccessPolicyEntity)
      .find({ where: { workspaceId } });
    const messagingConfiguration = await this.dataSource
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (
      configuration?.enforcementMode !== 'MANAGED' ||
      messagingConfiguration === null
    ) {
      throw new Error('Managed INCONNECT Record Access is required');
    }

    const anchorManagedObjects = managedObjects.filter(
      ({ objectMetadataId }) =>
        objectMetadataId === messagingConfiguration.anchorObjectMetadataId,
    );

    if (
      anchorManagedObjects.length !== 1 ||
      anchorManagedObjects[0].ownerRequirement !== 'required'
    ) {
      throw new Error(
        'The Messaging anchor must be a required-owner managed object',
      );
    }

    const expectedPolicy = {
      objectMetadataId: messagingConfiguration.anchorObjectMetadataId,
      roleId,
      recordEffect: 'ownRecords' as const,
      createPolicy: 'standardPermissionsOnly' as const,
      ownerTransferPolicy: 'denied' as const,
      missingOwnerPolicy: 'requireExplicit' as const,
    };
    const automationPolicies = policies.filter(
      (policy) => policy.roleId === roleId,
    );
    const policyIsAlreadyExact =
      automationPolicies.length === 1 &&
      automationPolicies[0].managedObjectId === anchorManagedObjects[0].id &&
      automationPolicies[0].principalType === 'WORKSPACE_MEMBER' &&
      automationPolicies[0].recordEffect === expectedPolicy.recordEffect &&
      automationPolicies[0].createPolicy === expectedPolicy.createPolicy &&
      automationPolicies[0].ownerTransferPolicy ===
        expectedPolicy.ownerTransferPolicy &&
      automationPolicies[0].missingOwnerPolicy ===
        expectedPolicy.missingOwnerPolicy &&
      automationPolicies[0].defaultOwnerRoleId === null;

    if (policyIsAlreadyExact) {
      return;
    }

    const result =
      await this.recordAccessConfigurationService.replaceConfiguration({
        workspaceId,
        expectedRevision: configuration.revision,
        enforcementMode: configuration.enforcementMode,
        managedObjects: managedObjects.map((managedObject) => ({
          objectMetadataId: managedObject.objectMetadataId,
          ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
          ownerRequirement: managedObject.ownerRequirement,
        })),
        policies: [
          ...policies
            .filter((policy) => policy.roleId !== roleId)
            .map((policy) => {
              const managedObject = managedObjects.find(
                ({ id }) => id === policy.managedObjectId,
              );

              if (managedObject === undefined) {
                throw new Error('Record Access policy has no managed object');
              }

              return {
                objectMetadataId: managedObject.objectMetadataId,
                roleId: policy.roleId,
                recordEffect: policy.recordEffect,
                createPolicy: policy.createPolicy,
                ownerTransferPolicy: policy.ownerTransferPolicy,
                missingOwnerPolicy: policy.missingOwnerPolicy,
                ...(policy.defaultOwnerRoleId === null
                  ? {}
                  : { defaultOwnerRoleId: policy.defaultOwnerRoleId }),
              };
            }),
          expectedPolicy,
        ],
      });

    if (result.cacheStatus !== 'recomputed') {
      throw new Error(
        'Record Access policy persisted but its security cache did not recompute',
      );
    }
  }
}
