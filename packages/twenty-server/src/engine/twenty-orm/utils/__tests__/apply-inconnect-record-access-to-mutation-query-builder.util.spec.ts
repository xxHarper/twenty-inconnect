import { Brackets } from 'typeorm';
import { type WhereClause } from 'typeorm/query-builder/WhereClause';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { applyInconnectRecordAccessToMutationQueryBuilder } from 'src/engine/twenty-orm/utils/apply-inconnect-record-access-to-mutation-query-builder.util';

const LEAD_OBJECT_ID = 'lead-object-id';
const ROLE_ID = 'role-id';
const SCOTT_WORKSPACE_MEMBER_ID = 'scott-workspace-member-id';

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  nameSingular: 'lead',
} as FlatObjectMetadata;

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
} as WorkspaceAuthContext;

const buildInternalContext = (
  policy: WorkspaceInternalContext['inconnectRecordAccessPolicy'] = {
    status: 'configured',
    rules: [
      {
        roleId: ROLE_ID,
        objectMetadataId: LEAD_OBJECT_ID,
        ownerFieldMetadataId: 'owner-field-id',
        ownerFieldName: 'propietarioDeLead',
        ownerJoinColumnName: 'propietarioDeLeadId',
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
        '"_lead"."propietarioDeLeadId" = :inconnectRecordAccess_owner_field_id',
    });
    expect(queryBuilder.expressionMap.wheres[1].condition).toBeInstanceOf(
      Brackets,
    );
    expect(queryBuilder.capturedParameters).toEqual({
      inconnectRecordAccess_owner_field_id: SCOTT_WORKSPACE_MEMBER_ID,
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
