import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { validateInconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-persisted-candidate.util';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { type SyncableFlatEntity } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-from.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';

type ValidatePolicyMapsAgainstMetadataArgs = {
  workspaceId: string;
  policyMaps: Extract<
    InconnectRecordAccessPolicyMaps,
    { status: 'valid'; enforcementMode: 'MANAGED' }
  >;
  flatRoleMaps: FlatEntityMaps<FlatRole>;
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
};

const getFlatEntityById = <TEntity extends SyncableFlatEntity>(
  maps: FlatEntityMaps<TEntity>,
  id: string,
): TEntity | undefined => {
  const universalIdentifier = maps.universalIdentifierById[id];

  return universalIdentifier
    ? maps.byUniversalIdentifier[universalIdentifier]
    : undefined;
};

export const validateInconnectRecordAccessPolicyMapsAgainstMetadata = ({
  workspaceId,
  policyMaps,
  flatRoleMaps,
  flatObjectMetadataMaps,
  flatFieldMetadataMaps,
}: ValidatePolicyMapsAgainstMetadataArgs): string | undefined => {
  const ownerFields = policyMaps.managedObjects.flatMap((managedObject) => {
    const ownerField = getFlatEntityById(
      flatFieldMetadataMaps,
      managedObject.ownerFieldMetadataId,
    );

    return ownerField ? [ownerField] : [];
  });
  const referencedRoleIds = [
    ...new Set(
      policyMaps.managedObjects.flatMap((managedObject) =>
        managedObject.policies.flatMap((policy) => [
          policy.roleId,
          ...(policy.defaultOwnerRoleId ? [policy.defaultOwnerRoleId] : []),
        ]),
      ),
    ),
  ];
  const referencedObjectIds = [
    ...new Set([
      ...policyMaps.managedObjects.map(
        (managedObject) => managedObject.objectMetadataId,
      ),
      ...ownerFields.flatMap((ownerField) =>
        ownerField.relationTargetObjectMetadataId
          ? [ownerField.relationTargetObjectMetadataId]
          : [],
      ),
    ]),
  ];
  const candidate: InconnectRecordAccessPersistedCandidate = {
    configuration: {
      workspaceId,
      enforcementMode: policyMaps.enforcementMode,
      revision: policyMaps.revision,
    },
    managedObjects: policyMaps.managedObjects.map((managedObject) => ({
      id: managedObject.id,
      workspaceId,
      objectMetadataId: managedObject.objectMetadataId,
      ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
      ownerRequirement: managedObject.ownerRequirement,
    })),
    policies: policyMaps.managedObjects.flatMap((managedObject) =>
      managedObject.policies.map((policy) => ({
        id: policy.id,
        workspaceId,
        managedObjectId: managedObject.id,
        roleId: policy.roleId,
        principalType: 'WORKSPACE_MEMBER',
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId ?? null,
      })),
    ),
    roles: referencedRoleIds.flatMap((roleId) => {
      const role = getFlatEntityById(flatRoleMaps, roleId);

      return role ? [{ id: role.id, workspaceId: role.workspaceId }] : [];
    }),
    objects: referencedObjectIds.flatMap((objectMetadataId) => {
      const objectMetadata = getFlatEntityById(
        flatObjectMetadataMaps,
        objectMetadataId,
      );

      return objectMetadata
        ? [
            {
              id: objectMetadata.id,
              workspaceId: objectMetadata.workspaceId,
              universalIdentifier: objectMetadata.universalIdentifier,
              isActive: objectMetadata.isActive,
            },
          ]
        : [];
    }),
    fields: ownerFields.map((fieldMetadata) => ({
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
  const validation = validateInconnectRecordAccessPersistedCandidate(candidate);

  if (!validation.valid) {
    return validation.errors
      .map((error) => `${error.code}:${error.path}`)
      .join(', ');
  }

  for (const managedObject of policyMaps.managedObjects) {
    const ownerField = getFlatEntityById(
      flatFieldMetadataMaps,
      managedObject.ownerFieldMetadataId,
    );

    if (
      !ownerField ||
      managedObject.ownerFieldName !== ownerField.name ||
      managedObject.ownerJoinColumnName !==
        computeMorphOrRelationFieldJoinColumnName({ name: ownerField.name })
    ) {
      return `Cached owner FieldMetadata does not match ${managedObject.id}`;
    }
  }

  return undefined;
};
