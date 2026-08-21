import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { type InconnectRecordAccessPrincipalType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import {
  type ReplaceInconnectRecordAccessConfigurationArgs,
  type ReplaceInconnectRecordAccessConfigurationResult,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import {
  incrementInconnectRecordAccessRevision,
  isInconnectRecordAccessRevision,
} from 'src/engine/core-modules/inconnect-record-access/utils/increment-inconnect-record-access-revision.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  type WorkspaceCacheGenerations,
  WorkspaceCacheService,
} from 'src/engine/workspace-cache/services/workspace-cache.service';

const POLICY_CACHE_KEY = 'inconnectRecordAccessPolicyMaps' as const;

type TransactionResult = {
  revision: string;
  changedFromManagedToUnmanaged: boolean;
};

@Injectable()
export class InconnectRecordAccessConfigurationService {
  private readonly logger = new Logger(
    InconnectRecordAccessConfigurationService.name,
  );

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly candidateService: InconnectRecordAccessConfigurationCandidateService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async getCurrentRevision(workspaceId: string): Promise<string | null> {
    const configuration = await this.dataSource
      .getRepository(InconnectRecordAccessConfigurationEntity)
      .findOne({ where: { workspaceId } });

    return configuration?.revision ?? null;
  }

  async replaceConfiguration({
    workspaceId,
    expectedRevision,
    enforcementMode,
    managedObjects,
    policies,
  }: ReplaceInconnectRecordAccessConfigurationArgs): Promise<ReplaceInconnectRecordAccessConfigurationResult> {
    let generations: WorkspaceCacheGenerations = {};
    let transactionResult: TransactionResult;

    try {
      transactionResult = await this.dataSource.transaction(async (manager) => {
        await this.lockWorkspaceOrThrow(manager, workspaceId);

        const configuration = await manager
          .getRepository(InconnectRecordAccessConfigurationEntity)
          .findOne({
            where: { workspaceId },
            lock: { mode: 'pessimistic_write' },
          });

        this.assertExpectedRevision({
          expectedRevision,
          currentRevision: configuration?.revision ?? null,
        });

        const revision = configuration
          ? incrementInconnectRecordAccessRevision(configuration.revision)
          : '1';

        if (!revision) {
          throw new InconnectRecordAccessConfigurationException(
            'INCONNECT configuration revision cannot be incremented',
            InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
          );
        }

        const input = { enforcementMode, managedObjects, policies };
        const previousEnforcementMode = configuration?.enforcementMode;
        const candidate = await this.candidateService.buildValidatedCandidate({
          manager,
          workspaceId,
          revision,
          input,
        });

        generations =
          await this.workspaceCacheService.revokeGenerationFencedEntries(
            workspaceId,
            [POLICY_CACHE_KEY],
            'INCONNECT Record Access configuration publish is awaiting commit',
          );

        await manager
          .getRepository(InconnectRecordAccessPolicyEntity)
          .delete({ workspaceId });
        await manager
          .getRepository(InconnectRecordAccessManagedObjectEntity)
          .delete({ workspaceId });

        const configurationRepository = manager.getRepository(
          InconnectRecordAccessConfigurationEntity,
        );

        if (configuration) {
          configuration.enforcementMode = enforcementMode;
          configuration.revision = revision;
          await configurationRepository.save(configuration);
        } else {
          await configurationRepository.save({
            workspaceId,
            enforcementMode,
            revision,
          });
        }

        if (candidate.managedObjects.length > 0) {
          await manager
            .getRepository(InconnectRecordAccessManagedObjectEntity)
            .save(
              candidate.managedObjects.map((managedObject) => ({
                ...managedObject,
                ownerRequirement:
                  managedObject.ownerRequirement as InconnectRecordAccessOwnerRequirement,
              })),
            );
        }

        if (candidate.policies.length > 0) {
          await manager.getRepository(InconnectRecordAccessPolicyEntity).save(
            candidate.policies.map((policy) => ({
              ...policy,
              principalType:
                policy.principalType as InconnectRecordAccessPrincipalType,
              recordEffect:
                policy.recordEffect as InconnectRecordAccessRecordEffect,
              createPolicy:
                policy.createPolicy as InconnectRecordAccessCreatePolicy,
              ownerTransferPolicy:
                policy.ownerTransferPolicy as InconnectRecordAccessOwnerTransferPolicy,
              missingOwnerPolicy:
                policy.missingOwnerPolicy as InconnectRecordAccessMissingOwnerPolicy,
            })),
          );
        }

        return {
          revision,
          changedFromManagedToUnmanaged:
            previousEnforcementMode === 'MANAGED' &&
            enforcementMode === 'UNMANAGED',
        };
      });
    } catch (error) {
      await this.recoverRevokedCacheAfterRollback({
        workspaceId,
        generations,
      });

      throw error;
    }

    let cacheStatus: ReplaceInconnectRecordAccessConfigurationResult['cacheStatus'] =
      'recomputed';

    try {
      await this.workspaceCacheService.recomputeGenerationFencedEntries(
        workspaceId,
        generations,
      );
    } catch (error) {
      cacheStatus = 'recomputation-failed';
      this.logger.error(
        `INCONNECT policy cache recomputation failed after committed publish for workspace ${workspaceId}`,
        error,
      );
    }

    return {
      ...transactionResult,
      cacheStatus,
    };
  }

  private async lockWorkspaceOrThrow(
    manager: EntityManager,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await manager.getRepository(WorkspaceEntity).findOne({
      where: { id: workspaceId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (!workspace) {
      throw new InconnectRecordAccessConfigurationException(
        'Workspace does not exist',
        InconnectRecordAccessConfigurationExceptionCode.NOT_FOUND,
      );
    }
  }

  private assertExpectedRevision({
    expectedRevision,
    currentRevision,
  }: {
    expectedRevision: string | null;
    currentRevision: string | null;
  }): void {
    if (
      expectedRevision !== null &&
      !isInconnectRecordAccessRevision(expectedRevision)
    ) {
      throw new InconnectRecordAccessConfigurationException(
        'Expected revision must be a PostgreSQL bigint string or null',
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      );
    }

    if (expectedRevision !== currentRevision) {
      throw new InconnectRecordAccessConfigurationException(
        `INCONNECT configuration revision conflict: expected ${expectedRevision ?? 'absent'}, current ${currentRevision ?? 'absent'}`,
        InconnectRecordAccessConfigurationExceptionCode.REVISION_CONFLICT,
      );
    }
  }

  private async recoverRevokedCacheAfterRollback({
    workspaceId,
    generations,
  }: {
    workspaceId: string;
    generations: WorkspaceCacheGenerations;
  }): Promise<void> {
    if (Object.keys(generations).length === 0) {
      return;
    }

    try {
      await this.workspaceCacheService.recomputeGenerationFencedEntries(
        workspaceId,
        generations,
      );
    } catch (error) {
      this.logger.error(
        `INCONNECT policy cache recovery failed after rolled-back publish for workspace ${workspaceId}`,
        error,
      );
    }
  }
}
