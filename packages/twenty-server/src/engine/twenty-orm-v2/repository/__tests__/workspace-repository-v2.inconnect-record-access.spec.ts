import {
  FieldMetadataType,
  type ObjectsPermissions,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { type CompiledStatement } from 'src/engine/twenty-orm-v2/sql/utils/compile-named-parameters.util';
import { WorkspaceRepositoryV2 } from 'src/engine/twenty-orm-v2/repository/workspace-repository-v2';
import { type WorkspaceTableShape } from 'src/engine/twenty-orm-v2/table-shape/types/workspace-table-shape.type';

const LEAD_OBJECT_ID = 'lead-object-id';
const ROLE_ID = 'role-id';
const SCOTT_WORKSPACE_MEMBER_ID = 'scott-workspace-member-id';
const OWNER_FIELD_ID = 'owner-field-id';

const tableShape: WorkspaceTableShape = {
  objectMetadataId: LEAD_OBJECT_ID,
  nameSingular: 'lead',
  schemaName: 'workspace_test',
  tableName: '_lead',
  columnShapeByColumnName: {
    id: {
      columnName: 'id',
      fieldMetadataId: 'id-field-id',
      fieldName: 'id',
      fieldMetadataType: FieldMetadataType.UUID,
    },
    name: {
      columnName: 'name',
      fieldMetadataId: 'name-field-id',
      fieldName: 'name',
      fieldMetadataType: FieldMetadataType.TEXT,
    },
    propietarioDeLeadId: {
      columnName: 'propietarioDeLeadId',
      fieldMetadataId: OWNER_FIELD_ID,
      fieldName: 'propietarioDeLead',
      fieldMetadataType: FieldMetadataType.RELATION,
    },
  },
  columnNames: ['id', 'name', 'propietarioDeLeadId'],
  relationShapeByFieldName: {},
  hasDeletedAtColumn: false,
};

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  nameSingular: 'lead',
  universalIdentifier: 'lead-universal-id',
} as FlatObjectMetadata;

const scopedPolicy: InconnectRecordAccessWorkspacePolicy = {
  status: 'configured',
  rules: [
    {
      roleId: ROLE_ID,
      objectMetadataId: LEAD_OBJECT_ID,
      ownerFieldMetadataId: OWNER_FIELD_ID,
      ownerFieldName: 'propietarioDeLead',
      ownerJoinColumnName: 'propietarioDeLeadId',
      effect: 'ownRecords',
    },
  ],
};

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
} as WorkspaceAuthContext;

const readablePermissions: ObjectsPermissions = {
  lead: {
    canReadObjectRecords: true,
    canUpdateObjectRecords: false,
    canSoftDeleteObjectRecords: false,
    canDestroyObjectRecords: false,
    restrictedFields: {},
    rowLevelPermissionPredicates: [],
    rowLevelPermissionPredicateGroups: [],
  },
};

const sourceRecords = [
  {
    id: 'alberto-id',
    name: 'Alberto Garcia',
    propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
  },
  {
    id: 'marco-id',
    name: 'Marco Mendoza',
    propietarioDeLeadId: 'tim-workspace-member-id',
  },
];

const buildRepository = ({
  policy = scopedPolicy,
  permissions = readablePermissions,
  shouldBypassPermissionChecks = true,
}: {
  policy?: InconnectRecordAccessWorkspacePolicy;
  permissions?: ObjectsPermissions;
  shouldBypassPermissionChecks?: boolean;
} = {}) => {
  const executedStatements: CompiledStatement[] = [];
  const executor = {
    execute: jest.fn(async (statement: CompiledStatement) => {
      executedStatements.push(statement);

      if (statement.text.includes('1 = 0')) {
        return [];
      }

      let records = [...sourceRecords];

      if (statement.text.includes('"lead"."propietarioDeLeadId"')) {
        records = records.filter(
          (record) => record.propietarioDeLeadId === SCOTT_WORKSPACE_MEMBER_ID,
        );
      }

      if (statement.values.includes('alberto-id')) {
        records = records.filter((record) => record.id === 'alberto-id');
      }

      if (statement.values.includes('marco-id')) {
        records = records.filter((record) => record.id === 'marco-id');
      }

      if (statement.values.includes('%Marco%')) {
        records = records.filter((record) => record.name.includes('Marco'));
      }

      return records.map((record) => ({
        lead_id: record.id,
        lead_name: record.name,
        lead_propietarioDeLeadId: record.propietarioDeLeadId,
      }));
    }),
  };

  const internalContext = {
    workspaceId: 'workspace-id',
    inconnectRecordAccessPolicy: policy,
    userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
    apiKeyRoleMap: {},
    objectIdByNameSingular: { lead: LEAD_OBJECT_ID },
    flatObjectMetadataMaps: {
      byUniversalIdentifier: {
        'lead-universal-id': leadObjectMetadata,
      },
      universalIdentifierById: {
        [LEAD_OBJECT_ID]: 'lead-universal-id',
      },
      universalIdentifiersByApplicationId: {},
    },
    flatFieldMetadataMaps: {
      byUniversalIdentifier: {},
      universalIdentifierById: {},
      universalIdentifiersByApplicationId: {},
    },
    flatRowLevelPermissionPredicateMaps: {
      byUniversalIdentifier: {},
      universalIdentifierById: {},
      universalIdentifiersByApplicationId: {},
    },
    flatRowLevelPermissionPredicateGroupMaps: {
      byUniversalIdentifier: {},
      universalIdentifierById: {},
      universalIdentifiersByApplicationId: {},
    },
  } as unknown as WorkspaceInternalContext;

  return {
    repository: new WorkspaceRepositoryV2({
      tableShape,
      flatObjectMetadata: leadObjectMetadata,
      internalContext,
      authContext,
      executor,
      objectRecordsPermissions: permissions,
      shouldBypassPermissionChecks,
      tableShapeByObjectMetadataId: () => tableShape,
      flatObjectMetadataByObjectMetadataId: () => leadObjectMetadata,
    }),
    executedStatements,
    executor,
  };
};

describe('WorkspaceRepositoryV2 INCONNECT record access', () => {
  it('lists the owned Lead and excludes the foreign Lead', async () => {
    const { repository, executedStatements } = buildRepository();

    const records = await repository
      .createQueryBuilder('lead')
      .getMany({ noFormatting: true });

    expect(records).toEqual([
      {
        id: 'alberto-id',
        name: 'Alberto Garcia',
        propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
      },
    ]);
    expect(executedStatements[0].text).toContain(
      '"lead"."propietarioDeLeadId" = $1',
    );
    expect(executedStatements[0].values).toContain(SCOTT_WORKSPACE_MEMBER_ID);
  });

  it('finds the owned Lead by ID and treats the foreign Lead as missing', async () => {
    const { repository } = buildRepository();

    const ownLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'alberto-id' })
      .getOne({ noFormatting: true });
    const foreignLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'marco-id' })
      .getOne({ noFormatting: true });

    expect(ownLead).toMatchObject({ id: 'alberto-id' });
    expect(foreignLead).toBeNull();
  });

  it('combines the owner scope with directed filters and search terms', async () => {
    const { repository } = buildRepository();

    const filteredRecords = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'marco-id' })
      .getMany({ noFormatting: true });
    const searchRecords = await repository
      .createQueryBuilder('lead')
      .where('"lead"."name" ILIKE :search', { search: '%Marco%' })
      .getMany({ noFormatting: true });

    expect(filteredRecords).toEqual([]);
    expect(searchRecords).toEqual([]);
  });

  it('renders owner scope AND a grouped user OR expression', async () => {
    const { repository, executedStatements } = buildRepository();

    await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :firstId', { firstId: 'marco-id' })
      .orWhere('"lead"."name" = :secondName', {
        secondName: 'Marco Mendoza',
      })
      .limit(10)
      .getMany({ noFormatting: true });

    expect(executedStatements[0].text).toContain(
      'WHERE ("lead"."propietarioDeLeadId" = $1) AND (("lead"."id" = $2) OR ("lead"."name" = $3))',
    );
    expect(executedStatements[0].text).toContain('LIMIT $');
  });

  it('denies reads when the configured workspace policy is invalid', async () => {
    const { repository } = buildRepository({
      policy: { status: 'invalid', reason: 'owner field missing' },
    });

    await expect(
      repository.createQueryBuilder('lead').getMany({ noFormatting: true }),
    ).resolves.toEqual([]);
  });

  it('does not grant read when the standard Role denies it', async () => {
    const { repository, executor } = buildRepository({
      permissions: {
        lead: {
          ...readablePermissions.lead,
          canReadObjectRecords: false,
        },
      },
      shouldBypassPermissionChecks: false,
    });

    await expect(
      repository.createQueryBuilder('lead').getMany({ noFormatting: true }),
    ).rejects.toThrow();
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
