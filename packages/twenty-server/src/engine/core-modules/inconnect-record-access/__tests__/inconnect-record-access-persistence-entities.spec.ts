import { getMetadataArgsStorage } from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';

describe('INCONNECT record-access persistence entities', () => {
  it('maps one configuration per workspace with a precision-safe bigint revision', () => {
    const metadata = getMetadataArgsStorage();
    const table = metadata.tables.find(
      ({ target }) => target === InconnectRecordAccessConfigurationEntity,
    );
    const revision = metadata.columns.find(
      ({ target, propertyName }) =>
        target === InconnectRecordAccessConfigurationEntity &&
        propertyName === 'revision',
    );

    expect(table).toMatchObject({
      name: 'inconnectRecordAccessConfiguration',
      schema: 'core',
    });
    expect(revision?.options).toMatchObject({
      type: 'bigint',
      default: 0,
      nullable: false,
    });
    expect(
      metadata.columns.some(
        ({ target, propertyName }) =>
          target === InconnectRecordAccessConfigurationEntity &&
          propertyName === 'deletedAt',
      ),
    ).toBe(false);
  });

  it('maps managed ObjectMetadata and owner FieldMetadata through workspace-isolated composite joins', () => {
    const metadata = getMetadataArgsStorage();
    const joinColumns = metadata.joinColumns.filter(
      ({ target }) => target === InconnectRecordAccessManagedObjectEntity,
    );
    const indexes = metadata.indices.filter(
      ({ target }) => target === InconnectRecordAccessManagedObjectEntity,
    );

    expect(joinColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyName: 'objectMetadata',
          name: 'objectMetadataId',
          referencedColumnName: 'id',
        }),
        expect.objectContaining({
          propertyName: 'objectMetadata',
          name: 'workspaceId',
          referencedColumnName: 'workspaceId',
        }),
        expect.objectContaining({
          propertyName: 'ownerFieldMetadata',
          name: 'ownerFieldMetadataId',
          referencedColumnName: 'id',
        }),
        expect.objectContaining({
          propertyName: 'ownerFieldMetadata',
          name: 'objectMetadataId',
          referencedColumnName: 'objectMetadataId',
        }),
        expect.objectContaining({
          propertyName: 'ownerFieldMetadata',
          name: 'workspaceId',
          referencedColumnName: 'workspaceId',
        }),
      ]),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'IDX_INCONNECT_RA_MANAGED_OBJECT_WORKSPACE_OBJECT_UNIQUE',
          unique: true,
        }),
      ]),
    );
  });

  it('maps Policy uniqueness, strict checks, and RESTRICT Role relations', () => {
    const metadata = getMetadataArgsStorage();
    const indexes = metadata.indices.filter(
      ({ target }) => target === InconnectRecordAccessPolicyEntity,
    );
    const checks = metadata.checks.filter(
      ({ target }) => target === InconnectRecordAccessPolicyEntity,
    );
    const roleRelations = metadata.relations.filter(
      ({ target, propertyName }) =>
        target === InconnectRecordAccessPolicyEntity &&
        ['role', 'defaultOwnerRole'].includes(propertyName),
    );

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'IDX_INCONNECT_RA_POLICY_WORKSPACE_MANAGED_OBJECT_ROLE_UNIQUE',
          unique: true,
        }),
      ]),
    );
    expect(checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_PRINCIPAL_TYPE',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_RECORD_EFFECT',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_CREATE_POLICY',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_OWNER_TRANSFER_POLICY',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_MISSING_OWNER_POLICY',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_DENIED_CREATE',
        'CHK_INCONNECT_RECORD_ACCESS_POLICY_SCOPED_CREATE',
      ]),
    );
    expect(roleRelations).toHaveLength(2);
    expect(
      roleRelations.every(({ options }) => options.onDelete === 'RESTRICT'),
    ).toBe(true);
  });
});
