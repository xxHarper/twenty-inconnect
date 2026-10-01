import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';
import { type EntityManager } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import {
  computeColumnName,
  computeCompositeColumnName,
} from 'src/engine/metadata-modules/field-metadata/utils/compute-column-name.util';
import { getCompositeTypeOrThrow } from 'src/engine/metadata-modules/field-metadata/utils/get-composite-type-or-throw.util';
import { isCompositeFieldMetadataType } from 'src/engine/metadata-modules/field-metadata/utils/is-composite-field-metadata-type.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { InconnectMessagingAutoCreatePrimaryStatusDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { type PrimaryPhoneIdentityEvaluation } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';

export const INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON = {
  CONFIGURATION_DISABLED: 'CONFIGURATION_DISABLED',
  CONFIGURATION_INVALID: 'CONFIGURATION_INVALID',
  ANCHOR_MISMATCH: 'ANCHOR_MISMATCH',
  PRIMARY_MISSING: 'PRIMARY_MISSING',
  PRIMARY_INVALID: 'PRIMARY_INVALID',
  REQUIRED_FIELD_UNSATISFIED: 'REQUIRED_FIELD_UNSATISFIED',
  OWNER_CONFIGURATION_INVALID: 'OWNER_CONFIGURATION_INVALID',
  PHONE_UNIQUENESS_NOT_GUARANTEED: 'PHONE_UNIQUENESS_NOT_GUARANTEED',
  UNSUPPORTED_REQUIRED_FIELD: 'UNSUPPORTED_REQUIRED_FIELD',
  UNSUPPORTED_ANCHOR: 'UNSUPPORTED_ANCHOR',
  METADATA_INVALID: 'METADATA_INVALID',
} as const;

export type InconnectMessagingAutoCreateEligibilityReason =
  (typeof INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON)[keyof typeof INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON];

export type InconnectMessagingAutoCreateEligibilityResult =
  | {
      status: 'ELIGIBLE';
      reason: null;
      phoneUniquenessScope: 'ALL_ROWS';
    }
  | {
      status: 'INELIGIBLE';
      reason: InconnectMessagingAutoCreateEligibilityReason;
      phoneUniquenessScope: null;
    };

type PhysicalColumn = {
  columnName: string;
  isNullable: 'YES' | 'NO';
  columnDefault: string | null;
  isGenerated: 'ALWAYS' | 'NEVER';
};

type PhysicalIndex = {
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  isLive: boolean;
  isUnconditional: boolean;
  hasNoExpressions: boolean;
  keyColumns: string[];
};

const SYSTEM_MANAGED_FIELD_NAMES = new Set(
  'id createdAt updatedAt deletedAt position createdBy updatedBy searchVector'.split(
    ' ',
  ),
);

const primaryPhoneColumnNames = (fieldMetadata: FieldMetadataEntity) => [
  computeCompositeColumnName(fieldMetadata, {
    name: 'primaryPhoneCountryCode',
    type: FieldMetadataType.TEXT,
    hidden: false,
    isRequired: false,
  }),
  computeCompositeColumnName(fieldMetadata, {
    name: 'primaryPhoneCallingCode',
    type: FieldMetadataType.TEXT,
    hidden: false,
    isRequired: false,
  }),
  computeCompositeColumnName(fieldMetadata, {
    name: 'primaryPhoneNumber',
    type: FieldMetadataType.TEXT,
    hidden: false,
    isRequired: false,
  }),
];

const isSystemManagedField = (fieldMetadata: FieldMetadataEntity): boolean =>
  fieldMetadata.isSystemSideEffect === true ||
  (fieldMetadata.isSystem === true &&
    SYSTEM_MANAGED_FIELD_NAMES.has(fieldMetadata.name));

const isManyToOneRelation = (fieldMetadata: FieldMetadataEntity): boolean =>
  (fieldMetadata.settings as { relationType?: RelationType } | null)
    ?.relationType === RelationType.MANY_TO_ONE;

const getPhysicalColumnNames = (
  fieldMetadata: FieldMetadataEntity,
): string[] => {
  if (isCompositeFieldMetadataType(fieldMetadata.type)) {
    return getCompositeTypeOrThrow(fieldMetadata.type).properties.map(
      (property) => computeCompositeColumnName(fieldMetadata, property),
    );
  }

  if (fieldMetadata.type === FieldMetadataType.RELATION) {
    return isManyToOneRelation(fieldMetadata)
      ? [
          computeMorphOrRelationFieldJoinColumnName({
            name: fieldMetadata.name,
          }),
        ]
      : [];
  }

  if (fieldMetadata.type === FieldMetadataType.MORPH_RELATION) {
    return [];
  }

  return [computeColumnName(fieldMetadata)];
};

const ineligible = (
  reason: InconnectMessagingAutoCreateEligibilityReason,
): InconnectMessagingAutoCreateEligibilityResult => ({
  status: 'INELIGIBLE',
  reason,
  phoneUniquenessScope: null,
});

@Injectable()
export class InconnectMessagingAutoCreateEligibilityService {
  constructor(private readonly workspaceCacheService: WorkspaceCacheService) {}

  async evaluate({
    manager,
    configuration,
    anchorObject,
    ownerRoleIsValid,
    primaryPhoneIdentity,
  }: {
    manager: EntityManager;
    configuration: InconnectMessagingConfigurationEntity;
    anchorObject: ObjectMetadataEntity | null;
    ownerRoleIsValid: boolean;
    primaryPhoneIdentity: PrimaryPhoneIdentityEvaluation;
  }): Promise<InconnectMessagingAutoCreateEligibilityResult> {
    if (!configuration.autoCreateEnabled) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.CONFIGURATION_DISABLED,
      );
    }

    if (
      configuration.autoCreateAnchorObjectMetadataId === null ||
      configuration.autoCreateOwnerStrategy !==
        'UNIQUE_ACTIVE_MEMBER_OF_ROLE' ||
      configuration.autoCreateOwnerRoleId === null ||
      configuration.autoCreateLabelPolicy !== 'OMIT' ||
      !ownerRoleIsValid
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.CONFIGURATION_INVALID,
      );
    }

    if (
      configuration.autoCreateAnchorObjectMetadataId !==
      configuration.anchorObjectMetadataId
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.ANCHOR_MISMATCH,
      );
    }

    if (
      anchorObject === null ||
      anchorObject.workspaceId !== configuration.workspaceId ||
      anchorObject.id !== configuration.anchorObjectMetadataId ||
      anchorObject.isActive !== true ||
      anchorObject.isRemote === true
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_ANCHOR,
      );
    }

    if (
      primaryPhoneIdentity.summary.status ===
      InconnectMessagingAutoCreatePrimaryStatusDTO.MISSING
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PRIMARY_MISSING,
      );
    }

    if (
      primaryPhoneIdentity.summary.status !==
        InconnectMessagingAutoCreatePrimaryStatusDTO.VALID ||
      primaryPhoneIdentity.summary.fieldMetadataId === null
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PRIMARY_INVALID,
      );
    }

    try {
      return await this.evaluateMetadataAndPhysicalSchema({
        manager,
        configuration,
        anchorObject,
        primaryFieldMetadataId: primaryPhoneIdentity.summary.fieldMetadataId,
      });
    } catch {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
      );
    }
  }

  private async evaluateMetadataAndPhysicalSchema({
    manager,
    configuration,
    anchorObject,
    primaryFieldMetadataId,
  }: {
    manager: EntityManager;
    configuration: InconnectMessagingConfigurationEntity;
    anchorObject: ObjectMetadataEntity;
    primaryFieldMetadataId: string;
  }): Promise<InconnectMessagingAutoCreateEligibilityResult> {
    const [workspace, fields, workspaceMemberObject, cache] = await Promise.all(
      [
        manager.getRepository(WorkspaceEntity).findOne({
          select: { id: true, databaseSchema: true },
          where: { id: configuration.workspaceId },
        }),
        manager.getRepository(FieldMetadataEntity).find({
          where: {
            workspaceId: configuration.workspaceId,
            objectMetadataId: anchorObject.id,
          },
        }),
        manager.getRepository(ObjectMetadataEntity).findOne({
          where: {
            workspaceId: configuration.workspaceId,
            universalIdentifier:
              STANDARD_OBJECTS.workspaceMember.universalIdentifier,
          },
        }),
        this.workspaceCacheService.getOrRecompute(configuration.workspaceId, [
          'flatObjectMetadataMaps',
        ]),
      ],
    );

    if (
      workspace === null ||
      !isNonEmptyString(workspace.databaseSchema) ||
      fields.length === 0 ||
      workspaceMemberObject === null
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
      );
    }

    const objectUniversalIdentifier =
      cache.flatObjectMetadataMaps.universalIdentifierById[anchorObject.id];
    const flatObjectMetadata = objectUniversalIdentifier
      ? cache.flatObjectMetadataMaps.byUniversalIdentifier[
          objectUniversalIdentifier
        ]
      : undefined;

    if (
      flatObjectMetadata === undefined ||
      flatObjectMetadata.id !== anchorObject.id ||
      flatObjectMetadata.workspaceId !== configuration.workspaceId
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_ANCHOR,
      );
    }

    const primaryField = fields.find(({ id }) => id === primaryFieldMetadataId);

    if (
      primaryField === undefined ||
      primaryField.type !== FieldMetadataType.PHONES ||
      primaryField.isActive !== true
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PRIMARY_INVALID,
      );
    }

    const ownerFields = fields.filter(
      (field) =>
        field.isActive === true &&
        field.type === FieldMetadataType.RELATION &&
        field.relationTargetObjectMetadataId === workspaceMemberObject.id &&
        isManyToOneRelation(field),
    );

    if (ownerFields.length !== 1) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.OWNER_CONFIGURATION_INVALID,
      );
    }

    const tableName = computeObjectTargetTable(flatObjectMetadata);
    const [physicalColumns, physicalIndexes] = await Promise.all([
      manager.query<PhysicalColumn[]>(
        `SELECT
          column_name AS "columnName",
          is_nullable AS "isNullable",
          column_default AS "columnDefault",
          is_generated AS "isGenerated"
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`,
        [workspace.databaseSchema, tableName],
      ),
      manager.query<PhysicalIndex[]>(
        `SELECT
          index_data.indisunique AS "isUnique",
          index_data.indisvalid AS "isValid",
          index_data.indisready AS "isReady",
          index_data.indislive AS "isLive",
          index_data.indpred IS NULL AS "isUnconditional",
          index_data.indexprs IS NULL AS "hasNoExpressions",
          ARRAY(
            SELECT attribute.attname::text
            FROM unnest(index_data.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
            JOIN pg_catalog.pg_attribute attribute
              ON attribute.attrelid = index_data.indrelid
              AND attribute.attnum = key_column.attnum
            WHERE key_column.ordinal <= index_data.indnkeyatts
            ORDER BY key_column.ordinal
          ) AS "keyColumns"
        FROM pg_catalog.pg_index index_data
        JOIN pg_catalog.pg_class table_data
          ON table_data.oid = index_data.indrelid
        JOIN pg_catalog.pg_namespace namespace_data
          ON namespace_data.oid = table_data.relnamespace
        WHERE namespace_data.nspname = $1 AND table_data.relname = $2`,
        [workspace.databaseSchema, tableName],
      ),
    ]);

    if (physicalColumns.length === 0) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
      );
    }

    const columnByName = new Map(
      physicalColumns.map((column) => [column.columnName, column]),
    );
    const allMetadataColumns = new Set<string>();

    for (const field of fields) {
      const fieldColumns = getPhysicalColumnNames(field);

      for (const columnName of fieldColumns) {
        allMetadataColumns.add(columnName);

        if (!columnByName.has(columnName)) {
          return ineligible(
            INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
          );
        }
      }

      const physicalFieldColumns = fieldColumns.map(
        (columnName) => columnByName.get(columnName) as PhysicalColumn,
      );
      const isPhysicallyGenerated =
        physicalFieldColumns.length > 0 &&
        physicalFieldColumns.every(
          ({ isGenerated }) => isGenerated === 'ALWAYS',
        );

      if (
        field.id === primaryField.id ||
        field.id === ownerFields[0].id ||
        isSystemManagedField(field) ||
        isPhysicallyGenerated
      ) {
        continue;
      }

      if (field.isNullable === true) {
        const hasConflictingPhysicalRequirement = physicalFieldColumns.some(
          (column) =>
            column.isNullable === 'NO' && column.columnDefault === null,
        );

        if (hasConflictingPhysicalRequirement) {
          return ineligible(
            INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
          );
        }

        continue;
      }

      if (field.isNullable === null) {
        return ineligible(
          INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
        );
      }

      if (
        field.type === FieldMetadataType.RELATION ||
        field.type === FieldMetadataType.MORPH_RELATION ||
        isCompositeFieldMetadataType(field.type)
      ) {
        return ineligible(
          INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_REQUIRED_FIELD,
        );
      }

      if (
        field.defaultValue === null ||
        field.defaultValue === undefined ||
        fieldColumns.length !== 1 ||
        columnByName.get(fieldColumns[0])?.columnDefault === null
      ) {
        return ineligible(
          INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.REQUIRED_FIELD_UNSATISFIED,
        );
      }
    }

    const unknownRequiredColumn = physicalColumns.some(
      (column) =>
        !allMetadataColumns.has(column.columnName) &&
        column.isNullable === 'NO' &&
        column.columnDefault === null &&
        column.isGenerated !== 'ALWAYS',
    );

    if (unknownRequiredColumn) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
      );
    }

    const expectedPhoneColumns = primaryPhoneColumnNames(primaryField);

    if (
      expectedPhoneColumns.some((columnName) => !columnByName.has(columnName))
    ) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
      );
    }

    const expectedPhoneColumnSet = new Set(expectedPhoneColumns);
    const hasSuitableUniqueIndex = physicalIndexes.some(
      (index) =>
        index.isUnique &&
        index.isValid &&
        index.isReady &&
        index.isLive &&
        index.isUnconditional &&
        index.hasNoExpressions &&
        index.keyColumns.length === expectedPhoneColumns.length &&
        index.keyColumns.every((columnName) =>
          expectedPhoneColumnSet.has(columnName),
        ),
    );

    if (!hasSuitableUniqueIndex) {
      return ineligible(
        INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PHONE_UNIQUENESS_NOT_GUARANTEED,
      );
    }

    return {
      status: 'ELIGIBLE',
      reason: null,
      phoneUniquenessScope: 'ALL_ROWS',
    };
  }
}
