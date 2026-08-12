import { Brackets, type ObjectLiteral } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';
import { getObjectMetadataFromEntityTarget } from 'src/engine/twenty-orm/utils/get-object-metadata-from-entity-target.util';

jest.mock(
  'src/engine/twenty-orm/utils/get-object-metadata-from-entity-target.util',
  () => ({ getObjectMetadataFromEntityTarget: jest.fn() }),
);

const LEAD_OBJECT_ID = 'lead-object-id';
const ROLE_ID = 'role-id';
const SCOTT_WORKSPACE_MEMBER_ID = 'scott-workspace-member-id';

const leadObjectMetadata = {
  id: LEAD_OBJECT_ID,
  nameSingular: 'lead',
  universalIdentifier: 'lead-universal-id',
} as FlatObjectMetadata;

const internalContext = {
  inconnectRecordAccessPolicy: {
    status: 'configured',
    rules: [
      {
        roleId: ROLE_ID,
        objectMetadataId: LEAD_OBJECT_ID,
        ownerFieldMetadataId: 'owner-field-id',
        ownerJoinColumnName: 'propietarioDeLeadId',
      },
    ],
  },
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
} as unknown as WorkspaceInternalContext;

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
} as WorkspaceAuthContext;

type TestWhereClause = {
  type: 'and' | 'or';
  condition: unknown;
  inconnectRecordAccessMarker?: string;
};

type TestQueryBuilder = WorkspaceSelectQueryBuilder<ObjectLiteral> & {
  expressionMap: WorkspaceSelectQueryBuilder<ObjectLiteral>['expressionMap'] & {
    wheres: TestWhereClause[];
  };
  capturedParameters: Record<string, unknown>;
};

const buildQueryBuilder = ({
  wheres = [],
  policy = internalContext.inconnectRecordAccessPolicy,
}: {
  wheres?: TestWhereClause[];
  policy?: WorkspaceInternalContext['inconnectRecordAccessPolicy'];
} = {}) => {
  const queryBuilder = Object.create(
    WorkspaceSelectQueryBuilder.prototype,
  ) as TestQueryBuilder;

  Object.assign(queryBuilder, {
    expressionMap: {
      mainAlias: { name: 'lead', target: 'lead' },
      wheres: [...wheres],
      joinAttributes: [],
    },
    internalContext: {
      ...internalContext,
      inconnectRecordAccessPolicy: policy,
    },
    authContext,
    capturedParameters: {},
    setParameters(parameters: Record<string, unknown>) {
      this.capturedParameters = {
        ...this.capturedParameters,
        ...parameters,
      };

      return this;
    },
    andWhere(condition: unknown) {
      this.expressionMap.wheres.push({ type: 'and', condition });

      return this;
    },
  });

  return queryBuilder;
};

const applyMainScope = (queryBuilder: TestQueryBuilder) => {
  const builderWithPrivateMethod = queryBuilder as unknown as {
    applyInconnectRecordAccessToMainAlias: () => void;
  };

  builderWithPrivateMethod.applyInconnectRecordAccessToMainAlias();
};

describe('WorkspaceSelectQueryBuilder ORM v1 INCONNECT record access', () => {
  beforeEach(() => {
    jest
      .mocked(getObjectMetadataFromEntityTarget)
      .mockReturnValue(leadObjectMetadata);
  });

  it('prepends the owner scope and groups an existing OR filter', () => {
    const userWheres: TestWhereClause[] = [
      { type: 'and', condition: '"lead"."id" = :firstId' },
      { type: 'or', condition: '"lead"."name" = :secondName' },
    ];
    const queryBuilder = buildQueryBuilder({ wheres: userWheres });

    applyMainScope(queryBuilder);

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition:
        '"lead"."propietarioDeLeadId" = :inconnectRecordAccess_owner_field_id',
    });
    expect(queryBuilder.expressionMap.wheres[1].condition).toBeInstanceOf(
      Brackets,
    );
    expect(queryBuilder.capturedParameters).toEqual({
      inconnectRecordAccess_owner_field_id: SCOTT_WORKSPACE_MEMBER_ID,
    });

    const nestedExpressionMap = { wheres: [] as TestWhereClause[] };
    const brackets = queryBuilder.expressionMap.wheres[1]
      .condition as unknown as Brackets;

    brackets.whereFactory({
      expressionMap: nestedExpressionMap,
    } as never);

    expect(nestedExpressionMap.wheres).toEqual(userWheres);
  });

  it('keeps a direct foreign ID filter subordinate to the owner scope', () => {
    const queryBuilder = buildQueryBuilder({
      wheres: [
        {
          type: 'and',
          condition: '"lead"."id" = :marcoId',
        },
      ],
    });

    applyMainScope(queryBuilder);

    expect(queryBuilder.expressionMap.wheres).toHaveLength(2);
    expect(queryBuilder.expressionMap.wheres[0].condition).toContain(
      '"lead"."propietarioDeLeadId"',
    );
    expect(queryBuilder.expressionMap.wheres[1].condition).toBeInstanceOf(
      Brackets,
    );
  });

  it('uses an always-false SQL predicate for an invalid workspace policy', () => {
    const queryBuilder = buildQueryBuilder({
      policy: { status: 'invalid', reason: 'field missing' },
    });

    applyMainScope(queryBuilder);

    expect(queryBuilder.expressionMap.wheres[0]).toMatchObject({
      type: 'and',
      condition: '1 = 0',
    });
  });

  it('applies the owner scope to the raw query shape used by search', () => {
    const queryBuilder = buildQueryBuilder({
      wheres: [
        {
          type: 'and',
          condition: '"searchVector" @@ to_tsquery(:searchTerms)',
        },
        {
          type: 'or',
          condition: '"searchVector" @@ to_tsquery(:searchTermsOr)',
        },
      ],
    });

    Object.assign(queryBuilder, {
      shouldBypassPermissionChecks: true,
      objectRecordsPermissions: {},
      featureFlagMap: {},
    });

    const builderWithPrivateMethod = queryBuilder as unknown as {
      validatePermissions: () => void;
    };

    builderWithPrivateMethod.validatePermissions();

    expect(queryBuilder.expressionMap.wheres[0].condition).toContain(
      '"lead"."propietarioDeLeadId"',
    );
    expect(queryBuilder.expressionMap.wheres[1].condition).toBeInstanceOf(
      Brackets,
    );
  });

  it('adds the owner scope to a joined Lead ON clause', () => {
    const queryBuilder = buildQueryBuilder();
    const joinAttribute = {
      alias: { name: 'joinedLead' },
      metadata: { target: 'lead' },
      condition: '"folio"."leadId" = "joinedLead"."id"',
    };

    queryBuilder.expressionMap.joinAttributes = [joinAttribute] as never;

    const builderWithPrivateMethod = queryBuilder as unknown as {
      applyInconnectRecordAccessToJoinedRelations: () => void;
    };

    builderWithPrivateMethod.applyInconnectRecordAccessToJoinedRelations();

    expect(joinAttribute.condition).toBe(
      '("folio"."leadId" = "joinedLead"."id") AND ("joinedLead"."propietarioDeLeadId" = :inconnectRecordAccess_owner_field_id)',
    );
  });
});
