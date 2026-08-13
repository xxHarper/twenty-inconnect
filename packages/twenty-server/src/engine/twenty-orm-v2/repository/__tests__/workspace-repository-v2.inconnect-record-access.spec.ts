import {
  FieldMetadataType,
  type ObjectsPermissions,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { type CompiledStatement } from 'src/engine/twenty-orm-v2/sql/utils/compile-named-parameters.util';
import { WorkspaceRepositoryV2 } from 'src/engine/twenty-orm-v2/repository/workspace-repository-v2';
import { type WorkspaceTableShape } from 'src/engine/twenty-orm-v2/table-shape/types/workspace-table-shape.type';

const LEAD_OBJECT_ID = 'lead-object-id';
const ROLE_ID = 'role-id';
const SCOTT_WORKSPACE_MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTIVE_A_WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTIVE_B_WORKSPACE_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TEAM_EXECUTIVE_WORKSPACE_MEMBER_ID =
  '44444444-4444-4444-8444-444444444444';
const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
    relatedLeadId: {
      columnName: 'relatedLeadId',
      fieldMetadataId: 'related-lead-field-id',
      fieldName: 'relatedLead',
      fieldMetadataType: FieldMetadataType.RELATION,
    },
  },
  columnNames: ['id', 'name', 'propietarioDeLeadId', 'relatedLeadId'],
  relationShapeByFieldName: {
    relatedLead: {
      fieldName: 'relatedLead',
      fieldMetadataId: 'related-lead-field-id',
      relationType: RelationType.MANY_TO_ONE,
      targetObjectMetadataId: LEAD_OBJECT_ID,
      targetFieldMetadataId: null,
      joinColumnName: 'relatedLeadId',
    },
  },
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
      recordEffect: 'ownRecords',
      createPolicy: 'denied',
      ownerTransferPolicy: 'denied',
    },
  ],
};

const ownAndTeamPolicy: InconnectRecordAccessWorkspacePolicy = {
  status: 'configured',
  rules: [{ ...scopedPolicy.rules[0], recordEffect: 'ownAndTeamRecords' }],
};

const allRecordsPolicy: InconnectRecordAccessWorkspacePolicy = {
  status: 'configured',
  rules: [{ ...scopedPolicy.rules[0], recordEffect: 'allRecords' }],
};

const coordinatorTeamAccessMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [SCOTT_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
      isWorkspaceMemberAssignable: true,
    },
    [EXECUTIVE_A_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: true,
    },
    [EXECUTIVE_B_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: false,
    },
  },
  memberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [
      SCOTT_WORKSPACE_MEMBER_ID,
      EXECUTIVE_A_WORKSPACE_MEMBER_ID,
      EXECUTIVE_B_WORKSPACE_MEMBER_ID,
    ],
  },
  assignableMemberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [SCOTT_WORKSPACE_MEMBER_ID, EXECUTIVE_A_WORKSPACE_MEMBER_ID],
  },
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
    propietarioDeLeadId: OTHER_TEAM_EXECUTIVE_WORKSPACE_MEMBER_ID,
  },
  {
    id: 'executive-a-lead-id',
    name: 'Ana Team Lead',
    propietarioDeLeadId: EXECUTIVE_A_WORKSPACE_MEMBER_ID,
  },
  {
    id: 'executive-b-lead-id',
    name: 'Bruno Historical Lead',
    propietarioDeLeadId: EXECUTIVE_B_WORKSPACE_MEMBER_ID,
  },
];

const buildRepository = ({
  policy = scopedPolicy,
  permissions = readablePermissions,
  shouldBypassPermissionChecks = true,
  teamAccessMaps,
}: {
  policy?: InconnectRecordAccessWorkspacePolicy;
  permissions?: ObjectsPermissions;
  shouldBypassPermissionChecks?: boolean;
  teamAccessMaps?: InconnectTeamAccessMaps;
} = {}) => {
  const executedStatements: CompiledStatement[] = [];
  const executor = {
    execute: jest.fn(async (statement: CompiledStatement) => {
      executedStatements.push(statement);

      if (statement.text.includes('1 = 0')) {
        return [];
      }

      let records = [...sourceRecords];

      if (statement.text.includes('"lead"."propietarioDeLeadId" IN')) {
        const configuredOwnerIds = statement.values.filter(
          (value): value is string =>
            typeof value === 'string' &&
            sourceRecords.some(
              (record) => record.propietarioDeLeadId === value,
            ),
        );

        records = records.filter((record) =>
          configuredOwnerIds.includes(record.propietarioDeLeadId),
        );
      }

      const requestedRecordIds = sourceRecords
        .map((record) => record.id)
        .filter((recordId) => statement.values.includes(recordId));

      if (requestedRecordIds.length > 0) {
        records = records.filter((record) =>
          requestedRecordIds.includes(record.id),
        );
      }

      const searchTerm = statement.values.find(
        (value): value is string =>
          typeof value === 'string' &&
          value.startsWith('%') &&
          value.endsWith('%'),
      );

      if (searchTerm) {
        records = records.filter((record) =>
          record.name.includes(searchTerm.slice(1, -1)),
        );
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
    inconnectTeamAccessMaps: teamAccessMaps,
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
      '"lead"."propietarioDeLeadId" IN ($1)',
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
      'WHERE ("lead"."propietarioDeLeadId" IN ($1)) AND (("lead"."id" = $2) OR ("lead"."name" = $3))',
    );
    expect(executedStatements[0].text).toContain('LIMIT $');
  });

  it('lists own and Team Leads while excluding another Team', async () => {
    const { repository, executedStatements } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    const records = await repository
      .createQueryBuilder('lead')
      .getMany({ noFormatting: true });

    expect(records.map(({ id }) => id)).toEqual([
      'alberto-id',
      'executive-a-lead-id',
      'executive-b-lead-id',
    ]);
    expect(executedStatements[0].text).toContain(
      '"lead"."propietarioDeLeadId" IN ($1, $2, $3)',
    );
    expect(executedStatements[0].values.slice(0, 3)).toEqual([
      SCOTT_WORKSPACE_MEMBER_ID,
      EXECUTIVE_A_WORKSPACE_MEMBER_ID,
      EXECUTIVE_B_WORKSPACE_MEMBER_ID,
    ]);
  });

  it('finds Team Leads by ID and hides a Lead from another Team', async () => {
    const { repository } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    const teamLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'executive-a-lead-id' })
      .getOne({ noFormatting: true });
    const otherTeamLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'marco-id' })
      .getOne({ noFormatting: true });

    expect(teamLead).toMatchObject({ id: 'executive-a-lead-id' });
    expect(otherTeamLead).toBeNull();
  });

  it('scopes ILIKE search and directed filters to coordinator owners', async () => {
    const { repository } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    const teamSearch = await repository
      .createQueryBuilder('lead')
      .where('"lead"."name" ILIKE :search', { search: '%Ana%' })
      .getMany({ noFormatting: true });
    const otherTeamSearch = await repository
      .createQueryBuilder('lead')
      .where('"lead"."name" ILIKE :search', { search: '%Marco%' })
      .getMany({ noFormatting: true });
    const otherTeamFilter = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'marco-id' })
      .getMany({ noFormatting: true });

    expect(teamSearch.map(({ id }) => id)).toEqual(['executive-a-lead-id']);
    expect(otherTeamSearch).toEqual([]);
    expect(otherTeamFilter).toEqual([]);
  });

  it('groups coordinator scope before OR filters and pagination', async () => {
    const { repository, executedStatements } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :firstId', { firstId: 'marco-id' })
      .orWhere('"lead"."name" = :secondName', {
        secondName: 'Marco Mendoza',
      })
      .limit(10)
      .getMany({ noFormatting: true });

    expect(executedStatements[0].text).toContain(
      'WHERE ("lead"."propietarioDeLeadId" IN ($1, $2, $3)) AND (("lead"."id" = $4) OR ("lead"."name" = $5))',
    );
    expect(executedStatements[0].text).toContain('LIMIT $6');
  });

  it('applies coordinator scope to raw reads', async () => {
    const { repository } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    const teamLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'executive-b-lead-id' })
      .getRawOne();
    const otherTeamLead = await repository
      .createQueryBuilder('lead')
      .where('"lead"."id" = :id', { id: 'marco-id' })
      .getRawOne();

    expect(teamLead).toMatchObject({ lead_id: 'executive-b-lead-id' });
    expect(otherTeamLead).toBeUndefined();
  });
  it('applies coordinator scope to joined managed Leads', async () => {
    const { repository, executedStatements } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
    });

    await repository
      .createQueryBuilder('lead')
      .leftJoin('lead.relatedLead', 'joinedLead')
      .getMany({ noFormatting: true });

    expect(executedStatements[0].text).toContain(
      '"joinedLead"."propietarioDeLeadId" IN ($1, $2, $3)',
    );
    expect(executedStatements[0].text).toContain(
      '"lead"."propietarioDeLeadId" IN ($1, $2, $3)',
    );
  });

  it('leaves SQL unrestricted only for an explicit allRecords policy', async () => {
    const { repository, executedStatements } = buildRepository({
      policy: allRecordsPolicy,
    });

    const records = await repository
      .createQueryBuilder('lead')
      .getMany({ noFormatting: true });

    expect(records).toHaveLength(4);
    expect(executedStatements[0].text).not.toContain('propietarioDeLeadId" IN');
  });

  it('denies reads when the configured workspace policy is invalid', async () => {
    const { repository } = buildRepository({
      policy: { status: 'invalid', reason: 'owner field missing' },
    });

    await expect(
      repository.createQueryBuilder('lead').getMany({ noFormatting: true }),
    ).resolves.toEqual([]);
  });

  it('does not grant a Team Lead when the standard Role denies read', async () => {
    const { repository, executor } = buildRepository({
      policy: ownAndTeamPolicy,
      teamAccessMaps: coordinatorTeamAccessMaps,
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
  it('does not let allRecords bypass standard Role permissions', async () => {
    const { repository, executor } = buildRepository({
      policy: allRecordsPolicy,
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
