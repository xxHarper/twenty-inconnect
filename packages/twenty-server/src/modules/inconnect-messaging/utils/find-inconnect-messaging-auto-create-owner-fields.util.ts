import { FieldMetadataType } from 'twenty-shared/types';

import { type FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

export const isInconnectMessagingManyToOneRelation = (
  fieldMetadata: FieldMetadataEntity,
): boolean =>
  (fieldMetadata.settings as { relationType?: RelationType } | null)
    ?.relationType === RelationType.MANY_TO_ONE;

export const findInconnectMessagingAutoCreateOwnerFields = ({
  fields,
  workspaceMemberObjectMetadataId,
}: {
  fields: FieldMetadataEntity[];
  workspaceMemberObjectMetadataId: string;
}): FieldMetadataEntity[] =>
  fields.filter(
    (field) =>
      field.isActive === true &&
      field.type === FieldMetadataType.RELATION &&
      field.relationTargetObjectMetadataId ===
        workspaceMemberObjectMetadataId &&
      isInconnectMessagingManyToOneRelation(field),
  );
