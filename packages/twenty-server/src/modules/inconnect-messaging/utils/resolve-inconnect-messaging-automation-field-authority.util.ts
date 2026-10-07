import { PARTIAL_SYSTEM_FLAT_FIELD_METADATAS } from 'src/engine/metadata-modules/object-metadata/constants/partial-system-flat-field-metadatas.constant';
import { type FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';

export type InconnectMessagingAutomationFieldAuthority = Readonly<{
  deliberateBusinessFieldMetadataIds: ReadonlySet<string>;
  requiredSystemCreateFieldMetadataIds: ReadonlySet<string>;
  writableFieldMetadataIds: ReadonlySet<string>;
}>;

const isCanonicalPositionField = (field: FieldMetadataEntity): boolean => {
  const position = PARTIAL_SYSTEM_FLAT_FIELD_METADATAS.position;

  return (
    field.name === position.name &&
    field.type === position.type &&
    field.isActive === position.isActive &&
    field.isSystem === position.isSystem &&
    field.isSystemSideEffect === position.isSystemSideEffect &&
    field.isNullable === position.isNullable &&
    field.isUIEditable === position.isUIEditable
  );
};

export const resolveInconnectMessagingAutomationFieldAuthority = ({
  fields,
  ownerFieldMetadataId,
  primaryFieldMetadataId,
}: {
  fields: FieldMetadataEntity[];
  ownerFieldMetadataId: string;
  primaryFieldMetadataId: string;
}): InconnectMessagingAutomationFieldAuthority | null => {
  const fieldIds = new Set(fields.map(({ id }) => id));
  const deliberateBusinessFieldMetadataIds = new Set([
    primaryFieldMetadataId,
    ownerFieldMetadataId,
  ]);
  const positionFields = fields.filter(isCanonicalPositionField);

  if (
    deliberateBusinessFieldMetadataIds.size !== 2 ||
    !fieldIds.has(primaryFieldMetadataId) ||
    !fieldIds.has(ownerFieldMetadataId) ||
    positionFields.length !== 1 ||
    deliberateBusinessFieldMetadataIds.has(positionFields[0].id)
  ) {
    return null;
  }

  const requiredSystemCreateFieldMetadataIds = new Set([positionFields[0].id]);

  return Object.freeze({
    deliberateBusinessFieldMetadataIds,
    requiredSystemCreateFieldMetadataIds,
    writableFieldMetadataIds: new Set([
      ...deliberateBusinessFieldMetadataIds,
      ...requiredSystemCreateFieldMetadataIds,
    ]),
  });
};
