import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull } from 'typeorm';

import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import { InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { type InconnectRecordAccessConfigurationSetInput } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import {
  type InconnectRecordAccessEnvironmentImportPlan,
  type InconnectRecordAccessEnvironmentImportResult,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-environment-import.type';
import { incrementInconnectRecordAccessRevision } from 'src/engine/core-modules/inconnect-record-access/utils/increment-inconnect-record-access-revision.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

const buildFlatMaps = (
  entities: Array<{ id: string; universalIdentifier: string }>,
) => ({
  byUniversalIdentifier: Object.fromEntries(
    entities.map((entity) => [entity.universalIdentifier, entity]),
  ),
  universalIdentifierById: Object.fromEntries(
    entities.map((entity) => [entity.id, entity.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
});

@Injectable()
export class InconnectRecordAccessEnvironmentImportService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly envPolicyService: InconnectRecordAccessService,
    private readonly candidateService: InconnectRecordAccessConfigurationCandidateService,
    private readonly configurationService: InconnectRecordAccessConfigurationService,
  ) {}

  async prepareEnvironmentImport(
    workspaceId: string,
  ): Promise<InconnectRecordAccessEnvironmentImportPlan> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      const workspace = await manager.getRepository(WorkspaceEntity).findOne({
        where: { id: workspaceId, deletedAt: IsNull() },
      });

      if (!workspace) {
        throw new InconnectRecordAccessConfigurationException(
          'Workspace does not exist',
          InconnectRecordAccessConfigurationExceptionCode.NOT_FOUND,
        );
      }

      const roles = await manager
        .getRepository(RoleEntity)
        .find({ where: { workspaceId } });
      const objects = await manager
        .getRepository(ObjectMetadataEntity)
        .find({ where: { workspaceId } });
      const fields = await manager
        .getRepository(FieldMetadataEntity)
        .find({ where: { workspaceId } });
      const configuration = await manager
        .getRepository(InconnectRecordAccessConfigurationEntity)
        .findOne({ where: { workspaceId } });
      const flatRoleMaps = buildFlatMaps(
        roles,
      ) as unknown as FlatEntityMaps<FlatRole>;
      const flatObjectMetadataMaps = buildFlatMaps(
        objects,
      ) as unknown as FlatEntityMaps<FlatObjectMetadata>;
      const flatFieldMetadataMaps = buildFlatMaps(
        fields,
      ) as unknown as FlatEntityMaps<FlatFieldMetadata>;
      const policy = this.envPolicyService.resolveWorkspacePolicy({
        workspaceId,
        flatRoleMaps,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
      });

      if (policy.status !== 'configured') {
        throw new InconnectRecordAccessConfigurationException(
          policy.status === 'invalid'
            ? policy.reason
            : 'INCONNECT ENV has no managed configuration for this workspace',
          InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
        );
      }

      const input: InconnectRecordAccessConfigurationSetInput = {
        enforcementMode: 'MANAGED',
        managedObjects: policy.managedObjectMetadataIds.map(
          (objectMetadataId) => {
            const objectRule = policy.rules.find(
              (rule) => rule.objectMetadataId === objectMetadataId,
            );

            if (!objectRule) {
              throw new InconnectRecordAccessConfigurationException(
                `Managed Object ${objectMetadataId} has no ENV rule`,
                InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
              );
            }

            return {
              objectMetadataId,
              ownerFieldMetadataId: objectRule.ownerFieldMetadataId,
              ownerRequirement: objectRule.ownerRequirement,
            };
          },
        ),
        policies: policy.rules.map((rule) => ({
          objectMetadataId: rule.objectMetadataId,
          roleId: rule.roleId,
          recordEffect: rule.recordEffect,
          createPolicy: rule.createPolicy,
          ownerTransferPolicy: rule.ownerTransferPolicy,
          missingOwnerPolicy: rule.missingOwnerPolicy,
          ...(rule.defaultOwnerRoleId
            ? { defaultOwnerRoleId: rule.defaultOwnerRoleId }
            : {}),
        })),
      };
      const publishRevision = configuration
        ? incrementInconnectRecordAccessRevision(configuration.revision)
        : '1';

      if (!publishRevision) {
        throw new InconnectRecordAccessConfigurationException(
          'INCONNECT configuration revision cannot be incremented',
          InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
        );
      }

      await this.candidateService.buildValidatedCandidate({
        manager,
        workspaceId,
        revision: publishRevision,
        input,
      });

      const objectsById = new Map(objects.map((object) => [object.id, object]));
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      const rolesById = new Map(roles.map((role) => [role.id, role]));

      return {
        workspaceId,
        workspaceDisplayName: workspace.displayName ?? null,
        enforcementMode: 'MANAGED',
        currentRevision: configuration?.revision ?? null,
        publishRevision,
        managedObjectCount: input.managedObjects.length,
        policyCount: input.policies.length,
        validationStatus: 'valid',
        managedObjects: input.managedObjects.map((managedObject) => {
          const object = objectsById.get(managedObject.objectMetadataId);
          const ownerField = fieldsById.get(managedObject.ownerFieldMetadataId);

          return {
            objectLabel:
              object?.labelSingular ?? object?.nameSingular ?? 'Unknown',
            objectMetadataId: managedObject.objectMetadataId,
            ownerFieldLabel: ownerField?.label ?? ownerField?.name ?? 'Unknown',
            ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
            ownerRequirement: managedObject.ownerRequirement,
          };
        }),
        policies: input.policies.map((policyInput) => {
          const object = objectsById.get(policyInput.objectMetadataId);
          const role = rolesById.get(policyInput.roleId);
          const defaultOwnerRole = policyInput.defaultOwnerRoleId
            ? rolesById.get(policyInput.defaultOwnerRoleId)
            : undefined;

          return {
            objectLabel:
              object?.labelSingular ?? object?.nameSingular ?? 'Unknown',
            roleLabel: role?.label ?? 'Unknown',
            roleId: policyInput.roleId,
            recordEffect: policyInput.recordEffect,
            createPolicy: policyInput.createPolicy,
            ownerTransferPolicy: policyInput.ownerTransferPolicy,
            missingOwnerPolicy: policyInput.missingOwnerPolicy,
            ...(policyInput.defaultOwnerRoleId
              ? {
                  defaultOwnerRoleId: policyInput.defaultOwnerRoleId,
                  defaultOwnerRoleLabel: defaultOwnerRole?.label ?? 'Unknown',
                }
              : {}),
          };
        }),
        input,
      };
    });
  }

  async importEnvironment({
    workspaceId,
    dryRun,
  }: {
    workspaceId: string;
    dryRun: boolean;
  }): Promise<InconnectRecordAccessEnvironmentImportResult> {
    const plan = await this.prepareEnvironmentImport(workspaceId);

    if (dryRun) {
      return { plan, published: false };
    }

    if (plan.currentRevision !== null) {
      throw new InconnectRecordAccessConfigurationException(
        `INCONNECT DB configuration already exists at revision ${plan.currentRevision}`,
        InconnectRecordAccessConfigurationExceptionCode.REVISION_CONFLICT,
      );
    }

    const result = await this.configurationService.replaceConfiguration({
      workspaceId,
      expectedRevision: null,
      ...plan.input,
    });

    return {
      plan,
      published: {
        revision: result.revision,
        cacheStatus: result.cacheStatus,
      },
    };
  }
}
