import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In } from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import {
  invalidInconnectRecordAccessPolicyMaps,
  parseInconnectRecordAccessPolicyMaps,
} from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-record-access-policy-maps.util';
import { validateInconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-persisted-candidate.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { WorkspaceCache } from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';

@Injectable()
@WorkspaceCache('inconnectRecordAccessPolicyMaps', {
  generationFenced: true,
  strictSharedCache: true,
})
export class WorkspaceInconnectRecordAccessPolicyMapsCacheService extends WorkspaceCacheProvider<InconnectRecordAccessPolicyMaps> {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async computeForCache(
    workspaceId: string,
  ): Promise<InconnectRecordAccessPolicyMaps> {
    return this.dataSource.transaction(
      'REPEATABLE READ',
      async (transactionManager) => {
        await transactionManager.query('SET TRANSACTION READ ONLY');

        const configuration = await transactionManager
          .getRepository(InconnectRecordAccessConfigurationEntity)
          .findOne({ where: { workspaceId } });

        if (!configuration) {
          return { version: 1, status: 'absent' };
        }

        const managedObjects = await transactionManager
          .getRepository(InconnectRecordAccessManagedObjectEntity)
          .find({
            order: { id: 'ASC' },
            where: { workspaceId },
          });
        const policies = await transactionManager
          .getRepository(InconnectRecordAccessPolicyEntity)
          .find({
            order: { id: 'ASC' },
            where: { workspaceId },
          });
        const roleIds = [
          ...new Set(
            policies.flatMap((policy) => [
              policy.roleId,
              ...(policy.defaultOwnerRoleId ? [policy.defaultOwnerRoleId] : []),
            ]),
          ),
        ];
        const ownerFieldMetadataIds = managedObjects.map(
          (managedObject) => managedObject.ownerFieldMetadataId,
        );
        const roles =
          roleIds.length === 0
            ? []
            : await transactionManager
                .getRepository(RoleEntity)
                .find({ where: { id: In(roleIds) } });
        const fields =
          ownerFieldMetadataIds.length === 0
            ? []
            : await transactionManager
                .getRepository(FieldMetadataEntity)
                .find({ where: { id: In(ownerFieldMetadataIds) } });
        const objectMetadataIds = [
          ...new Set([
            ...managedObjects.map(
              (managedObject) => managedObject.objectMetadataId,
            ),
            ...fields.flatMap((field) =>
              field.relationTargetObjectMetadataId
                ? [field.relationTargetObjectMetadataId]
                : [],
            ),
          ]),
        ];
        const objects =
          objectMetadataIds.length === 0
            ? []
            : await transactionManager
                .getRepository(ObjectMetadataEntity)
                .find({ where: { id: In(objectMetadataIds) } });
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
          roles: roles.map((role) => ({
            id: role.id,
            workspaceId: role.workspaceId,
          })),
          objects: objects.map((objectMetadata) => ({
            id: objectMetadata.id,
            workspaceId: objectMetadata.workspaceId,
            universalIdentifier: objectMetadata.universalIdentifier,
            isActive: objectMetadata.isActive,
          })),
          fields: fields.map((fieldMetadata) => ({
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
          return invalidInconnectRecordAccessPolicyMaps(
            validation.errors
              .map((error) => `${error.code}:${error.path}`)
              .join(', '),
          );
        }

        if (configuration.enforcementMode === 'UNMANAGED') {
          return {
            version: 1,
            status: 'valid',
            enforcementMode: 'UNMANAGED',
            revision: configuration.revision,
          };
        }

        const fieldsById = new Map(
          fields.map((fieldMetadata) => [fieldMetadata.id, fieldMetadata]),
        );
        const policiesByManagedObjectId = new Map<
          string,
          InconnectRecordAccessPolicyEntity[]
        >();

        for (const policy of policies) {
          const managedObjectPolicies =
            policiesByManagedObjectId.get(policy.managedObjectId) ?? [];

          managedObjectPolicies.push(policy);
          policiesByManagedObjectId.set(
            policy.managedObjectId,
            managedObjectPolicies,
          );
        }

        return {
          version: 1,
          status: 'valid',
          enforcementMode: 'MANAGED',
          revision: configuration.revision,
          managedObjects: managedObjects.map((managedObject) => {
            const ownerField = fieldsById.get(
              managedObject.ownerFieldMetadataId,
            );

            if (!ownerField) {
              throw new Error(
                'Validated INCONNECT owner FieldMetadata is missing',
              );
            }

            return {
              id: managedObject.id,
              objectMetadataId: managedObject.objectMetadataId,
              ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
              ownerFieldName: ownerField.name,
              ownerJoinColumnName: computeMorphOrRelationFieldJoinColumnName({
                name: ownerField.name,
              }),
              ownerRequirement: managedObject.ownerRequirement,
              policies: (
                policiesByManagedObjectId.get(managedObject.id) ?? []
              ).map((policy) => ({
                id: policy.id,
                roleId: policy.roleId,
                recordEffect: policy.recordEffect,
                createPolicy: policy.createPolicy,
                ownerTransferPolicy: policy.ownerTransferPolicy,
                missingOwnerPolicy: policy.missingOwnerPolicy,
                ...(policy.defaultOwnerRoleId
                  ? { defaultOwnerRoleId: policy.defaultOwnerRoleId }
                  : {}),
              })),
            };
          }),
        };
      },
    );
  }

  override decodeFromCacheStorage(
    rawData: unknown,
  ): InconnectRecordAccessPolicyMaps {
    return parseInconnectRecordAccessPolicyMaps(rawData);
  }

  override getInvalidationValue(
    reason: string,
  ): InconnectRecordAccessPolicyMaps {
    return invalidInconnectRecordAccessPolicyMaps(
      reason,
      'recomputation-failed',
    );
  }
}
