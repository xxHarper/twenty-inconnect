import { Brackets } from 'typeorm';
import { type WhereClause } from 'typeorm/query-builder/WhereClause';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { applyInconnectRecordAccessToMutationQueryBuilder } from 'src/engine/twenty-orm/utils/apply-inconnect-record-access-to-mutation-query-builder.util';

const LEAD_OBJECT_ID = 'lead-object-id';
const ROLE_ID = 'role-id';
const SCOTT_WORKSPACE_MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTIVE_WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const HISTORICAL_WORKSPACE_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  nameSingular: 'lead',
} as FlatObjectMetadata;

const coordinatorTeamAccessMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [SCOTT_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
      isWorkspaceMemberAssignable: true,
    },
    [EXECUTIVE_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: true,
    },
    [HISTORICAL_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: false,
    },
  },
  memberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [
      SCOTT_WORKSPACE_MEMBER_ID,
      EXECUTIVE_WORKSPACE_MEMBER_ID,
      HISTORICAL_WORKSPACE_MEMBER_ID,
    ],
  },
  assignableMemberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [SCOTT_WORKSPACE_MEMBER_ID, EXECUTIVE_WORKSPACE_MEMBER_ID],
  },
};

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
} as WorkspaceAuthContext;

const buildInternalContext = (
  policy: WorkspaceInternalContext['inconnectRecordAccessPolicy'] = {
    status: 'configured',
    managedObjectMetadataIds: [LEAD_OBJECT_ID],
    rules: [
      {
        roleId: ROLE_ID,
        objectMetadataId: LEAD_OBJECT_ID,
        ownerFieldMetadataId: 'owner-field-id',
        ownerFieldName: 'propietarioDeLead',
        ownerJoinColumnName: 'propietarioDeLeadId',
        recordEffect: 'ownRecords',
        createPolicy: 'denied',
        ownerTransferPolicy: 'denied',
        ownerRequirement: 'required',
        missingOwnerPolicy: 'requireExplicit',
      },
    ],
  },
) =>
  ({
    inconnectRecordAccessPolicy: policy,
    userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
    apiKeyRoleMap: {},
  }) as unknown as WorkspaceInternalContext;

type TestWhereClause = {
  type: 'and' | 'or';
  condition: unknown;
  inconnectRecordAccessMarker?: string;
};

const buildQueryBuilder = (wheres: TestWhereClause[] = []) => {
  const queryBuilder = {
    expressionMap: { wheres: [...wheres] },
    capturedParameters: {} as Record<string, unknown>,
    andWhere(condition: Brackets) {
      this.expressionMap.wheres.push({
        type: 'and',
        condition,
      });

      return this;
    },
    setParameters(parameters: Record<string, unknown>) {
      this.capturedParameters = {
        ...this.capturedParameters,
        ...parameters,
      };

      return this;
    },
  };

  return queryBuilder;
};

describe('applyInconnectRecordAccessToMutationQueryBuilder', () => {
  it('applies owner scope atomically and groups an existing OR filter', () => {
    const userWheres = [
      { type: 'and', condition: 'lead.id = :firstId' },
      { type: 'or', condition: 'lead.id = :secondId' },
    ] as TestWhereClause[];
    const queryBuilder = buildQueryBuilder(userWheres);

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext: buildInternalContext(),
      authContext,
      tableAlias: '_lead',
    });

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition:
        '"_lead"."propietarioDeLeadId" IN (:...inconnectRecordAccessOwnerIds_owner_field_id)',
    });
    expect(queryBuilder.expressionMap.wheres[1].condition).toBeInstanceOf(
      Brackets,
    );
    expect(queryBuilder.capturedParameters).toEqual({
      inconnectRecordAccessOwnerIds_owner_field_id: [SCOTT_WORKSPACE_MEMBER_ID],
    });

    const nestedExpressionMap = { wheres: [] as WhereClause[] };
    const brackets = queryBuilder.expressionMap.wheres[1]
      .condition as unknown as Brackets;

    brackets.whereFactory({
      expressionMap: nestedExpressionMap,
    } as never);

    expect(nestedExpressionMap.wheres).toEqual(userWheres);
  });

  it('uses a false predicate for update, delete, soft-delete and restore when policy is invalid', () => {
    const queryBuilder = buildQueryBuilder([
      { type: 'and', condition: 'lead.id = :id' } as TestWhereClause,
    ]);

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext: buildInternalContext({
        status: 'invalid',
        reason: 'Owner metadata is invalid',
      }),
      authContext,
    });

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition: '1 = 0',
    });
  });

  it('applies the Team record scope atomically to coordinator mutations', () => {
    const queryBuilder = buildQueryBuilder([
      { type: 'and', condition: 'lead.id = :id' } as TestWhereClause,
    ]);
    const internalContext = buildInternalContext({
      status: 'configured',
      managedObjectMetadataIds: [LEAD_OBJECT_ID],
      rules: [
        {
          roleId: ROLE_ID,
          objectMetadataId: LEAD_OBJECT_ID,
          ownerFieldMetadataId: 'owner-field-id',
          ownerFieldName: 'propietarioDeLead',
          ownerJoinColumnName: 'propietarioDeLeadId',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    });

    internalContext.inconnectTeamAccessMaps = coordinatorTeamAccessMaps;

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext,
      authContext,
    });

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition:
        '"lead"."propietarioDeLeadId" IN (:...inconnectRecordAccessOwnerIds_owner_field_id)',
    });
    expect(queryBuilder.capturedParameters).toEqual({
      inconnectRecordAccessOwnerIds_owner_field_id: [
        SCOTT_WORKSPACE_MEMBER_ID,
        EXECUTIVE_WORKSPACE_MEMBER_ID,
        HISTORICAL_WORKSPACE_MEMBER_ID,
      ],
    });
  });

  it('uses own-only mutation scope when Team cache is valid but coordinator has no membership', () => {
    const queryBuilder = buildQueryBuilder();
    const internalContext = buildInternalContext({
      status: 'configured',
      managedObjectMetadataIds: [LEAD_OBJECT_ID],
      rules: [
        {
          roleId: ROLE_ID,
          objectMetadataId: LEAD_OBJECT_ID,
          ownerFieldMetadataId: 'owner-field-id',
          ownerFieldName: 'propietarioDeLead',
          ownerJoinColumnName: 'propietarioDeLeadId',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    });

    internalContext.inconnectTeamAccessMaps = {
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {},
      memberWorkspaceMemberIdsByTeamId: {},
      assignableMemberWorkspaceMemberIdsByTeamId: {},
    };

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext,
      authContext,
    });

    expect(queryBuilder.capturedParameters).toEqual({
      inconnectRecordAccessOwnerIds_owner_field_id: [SCOTT_WORKSPACE_MEMBER_ID],
    });
  });

  it.each([
    ['absent', undefined],
    [
      'invalid',
      {
        version: 1,
        status: 'invalid',
        reason: 'invalid membership map',
        failureKind: 'invalid',
      },
    ],
    ['corrupt', { version: 2, status: 'valid' }],
    [
      'recomputation-failed',
      {
        version: 1,
        status: 'invalid',
        reason: 'cache unavailable',
        failureKind: 'recomputation-failed',
      },
    ],
  ])('denies coordinator mutations when Team cache is %s', (_name, maps) => {
    const queryBuilder = buildQueryBuilder([
      { type: 'and', condition: 'lead.id = :id' } as TestWhereClause,
    ]);
    const internalContext = buildInternalContext({
      status: 'configured',
      managedObjectMetadataIds: [LEAD_OBJECT_ID],
      rules: [
        {
          roleId: ROLE_ID,
          objectMetadataId: LEAD_OBJECT_ID,
          ownerFieldMetadataId: 'owner-field-id',
          ownerFieldName: 'propietarioDeLead',
          ownerJoinColumnName: 'propietarioDeLeadId',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    });

    internalContext.inconnectTeamAccessMaps =
      maps as unknown as InconnectTeamAccessMaps;

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext,
      authContext,
    });

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition: '1 = 0',
    });
  });

  it('does not add a scope for a Role without an INCONNECT policy', () => {
    const userWheres = [
      { type: 'and', condition: 'lead.id = :id' } as TestWhereClause,
    ];
    const queryBuilder = buildQueryBuilder(userWheres);

    applyInconnectRecordAccessToMutationQueryBuilder({
      queryBuilder: queryBuilder as never,
      objectMetadata: leadObjectMetadata,
      internalContext: buildInternalContext({
        status: 'not-configured',
      }),
      authContext,
    });

    expect(queryBuilder.expressionMap.wheres).toEqual(userWheres);
    expect(queryBuilder.capturedParameters).toEqual({});
  });
});
