import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { type ReplaceInconnectRecordAccessConfigurationResult } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import {
  type InconnectRecordAccessSettingsAvailableMetadata,
  type InconnectRecordAccessSettingsConfiguration,
  type ReplaceInconnectRecordAccessSettingsConfigurationInput,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-settings.type';
import { validateInconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-persisted-candidate.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

@Injectable()
export class InconnectRecordAccessSettingsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configurationService: InconnectRecordAccessConfigurationService,
  ) {}

  async getConfiguration(
    workspaceId: string,
  ): Promise<InconnectRecordAccessSettingsConfiguration> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      const configuration = await manager
        .getRepository(InconnectRecordAccessConfigurationEntity)
        .findOne({ where: { workspaceId } });

      if (!configuration) {
        return {
          status: 'ABSENT',
          enforcementMode: null,
          revision: null,
          managedObjects: [],
        };
      }

      const managedObjects = await manager
        .getRepository(InconnectRecordAccessManagedObjectEntity)
        .find({
          where: { workspaceId },
          relations: {
            objectMetadata: true,
            ownerFieldMetadata: {
              relationTargetObjectMetadata: true,
            },
          },
          order: { objectMetadataId: 'ASC' },
        });
      const policies = await manager
        .getRepository(InconnectRecordAccessPolicyEntity)
        .find({
          where: { workspaceId },
          relations: {
            role: true,
            defaultOwnerRole: true,
          },
          order: {
            managedObjectId: 'ASC',
            roleId: 'ASC',
          },
        });

      this.assertPersistedSetIsValid({
        configuration,
        managedObjects,
        policies,
      });

      const policiesByManagedObjectId = new Map<
        string,
        InconnectRecordAccessPolicyEntity[]
      >();

      for (const policy of policies) {
        const existingPolicies =
          policiesByManagedObjectId.get(policy.managedObjectId) ?? [];

        existingPolicies.push(policy);
        policiesByManagedObjectId.set(policy.managedObjectId, existingPolicies);
      }

      return {
        status: configuration.enforcementMode,
        enforcementMode: configuration.enforcementMode,
        revision: configuration.revision,
        managedObjects: managedObjects.map((managedObject) => ({
          id: managedObject.id,
          objectMetadataId: managedObject.objectMetadataId,
          objectUniversalIdentifier:
            managedObject.objectMetadata.universalIdentifier,
          objectNameSingular: managedObject.objectMetadata.nameSingular,
          objectLabelSingular: managedObject.objectMetadata.labelSingular,
          ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
          ownerFieldUniversalIdentifier:
            managedObject.ownerFieldMetadata.universalIdentifier,
          ownerFieldName: managedObject.ownerFieldMetadata.name,
          ownerFieldLabel: managedObject.ownerFieldMetadata.label,
          ownerRequirement: managedObject.ownerRequirement,
          policies: (policiesByManagedObjectId.get(managedObject.id) ?? []).map(
            (policy) => ({
              id: policy.id,
              roleId: policy.roleId,
              roleLabel: policy.role.label,
              roleUniversalIdentifier: policy.role.universalIdentifier,
              principalType: policy.principalType,
              recordEffect: policy.recordEffect,
              createPolicy: policy.createPolicy,
              ownerTransferPolicy: policy.ownerTransferPolicy,
              missingOwnerPolicy: policy.missingOwnerPolicy,
              defaultOwnerRoleId: policy.defaultOwnerRoleId,
              defaultOwnerRoleLabel: policy.defaultOwnerRole?.label ?? null,
            }),
          ),
        })),
      };
    });
  }

  async getAvailableMetadata(
    workspaceId: string,
  ): Promise<InconnectRecordAccessSettingsAvailableMetadata> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      const objects = await manager.getRepository(ObjectMetadataEntity).find({
        where: { workspaceId, isActive: true },
      });
      const fields = await manager.getRepository(FieldMetadataEntity).find({
        where: {
          workspaceId,
          isActive: true,
          type: FieldMetadataType.RELATION,
        },
      });
      const roles = await manager.getRepository(RoleEntity).find({
        where: { workspaceId },
      });
      const activeObjectsById = new Map(
        objects.map((objectMetadata) => [objectMetadata.id, objectMetadata]),
      );
      const ownerFieldsByObjectMetadataId = new Map<
        string,
        InconnectRecordAccessSettingsAvailableMetadata['objects'][number]['ownerFields']
      >();

      for (const fieldMetadata of fields) {
        const objectMetadata = activeObjectsById.get(
          fieldMetadata.objectMetadataId,
        );
        const targetObjectMetadata =
          fieldMetadata.relationTargetObjectMetadataId
            ? activeObjectsById.get(
                fieldMetadata.relationTargetObjectMetadataId,
              )
            : undefined;

        if (
          !objectMetadata ||
          !targetObjectMetadata ||
          targetObjectMetadata.universalIdentifier !==
            STANDARD_OBJECTS.workspaceMember.universalIdentifier ||
          (fieldMetadata.settings as { relationType?: RelationType } | null)
            ?.relationType !== RelationType.MANY_TO_ONE
        ) {
          continue;
        }

        let joinColumnName: string;

        try {
          joinColumnName = computeMorphOrRelationFieldJoinColumnName({
            name: fieldMetadata.name,
          });
        } catch {
          continue;
        }

        const candidates =
          ownerFieldsByObjectMetadataId.get(objectMetadata.id) ?? [];

        candidates.push({
          fieldMetadataId: fieldMetadata.id,
          universalIdentifier: fieldMetadata.universalIdentifier,
          name: fieldMetadata.name,
          label: fieldMetadata.label,
          isActive: fieldMetadata.isActive,
          joinColumnName,
        });
        ownerFieldsByObjectMetadataId.set(objectMetadata.id, candidates);
      }

      return {
        objects: objects
          .flatMap((objectMetadata) => {
            const ownerFields =
              ownerFieldsByObjectMetadataId.get(objectMetadata.id) ?? [];

            if (ownerFields.length === 0) {
              return [];
            }

            return [
              {
                objectMetadataId: objectMetadata.id,
                universalIdentifier: objectMetadata.universalIdentifier,
                nameSingular: objectMetadata.nameSingular,
                namePlural: objectMetadata.namePlural,
                labelSingular: objectMetadata.labelSingular,
                labelPlural: objectMetadata.labelPlural,
                isActive: objectMetadata.isActive,
                ownerFields: [...ownerFields].sort((left, right) =>
                  left.label.localeCompare(right.label),
                ),
              },
            ];
          })
          .sort((left, right) =>
            left.labelSingular.localeCompare(right.labelSingular),
          ),
        roles: roles
          .map((role) => ({
            roleId: role.id,
            universalIdentifier: role.universalIdentifier,
            label: role.label,
          }))
          .sort((left, right) => left.label.localeCompare(right.label)),
      };
    });
  }

  async replaceConfiguration({
    workspaceId,
    input,
  }: {
    workspaceId: string;
    input: ReplaceInconnectRecordAccessSettingsConfigurationInput;
  }): Promise<ReplaceInconnectRecordAccessConfigurationResult> {
    if (
      input.policies.some(
        (policy) => policy.principalType !== 'WORKSPACE_MEMBER',
      )
    ) {
      throw new InconnectRecordAccessConfigurationException(
        'Only WORKSPACE_MEMBER principals are currently supported',
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      );
    }

    return this.configurationService.replaceConfiguration({
      workspaceId,
      expectedRevision: input.expectedRevision,
      enforcementMode: input.enforcementMode,
      managedObjects: input.managedObjects,
      policies: input.policies.map(
        ({ principalType: _principalType, ...policy }) => ({
          ...policy,
          defaultOwnerRoleId: policy.defaultOwnerRoleId ?? undefined,
        }),
      ),
    });
  }

  private assertPersistedSetIsValid({
    configuration,
    managedObjects,
    policies,
  }: {
    configuration: InconnectRecordAccessConfigurationEntity;
    managedObjects: InconnectRecordAccessManagedObjectEntity[];
    policies: InconnectRecordAccessPolicyEntity[];
  }): void {
    const roles = new Map<string, RoleEntity>();
    const objects = new Map<string, ObjectMetadataEntity>();
    const fields = new Map<string, FieldMetadataEntity>();

    for (const managedObject of managedObjects) {
      objects.set(
        managedObject.objectMetadata.id,
        managedObject.objectMetadata,
      );
      const ownerField = managedObject.ownerFieldMetadata;

      fields.set(ownerField.id, ownerField);

      if (ownerField.relationTargetObjectMetadata) {
        objects.set(
          ownerField.relationTargetObjectMetadata.id,
          ownerField.relationTargetObjectMetadata,
        );
      }
    }

    for (const policy of policies) {
      roles.set(policy.role.id, policy.role);

      if (policy.defaultOwnerRole) {
        roles.set(policy.defaultOwnerRole.id, policy.defaultOwnerRole);
      }
    }

    const candidate: InconnectRecordAccessPersistedCandidate = {
      configuration: {
        workspaceId: configuration.workspaceId,
        enforcementMode: configuration.enforcementMode,
        revision: configuration.revision,
      },
      managedObjects: managedObjects.map((managedObject) => ({
        id: managedObject.id,
        workspaceId: managedObject.workspaceId,
        objectMetadataId: managedObject.objectMetadataId,
        ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
        ownerRequirement: managedObject.ownerRequirement,
      })),
      policies: policies.map((policy) => ({
        id: policy.id,
        workspaceId: policy.workspaceId,
        managedObjectId: policy.managedObjectId,
        roleId: policy.roleId,
        principalType: policy.principalType,
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId,
      })),
      roles: [...roles.values()].map((role) => ({
        id: role.id,
        workspaceId: role.workspaceId,
      })),
      objects: [...objects.values()].map((objectMetadata) => ({
        id: objectMetadata.id,
        workspaceId: objectMetadata.workspaceId,
        universalIdentifier: objectMetadata.universalIdentifier,
        isActive: objectMetadata.isActive,
      })),
      fields: [...fields.values()].map((fieldMetadata) => ({
        id: fieldMetadata.id,
        workspaceId: fieldMetadata.workspaceId,
        objectMetadataId: fieldMetadata.objectMetadataId,
        name: fieldMetadata.name,
        type: fieldMetadata.type,
        isActive: fieldMetadata.isActive,
        relationTargetObjectMetadataId:
          fieldMetadata.relationTargetObjectMetadataId,
        settings:
          fieldMetadata.settings as InconnectRecordAccessPersistedCandidate['fields'][number]['settings'],
      })),
    };
    const validation =
      validateInconnectRecordAccessPersistedCandidate(candidate);

    if (!validation.valid) {
      throw new InconnectRecordAccessConfigurationException(
        'Persisted INCONNECT Record Access configuration is invalid',
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      );
    }
  }
}
