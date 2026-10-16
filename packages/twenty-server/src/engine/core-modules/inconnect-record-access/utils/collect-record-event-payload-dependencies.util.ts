import { FieldMetadataType, RelationType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { findFlatEntityByIdInFlatEntityMapsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { isFlatFieldMetadataOfType } from 'src/engine/metadata-modules/flat-field-metadata/utils/is-flat-field-metadata-of-type.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!isDefined(value) || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid record event payload');
  }

  return value as Record<string, unknown>;
};

// No CRM reads: classify the complete payload, including both snapshots and diff.
// Unknown metadata cannot prove that a value is safe for generic distribution.
export const collectRecordEventPayloadDependencies = ({
  workspaceId,
  objectMetadataId,
  eventProperties,
  flatObjectMetadataMaps,
  flatFieldMetadataMaps,
}: {
  workspaceId: string;
  objectMetadataId: string;
  eventProperties: unknown[];
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): Set<string> => {
  const dependencies = new Set<string>();
  let visitedRecordCount = 0;

  const visit = (objectId: string, value: unknown, depth: number) => {
    if (depth > 8 || ++visitedRecordCount > 10000) {
      throw new Error('Record event payload exceeds classification bounds');
    }

    const object = findFlatEntityByIdInFlatEntityMapsOrThrow({
      flatEntityMaps: flatObjectMetadataMaps,
      flatEntityId: objectId,
    });

    if (object.id !== objectId || object.workspaceId !== workspaceId) {
      throw new Error('Invalid record event object metadata');
    }

    dependencies.add(objectId);
    const fields = object.fieldIds.map((fieldId) => {
      const field = findFlatEntityByIdInFlatEntityMapsOrThrow({
        flatEntityMaps: flatFieldMetadataMaps,
        flatEntityId: fieldId,
      });

      if (
        field.id !== fieldId ||
        field.workspaceId !== workspaceId ||
        field.objectMetadataId !== objectId
      ) {
        throw new Error('Invalid record event field metadata');
      }

      return field;
    });
    if (
      new Set(object.fieldIds).size !== object.fieldIds.length ||
      new Set(fields.map((field) => field.name)).size !== fields.length
    ) {
      throw new Error('Duplicate record event field metadata');
    }
    const fieldsByKey = new Map(fields.map((field) => [field.name, field]));

    for (const field of fields) {
      if (
        (isFlatFieldMetadataOfType(field, FieldMetadataType.RELATION) ||
          isFlatFieldMetadataOfType(field, FieldMetadataType.MORPH_RELATION)) &&
        field.settings?.relationType === RelationType.MANY_TO_ONE
      ) {
        const joinColumnName = computeMorphOrRelationFieldJoinColumnName({
          name: field.name,
        });

        if (fieldsByKey.has(joinColumnName)) {
          throw new Error('Conflicting record event relation metadata');
        }
        fieldsByKey.set(joinColumnName, field);
      }
    }

    for (const [key, entry] of Object.entries(asRecord(value))) {
      const field = fieldsByKey.get(key);

      if (!field) throw new Error('Unknown record event field');
      if (!isDefined(entry)) continue;
      if (
        field.type !== FieldMetadataType.RELATION &&
        field.type !== FieldMetadataType.MORPH_RELATION
      )
        continue;

      const targetId = field.relationTargetObjectMetadataId;

      if (!isDefined(targetId)) throw new Error('Missing relation target');
      if (key !== field.name && typeof entry !== 'string') {
        throw new Error('Invalid record event relation identifier');
      }
      // Validate even an FK-only dependency without querying the target row.
      visit(targetId, {}, depth + 1);
      if (key === field.name) {
        for (const related of Array.isArray(entry) ? entry : [entry]) {
          visit(targetId, related, depth + 1);
        }
      }
    }
  };

  visit(objectMetadataId, {}, 0);
  for (const value of eventProperties) {
    const properties = asRecord(value);

    for (const key of Object.keys(properties)) {
      if (!['before', 'after', 'diff', 'updatedFields'].includes(key)) {
        throw new Error('Unknown record event property');
      }
    }

    for (const snapshot of [properties.before, properties.after]) {
      if (isDefined(snapshot)) visit(objectMetadataId, snapshot, 0);
    }

    if (isDefined(properties.updatedFields)) {
      if (
        !Array.isArray(properties.updatedFields) ||
        properties.updatedFields.some((name) => typeof name !== 'string')
      ) {
        throw new Error('Invalid updated fields');
      }
      visit(
        objectMetadataId,
        Object.fromEntries(
          properties.updatedFields.map((name) => [name, undefined]),
        ),
        0,
      );
    }

    if (isDefined(properties.diff)) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const [key, change] of Object.entries(asRecord(properties.diff))) {
        const pair = asRecord(change);

        if (
          Object.keys(pair).some((name) => !['before', 'after'].includes(name))
        ) {
          throw new Error('Unknown record event diff property');
        }
        before[key] = pair.before;
        after[key] = pair.after;
      }
      visit(objectMetadataId, before, 0);
      visit(objectMetadataId, after, 0);
    }
  }

  return dependencies;
};
