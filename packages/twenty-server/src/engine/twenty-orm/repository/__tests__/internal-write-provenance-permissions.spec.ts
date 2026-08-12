import {
  FieldMetadataType,
  type ObjectsPermissions,
} from 'twenty-shared/types';
import { type QueryExpressionMap } from 'typeorm/query-builder/QueryExpressionMap';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { applyInconnectRecordAccessToCreateValues } from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';
import {
  validateOperationIsPermittedOrThrow,
  validateQueryIsPermittedOrThrow,
} from 'src/engine/twenty-orm/repository/permissions.utils';

const LEAD_OBJECT_ID = 'lead-object-id';

const buildField = ({
  name,
  type,
  isSystemSideEffect = false,
}: {
  name: string;
  type: FieldMetadataType;
  isSystemSideEffect?: boolean;
}): FlatFieldMetadata =>
  ({
    id: `${name}-id`,
    universalIdentifier: `${name}-universal-id`,
    objectMetadataId: LEAD_OBJECT_ID,
    name,
    type,
    isSystemSideEffect,
  }) as FlatFieldMetadata;

const fields = [
  buildField({ name: 'etapa', type: FieldMetadataType.SELECT }),
  buildField({ name: 'fase', type: FieldMetadataType.SELECT }),
  buildField({ name: 'name', type: FieldMetadataType.TEXT }),
  buildField({
    name: 'createdBy',
    type: FieldMetadataType.ACTOR,
    isSystemSideEffect: true,
  }),
  buildField({
    name: 'updatedBy',
    type: FieldMetadataType.ACTOR,
    isSystemSideEffect: true,
  }),
  buildField({ name: 'internalNote', type: FieldMetadataType.TEXT }),
  buildField({ name: 'restrictedClientField', type: FieldMetadataType.TEXT }),
];

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  universalIdentifier: 'lead-universal-id',
  nameSingular: 'lead',
  fieldIds: fields.map(({ id }) => id),
  isSystem: false,
} as FlatObjectMetadata;

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: {
    [leadObjectMetadata.universalIdentifier]: leadObjectMetadata,
  },
  universalIdentifierById: {
    [LEAD_OBJECT_ID]: leadObjectMetadata.universalIdentifier,
  },
  universalIdentifiersByApplicationId: {},
};

const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: Object.fromEntries(
    fields.map((field) => [field.universalIdentifier, field]),
  ),
  universalIdentifierById: Object.fromEntries(
    fields.map((field) => [field.id, field.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
};

const fieldByName = Object.fromEntries(
  fields.map((field) => [field.name, field]),
);

const buildPermissions = ({
  canUpdateObjectRecords = true,
}: {
  canUpdateObjectRecords?: boolean;
} = {}): ObjectsPermissions => ({
  [LEAD_OBJECT_ID]: {
    canReadObjectRecords: true,
    canUpdateObjectRecords,
    canSoftDeleteObjectRecords: false,
    canDestroyObjectRecords: false,
    restrictedFields: {
      [fieldByName.createdBy.id]: { canRead: true, canUpdate: false },
      [fieldByName.updatedBy.id]: { canRead: true, canUpdate: false },
      [fieldByName.internalNote.id]: { canRead: true, canUpdate: false },
      [fieldByName.restrictedClientField.id]: {
        canRead: true,
        canUpdate: false,
      },
    },
    rowLevelPermissionPredicates: [],
    rowLevelPermissionPredicateGroups: [],
  },
});

const validateWrite = ({
  operationType,
  updatedColumns,
  internallyInjectedFieldNames = [],
  objectsPermissions = buildPermissions(),
}: {
  operationType: 'insert' | 'update';
  updatedColumns: string[];
  internallyInjectedFieldNames?: string[];
  objectsPermissions?: ObjectsPermissions;
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
    updatedColumns,
    internallyInjectedFieldNames,
  });

describe('internal write provenance permissions', () => {
  it.each(['etapa', 'fase'])(
    'allows updating editable %s with internally injected updatedBy',
    (fieldName) => {
      expect(() =>
        validateWrite({
          operationType: 'update',
          updatedColumns: [fieldName, 'updatedBySource'],
          internallyInjectedFieldNames: ['updatedBy'],
        }),
      ).not.toThrow();
    },
  );

  it('allows create with internally injected actor fields', () => {
    expect(() =>
      validateWrite({
        operationType: 'insert',
        updatedColumns: ['name', 'createdBySource', 'updatedBySource'],
        internallyInjectedFieldNames: ['createdBy', 'updatedBy'],
      }),
    ).not.toThrow();
  });

  it('preserves trusted actor fields when INCONNECT injects the missing owner', () => {
    const values = {
      name: 'Nuevo Lead',
      createdBySource: 'MANUAL',
      updatedBySource: 'MANUAL',
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: {
          kind: 'scoped',
          ownerFieldMetadataId: 'owner-field-id',
          ownerFieldName: 'propietarioDeLead',
          ownerJoinColumnName: 'propietarioDeLeadId',
          workspaceMemberId: 'scott-workspace-member-id',
        },
        valuesSet: values,
      }),
    ).toEqual({
      ...values,
      propietarioDeLeadId: 'scott-workspace-member-id',
    });
  });

  it.each([
    ['updatedBy', 'updatedBySource'],
    ['createdBy', 'createdBySource'],
  ])(
    'rejects direct writes to %s without trusted provenance',
    (_name, column) => {
      expect(() =>
        validateWrite({
          operationType: column.startsWith('created') ? 'insert' : 'update',
          updatedColumns: [column],
        }),
      ).toThrow(
        expect.objectContaining({
          code: PermissionsExceptionCode.PERMISSION_DENIED,
        }) as PermissionsException,
      );
    },
  );

  it('rejects a direct query builder write when no internal provenance is supplied', () => {
    const expressionMap = {
      aliases: [{ subQuery: undefined, metadata: { name: 'lead' } }],
      queryType: 'update',
      selects: [],
      joinAttributes: [],
      returning: [],
      valuesSet: { updatedBySource: 'MANUAL' },
    } as unknown as QueryExpressionMap;

    expect(() =>
      validateQueryIsPermittedOrThrow({
        expressionMap,
        objectsPermissions: buildPermissions(),
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        objectIdByNameSingular: { lead: LEAD_OBJECT_ID },
        shouldBypassPermissionChecks: false,
      }),
    ).toThrow(PermissionsException);
  });

  it('does not exempt an internally marked field that is not a system side effect', () => {
    expect(() =>
      validateWrite({
        operationType: 'update',
        updatedColumns: ['internalNote'],
        internallyInjectedFieldNames: ['internalNote'],
      }),
    ).toThrow(PermissionsException);
  });

  it('still rejects a restricted client field alongside trusted actor fields', () => {
    expect(() =>
      validateWrite({
        operationType: 'update',
        updatedColumns: ['restrictedClientField', 'updatedBySource'],
        internallyInjectedFieldNames: ['updatedBy'],
      }),
    ).toThrow(PermissionsException);
  });

  it('still rejects the operation when object-level update is denied', () => {
    expect(() =>
      validateWrite({
        operationType: 'update',
        updatedColumns: ['etapa', 'updatedBySource'],
        internallyInjectedFieldNames: ['updatedBy'],
        objectsPermissions: buildPermissions({
          canUpdateObjectRecords: false,
        }),
      }),
    ).toThrow(PermissionsException);
  });
});
