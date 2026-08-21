import { Injectable } from '@nestjs/common';

import crypto from 'crypto';
import { type EntityManager, In } from 'typeorm';

import { isValidUuid } from 'twenty-shared/utils';

import {
  InconnectRecordAccessConfigurationException,
  InconnectRecordAccessConfigurationExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { type InconnectRecordAccessConfigurationSetInput } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { validateInconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-persisted-candidate.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

type BuildValidatedCandidateArgs = {
  manager: EntityManager;
  workspaceId: string;
  revision: string;
  input: InconnectRecordAccessConfigurationSetInput;
};

@Injectable()
export class InconnectRecordAccessConfigurationCandidateService {
  async buildValidatedCandidate({
    manager,
    workspaceId,
    revision,
    input,
  }: BuildValidatedCandidateArgs): Promise<InconnectRecordAccessPersistedCandidate> {
    this.assertIdentifiersAreUuid({ workspaceId, input });

    const managedObjectIdByObjectMetadataId = new Map<string, string>();
    const managedObjects = input.managedObjects.map((managedObject) => {
      const id = crypto.randomUUID();

      if (
        !managedObjectIdByObjectMetadataId.has(managedObject.objectMetadataId)
      ) {
        managedObjectIdByObjectMetadataId.set(
          managedObject.objectMetadataId,
          id,
        );
      }

      return {
        id,
        workspaceId,
        objectMetadataId: managedObject.objectMetadataId,
        ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
        ownerRequirement: managedObject.ownerRequirement,
      };
    });
    const policies = input.policies.map((policy) => ({
      id: crypto.randomUUID(),
      workspaceId,
      managedObjectId:
        managedObjectIdByObjectMetadataId.get(policy.objectMetadataId) ??
        crypto.randomUUID(),
      roleId: policy.roleId,
      principalType: 'WORKSPACE_MEMBER',
      recordEffect: policy.recordEffect,
      createPolicy: policy.createPolicy,
      ownerTransferPolicy: policy.ownerTransferPolicy,
      missingOwnerPolicy: policy.missingOwnerPolicy,
      defaultOwnerRoleId: policy.defaultOwnerRoleId ?? null,
    }));
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
        : await manager
            .getRepository(RoleEntity)
            .find({ where: { id: In(roleIds) } });
    const fields =
      ownerFieldMetadataIds.length === 0
        ? []
        : await manager
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
        : await manager
            .getRepository(ObjectMetadataEntity)
            .find({ where: { id: In(objectMetadataIds) } });
    const candidate: InconnectRecordAccessPersistedCandidate = {
      configuration: {
        workspaceId,
        enforcementMode: input.enforcementMode,
        revision,
      },
      managedObjects,
      policies,
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
      throw new InconnectRecordAccessConfigurationException(
        validation.errors
          .map((error) => `${error.code} at ${error.path}: ${error.message}`)
          .join('; '),
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      );
    }

    return candidate;
  }

  private assertIdentifiersAreUuid({
    workspaceId,
    input,
  }: {
    workspaceId: string;
    input: InconnectRecordAccessConfigurationSetInput;
  }): void {
    const identifiers = [
      workspaceId,
      ...input.managedObjects.flatMap((managedObject) => [
        managedObject.objectMetadataId,
        managedObject.ownerFieldMetadataId,
      ]),
      ...input.policies.flatMap((policy) => [
        policy.objectMetadataId,
        policy.roleId,
        ...(policy.defaultOwnerRoleId ? [policy.defaultOwnerRoleId] : []),
      ]),
    ];

    if (identifiers.some((identifier) => !isValidUuid(identifier))) {
      throw new InconnectRecordAccessConfigurationException(
        'INCONNECT configuration contains an invalid UUID',
        InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
      );
    }
  }
}
