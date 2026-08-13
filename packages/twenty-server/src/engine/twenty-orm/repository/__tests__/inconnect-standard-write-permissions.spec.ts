import { type ObjectsPermissions } from 'twenty-shared/types';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { validateOperationIsPermittedOrThrow } from 'src/engine/twenty-orm/repository/permissions.utils';

const LEAD_OBJECT_ID = 'lead-object-id';
const LEAD_UNIVERSAL_IDENTIFIER = 'lead-universal-id';

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  universalIdentifier: LEAD_UNIVERSAL_IDENTIFIER,
  nameSingular: 'lead',
  fieldIds: [],
  isSystem: false,
} as unknown as FlatObjectMetadata;

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: {
    [LEAD_UNIVERSAL_IDENTIFIER]: leadObjectMetadata,
  },
  universalIdentifierById: {
    [LEAD_OBJECT_ID]: LEAD_UNIVERSAL_IDENTIFIER,
  },
  universalIdentifiersByApplicationId: {},
};

const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
};

const buildPermissions = ({
  canUpdateObjectRecords,
  canSoftDeleteObjectRecords,
  canDestroyObjectRecords = false,
}: {
  canUpdateObjectRecords: boolean;
  canSoftDeleteObjectRecords: boolean;
  canDestroyObjectRecords?: boolean;
}): ObjectsPermissions => ({
  [LEAD_OBJECT_ID]: {
    canReadObjectRecords: true,
    canUpdateObjectRecords,
    canSoftDeleteObjectRecords,
    canDestroyObjectRecords,
    restrictedFields: {},
    rowLevelPermissionPredicates: [],
    rowLevelPermissionPredicateGroups: [],
  },
});

const validateStandardPermission = ({
  operationType,
  objectsPermissions,
}: {
  operationType: 'update' | 'delete' | 'restore' | 'soft-delete';
  objectsPermissions: ObjectsPermissions;
}) =>
  validateOperationIsPermittedOrThrow({
    entityName: 'lead',
    operationType,
    objectsPermissions,
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
    objectIdByNameSingular: { lead: LEAD_OBJECT_ID },
    selectedColumns: [],
    allFieldsSelected: false,
    updatedColumns: [],
  });

describe('standard Twenty write permissions remain authoritative', () => {
  it('denies update of an owned record when the Role cannot update', () => {
    expect(() =>
      validateStandardPermission({
        operationType: 'update',
        objectsPermissions: buildPermissions({
          canUpdateObjectRecords: false,
          canSoftDeleteObjectRecords: true,
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: PermissionsExceptionCode.PERMISSION_DENIED,
      }) as PermissionsException,
    );
  });

  it('denies soft-delete of an owned record when the Role cannot soft-delete', () => {
    expect(() =>
      validateStandardPermission({
        operationType: 'soft-delete',
        objectsPermissions: buildPermissions({
          canUpdateObjectRecords: true,
          canSoftDeleteObjectRecords: false,
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: PermissionsExceptionCode.PERMISSION_DENIED,
      }) as PermissionsException,
    );
  });

  it('denies destroy of a Team record when the Role cannot destroy', () => {
    expect(() =>
      validateStandardPermission({
        operationType: 'delete',
        objectsPermissions: buildPermissions({
          canUpdateObjectRecords: true,
          canSoftDeleteObjectRecords: true,
          canDestroyObjectRecords: false,
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: PermissionsExceptionCode.PERMISSION_DENIED,
      }) as PermissionsException,
    );
  });

  it.each(['update', 'soft-delete', 'restore', 'delete'] as const)(
    'allows %s to continue to INCONNECT evaluation when the Role permits it',
    (operationType) => {
      expect(() =>
        validateStandardPermission({
          operationType,
          objectsPermissions: buildPermissions({
            canUpdateObjectRecords: true,
            canSoftDeleteObjectRecords: true,
            canDestroyObjectRecords: true,
          }),
        }),
      ).not.toThrow();
    },
  );
});
