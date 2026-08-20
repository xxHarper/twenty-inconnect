import { getMetadataArgsStorage } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

describe('INCONNECT composite reference indexes', () => {
  it.each([
    [
      RoleEntity,
      'IDX_ROLE_ID_WORKSPACE_ID_INCONNECT_UNIQUE',
      ['id', 'workspaceId'],
    ],
    [
      ObjectMetadataEntity,
      'IDX_OBJECT_METADATA_ID_WORKSPACE_ID_INCONNECT_UNIQUE',
      ['id', 'workspaceId'],
    ],
    [
      FieldMetadataEntity,
      'IDX_FIELD_METADATA_ID_OBJECT_WORKSPACE_INCONNECT_UNIQUE',
      ['id', 'objectMetadataId', 'workspaceId'],
    ],
  ])(
    'declares %s as a unique composite FK target',
    (entity, indexName, expectedColumns) => {
      const index = getMetadataArgsStorage().indices.find(
        ({ target, name }) => target === entity && name === indexName,
      );

      expect(index).toMatchObject({
        columns: expectedColumns,
        unique: true,
      });
    },
  );
});
