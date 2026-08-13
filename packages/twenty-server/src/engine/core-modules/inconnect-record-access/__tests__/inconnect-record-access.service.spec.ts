import { FieldMetadataType } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectRecordAccessConfig } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
import { renderInconnectRecordAccessCondition } from 'src/engine/core-modules/inconnect-record-access/utils/render-inconnect-record-access-condition.util';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';

const WORKSPACE_ID = 'workspace-id';
const ROLE_ID = 'role-id';
const ROLE_UNIVERSAL_IDENTIFIER = 'role-universal-id';
const LEAD_OBJECT_ID = 'lead-object-id';
const LEAD_OBJECT_UNIVERSAL_IDENTIFIER = 'lead-object-universal-id';
const OWNER_FIELD_ID = 'owner-field-id';
const OWNER_FIELD_UNIVERSAL_IDENTIFIER = 'owner-field-universal-id';
const WORKSPACE_MEMBER_OBJECT_ID = 'workspace-member-object-id';
const WORKSPACE_MEMBER_OBJECT_UNIVERSAL_IDENTIFIER =
  'workspace-member-object-universal-id';

const COORDINATOR_WORKSPACE_MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTIVE_A_WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTIVE_B_WORKSPACE_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const buildFlatEntityMaps = <
  TEntity extends FlatRole | FlatObjectMetadata | FlatFieldMetadata,
>(
  entities: TEntity[],
): FlatEntityMaps<TEntity> => ({
  byUniversalIdentifier: Object.fromEntries(
    entities.map((entity) => [entity.universalIdentifier, entity]),
  ),
  universalIdentifierById: Object.fromEntries(
    entities.map((entity) => [entity.id, entity.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
});

const role = {
  id: ROLE_ID,
  universalIdentifier: ROLE_UNIVERSAL_IDENTIFIER,
} as FlatRole;

const leadObject = {
  id: LEAD_OBJECT_ID,
  universalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'lead',
} as FlatObjectMetadata;

const workspaceMemberObject = {
  id: WORKSPACE_MEMBER_OBJECT_ID,
  universalIdentifier: WORKSPACE_MEMBER_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'workspaceMember',
} as FlatObjectMetadata;

const ownerField = {
  id: OWNER_FIELD_ID,
  universalIdentifier: OWNER_FIELD_UNIVERSAL_IDENTIFIER,
  objectMetadataId: LEAD_OBJECT_ID,
  name: 'propietarioDeLead',
  type: FieldMetadataType.RELATION,
  settings: { relationType: RelationType.MANY_TO_ONE },
  relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
} as FlatFieldMetadata<FieldMetadataType.RELATION>;

const config: InconnectRecordAccessConfig = {
  workspaces: [
    {
      workspaceId: WORKSPACE_ID,
      rules: [
        {
          roleUniversalIdentifier: ROLE_UNIVERSAL_IDENTIFIER,
          objectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
          ownerFieldUniversalIdentifier: OWNER_FIELD_UNIVERSAL_IDENTIFIER,
          principal: 'workspaceMember',
          effect: 'ownerEqualsAuthenticatedWorkspaceMember',
        },
      ],
    },
  ],
};

const configWithEffect = (
  effect: InconnectRecordAccessConfig['workspaces'][number]['rules'][number]['effect'],
): InconnectRecordAccessConfig => ({
  workspaces: [
    {
      workspaceId: WORKSPACE_ID,
      rules: [
        {
          ...config.workspaces[0].rules[0],
          effect,
        } as InconnectRecordAccessConfig['workspaces'][number]['rules'][number],
      ],
    },
  ],
});

const buildService = (configuredValue: unknown = config) =>
  new InconnectRecordAccessService({
    get: jest.fn(() => configuredValue),
  } as unknown as TwentyConfigService);

const resolvePolicy = ({
  configuredValue = config,
  roles = [role],
  objects = [leadObject, workspaceMemberObject],
  fields = [ownerField],
}: {
  configuredValue?: unknown;
  roles?: FlatRole[];
  objects?: FlatObjectMetadata[];
  fields?: FlatFieldMetadata[];
} = {}) =>
  buildService(configuredValue).resolveWorkspacePolicy({
    workspaceId: WORKSPACE_ID,
    flatRoleMaps: buildFlatEntityMaps(roles),
    flatObjectMetadataMaps: buildFlatEntityMaps(objects),
    flatFieldMetadataMaps: buildFlatEntityMaps(fields),
  });

const userAuthContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: COORDINATOR_WORKSPACE_MEMBER_ID,
} as WorkspaceAuthContext;

const coordinatorTeamAccessMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [COORDINATOR_WORKSPACE_MEMBER_ID]: {
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
      COORDINATOR_WORKSPACE_MEMBER_ID,
      EXECUTIVE_A_WORKSPACE_MEMBER_ID,
      EXECUTIVE_B_WORKSPACE_MEMBER_ID,
    ],
  },
  assignableMemberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [
      COORDINATOR_WORKSPACE_MEMBER_ID,
      EXECUTIVE_A_WORKSPACE_MEMBER_ID,
    ],
  },
};

const noMembershipTeamAccessMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {},
  memberWorkspaceMemberIdsByTeamId: {},
  assignableMemberWorkspaceMemberIdsByTeamId: {},
};

const executiveTeamAccessMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [COORDINATOR_WORKSPACE_MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: true,
    },
  },
  memberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [COORDINATOR_WORKSPACE_MEMBER_ID],
  },
  assignableMemberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [COORDINATOR_WORKSPACE_MEMBER_ID],
  },
};

describe('InconnectRecordAccessService', () => {
  it('resolves Role, Lead and owner field by universal identifier', () => {
    expect(resolvePolicy()).toEqual({
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
    });
  });

  it('does not configure workspaces absent from the environment config', () => {
    const policy = buildService(config).resolveWorkspacePolicy({
      workspaceId: 'another-workspace-id',
      flatRoleMaps: buildFlatEntityMaps([role]),
      flatObjectMetadataMaps: buildFlatEntityMaps([
        leadObject,
        workspaceMemberObject,
      ]),
      flatFieldMetadataMaps: buildFlatEntityMaps([ownerField]),
    });

    expect(policy).toEqual({ status: 'not-configured' });
  });

  it.each([
    ['missing role', { roles: [] }],
    ['missing object', { objects: [workspaceMemberObject] }],
    ['missing owner field', { fields: [] }],
    [
      'owner field on another object',
      {
        fields: [
          { ...ownerField, objectMetadataId: 'another-object-id' },
        ] as FlatFieldMetadata[],
      },
    ],
    [
      'owner field with wrong cardinality',
      {
        fields: [
          {
            ...ownerField,
            settings: { relationType: RelationType.ONE_TO_MANY },
          },
        ] as FlatFieldMetadata[],
      },
    ],
    [
      'owner field targeting a non-member object',
      {
        objects: [
          leadObject,
          { ...workspaceMemberObject, nameSingular: 'person' },
        ] as FlatObjectMetadata[],
      },
    ],
  ])('fails closed for an invalid configured %s', (_name, overrides) => {
    expect(resolvePolicy(overrides)).toMatchObject({ status: 'invalid' });
  });

  it('scopes a matching user Role to its authenticated Workspace Member', () => {
    const decision = resolveInconnectRecordAccessDecision({
      policy: resolvePolicy(),
      authContext: userAuthContext,
      objectMetadataId: LEAD_OBJECT_ID,
      userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
      apiKeyRoleMap: {},
    });

    expect(decision).toEqual({
      kind: 'owner-workspace-member-ids',
      ownerFieldMetadataId: OWNER_FIELD_ID,
      ownerFieldName: 'propietarioDeLead',
      ownerJoinColumnName: 'propietarioDeLeadId',
      authenticatedWorkspaceMemberId: COORDINATOR_WORKSPACE_MEMBER_ID,
      recordScopeOwnerWorkspaceMemberIds: [COORDINATOR_WORKSPACE_MEMBER_ID],
      assignableOwnerWorkspaceMemberIds: [COORDINATOR_WORKSPACE_MEMBER_ID],
      createPolicy: 'denied',
      ownerTransferPolicy: 'denied',
      sourceRecordEffect: 'ownRecords',
    });
  });

  it('accepts the legacy owner effect as an alias for ownRecords', () => {
    expect(resolvePolicy()).toMatchObject({
      status: 'configured',
      rules: [
        {
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
        },
      ],
    });
  });

  it('accepts recordEffect and resolves explicit operation policies independently', () => {
    const policy = resolvePolicy({
      configuredValue: {
        workspaces: [
          {
            workspaceId: WORKSPACE_ID,
            rules: [
              {
                roleUniversalIdentifier: ROLE_UNIVERSAL_IDENTIFIER,
                objectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
                ownerFieldUniversalIdentifier: OWNER_FIELD_UNIVERSAL_IDENTIFIER,
                principal: 'workspaceMember',
                recordEffect: 'allRecords',
                createPolicy: 'standardPermissionsOnly',
                ownerTransferPolicy: 'standardPermissionsOnly',
              },
            ],
          },
        ],
      },
    });

    expect(policy).toMatchObject({
      status: 'configured',
      rules: [
        {
          recordEffect: 'allRecords',
          createPolicy: 'standardPermissionsOnly',
          ownerTransferPolicy: 'standardPermissionsOnly',
        },
      ],
    });
  });

  it.each([
    [
      'unknown create policy',
      {
        ...config.workspaces[0].rules[0],
        createPolicy: 'unknown',
      },
    ],
    [
      'unknown owner transfer policy',
      {
        ...config.workspaces[0].rules[0],
        ownerTransferPolicy: 'unknown',
      },
    ],
    [
      'conflicting effect aliases',
      {
        ...config.workspaces[0].rules[0],
        recordEffect: 'allRecords',
      },
    ],
  ])('fails closed for %s', (_name, rule) => {
    expect(
      resolvePolicy({
        configuredValue: {
          workspaces: [{ workspaceId: WORKSPACE_ID, rules: [rule] }],
        },
      }),
    ).toMatchObject({ status: 'invalid' });
  });

  it('resolves operation policies independently for a second managed object', () => {
    const folioObject = {
      ...leadObject,
      id: 'folio-object-id',
      universalIdentifier: 'folio-object-universal-id',
      nameSingular: 'folioIso',
    } as FlatObjectMetadata;
    const folioOwnerField = {
      ...ownerField,
      id: 'folio-owner-field-id',
      universalIdentifier: 'folio-owner-field-universal-id',
      objectMetadataId: folioObject.id,
      name: 'propietarioDeFolioIso',
    } as FlatFieldMetadata<FieldMetadataType.RELATION>;

    const policy = resolvePolicy({
      configuredValue: {
        workspaces: [
          {
            workspaceId: WORKSPACE_ID,
            rules: [
              {
                ...config.workspaces[0].rules[0],
                createPolicy: 'denied',
                ownerTransferPolicy: 'denied',
              },
              {
                roleUniversalIdentifier: ROLE_UNIVERSAL_IDENTIFIER,
                objectUniversalIdentifier: folioObject.universalIdentifier,
                ownerFieldUniversalIdentifier:
                  folioOwnerField.universalIdentifier,
                principal: 'workspaceMember',
                recordEffect: 'ownRecords',
                createPolicy: 'defaultOwner',
                ownerTransferPolicy: 'assignableOwners',
              },
            ],
          },
        ],
      },
      objects: [leadObject, folioObject, workspaceMemberObject],
      fields: [ownerField, folioOwnerField],
    });

    expect(policy).toMatchObject({
      status: 'configured',
      rules: [
        {
          objectMetadataId: LEAD_OBJECT_ID,
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
        },
        {
          objectMetadataId: folioObject.id,
          createPolicy: 'defaultOwner',
          ownerTransferPolicy: 'assignableOwners',
        },
      ],
    });
  });

  it('does not manage an object absent from the workspace rules', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy(),
        authContext: userAuthContext,
        objectMetadataId: 'unmanaged-object-id',
        userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
        apiKeyRoleMap: {},
      }),
    ).toEqual({ kind: 'not-managed' });
  });

  it('resolves allRecords only when explicitly configured for the Role', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy({
          configuredValue: configWithEffect('allRecords'),
        }),
        authContext: userAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
        apiKeyRoleMap: {},
      }),
    ).toMatchObject({
      kind: 'all-records',
      createPolicy: 'denied',
      ownerTransferPolicy: 'denied',
      sourceRecordEffect: 'allRecords',
    });
  });

  it('expands ownAndTeamRecords for a coordinator using record-scope members', () => {
    const decision = resolveInconnectRecordAccessDecision({
      policy: resolvePolicy({
        configuredValue: configWithEffect('ownAndTeamRecords'),
      }),
      authContext: userAuthContext,
      objectMetadataId: LEAD_OBJECT_ID,
      userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
      apiKeyRoleMap: {},
      inconnectTeamAccessMaps: coordinatorTeamAccessMaps,
    });

    expect(decision).toMatchObject({
      kind: 'owner-workspace-member-ids',
      sourceRecordEffect: 'ownAndTeamRecords',
      recordScopeOwnerWorkspaceMemberIds: [
        COORDINATOR_WORKSPACE_MEMBER_ID,
        EXECUTIVE_A_WORKSPACE_MEMBER_ID,
        EXECUTIVE_B_WORKSPACE_MEMBER_ID,
      ],
      assignableOwnerWorkspaceMemberIds: [COORDINATOR_WORKSPACE_MEMBER_ID],
    });
    expect(
      renderInconnectRecordAccessCondition({
        decision,
        tableAlias: 'lead',
      }),
    ).toMatchObject({
      sql: '"lead"."propietarioDeLeadId" IN (:...inconnectRecordAccessOwnerIds_owner_field_id)',
      parameters: {
        inconnectRecordAccessOwnerIds_owner_field_id: [
          COORDINATOR_WORKSPACE_MEMBER_ID,
          EXECUTIVE_A_WORKSPACE_MEMBER_ID,
          EXECUTIVE_B_WORKSPACE_MEMBER_ID,
        ],
      },
    });
  });

  it('expands destination owners only when an operation policy requests it', () => {
    const configuredValue = configWithEffect('ownAndTeamRecords');

    configuredValue.workspaces[0].rules[0].createPolicy = 'assignableOwners';

    const decision = resolveInconnectRecordAccessDecision({
      policy: resolvePolicy({ configuredValue }),
      authContext: userAuthContext,
      objectMetadataId: LEAD_OBJECT_ID,
      userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
      apiKeyRoleMap: {},
      inconnectTeamAccessMaps: coordinatorTeamAccessMaps,
    });

    expect(decision).toMatchObject({
      recordScopeOwnerWorkspaceMemberIds: [
        COORDINATOR_WORKSPACE_MEMBER_ID,
        EXECUTIVE_A_WORKSPACE_MEMBER_ID,
        EXECUTIVE_B_WORKSPACE_MEMBER_ID,
      ],
      assignableOwnerWorkspaceMemberIds: [
        COORDINATOR_WORKSPACE_MEMBER_ID,
        EXECUTIVE_A_WORKSPACE_MEMBER_ID,
      ],
      createPolicy: 'assignableOwners',
      ownerTransferPolicy: 'denied',
    });
  });

  it.each([
    ['without a membership', noMembershipTeamAccessMaps],
    ['with an EXECUTIVE membership', executiveTeamAccessMaps],
  ])('keeps ownAndTeamRecords scoped to self %s', (_name, teamAccessMaps) => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy({
          configuredValue: configWithEffect('ownAndTeamRecords'),
        }),
        authContext: userAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
        apiKeyRoleMap: {},
        inconnectTeamAccessMaps: teamAccessMaps,
      }),
    ).toMatchObject({
      kind: 'owner-workspace-member-ids',
      sourceRecordEffect: 'ownAndTeamRecords',
      recordScopeOwnerWorkspaceMemberIds: [COORDINATOR_WORKSPACE_MEMBER_ID],
      assignableOwnerWorkspaceMemberIds: [COORDINATOR_WORKSPACE_MEMBER_ID],
    });
  });

  it.each([
    ['absent', undefined],
    [
      'invalid',
      {
        version: 1,
        status: 'invalid',
        reason: 'invalid memberships',
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
  ])(
    'denies ownAndTeamRecords when Team cache is %s',
    (_name, teamAccessMaps) => {
      expect(
        resolveInconnectRecordAccessDecision({
          policy: resolvePolicy({
            configuredValue: configWithEffect('ownAndTeamRecords'),
          }),
          authContext: userAuthContext,
          objectMetadataId: LEAD_OBJECT_ID,
          userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
          apiKeyRoleMap: {},
          inconnectTeamAccessMaps: teamAccessMaps,
        }),
      ).toMatchObject({ kind: 'denied' });
    },
  );

  it('fails closed when the same Role and object are configured twice', () => {
    const duplicateRule = config.workspaces[0].rules[0];

    expect(
      resolvePolicy({
        configuredValue: {
          workspaces: [
            {
              workspaceId: WORKSPACE_ID,
              rules: [duplicateRule, duplicateRule],
            },
          ],
        },
      }),
    ).toMatchObject({ status: 'invalid' });
  });

  it('denies a Role without a rule on an INCONNECT-managed object', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy(),
        authContext: userAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: { 'user-workspace-id': 'another-role-id' },
        apiKeyRoleMap: {},
      }),
    ).toMatchObject({ kind: 'denied' });
  });

  it('denies a matching API key Role because it has no Workspace Member', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy(),
        authContext: {
          type: 'apiKey',
          workspace: { id: WORKSPACE_ID },
          apiKey: { id: 'api-key-id' },
        } as WorkspaceAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: {},
        apiKeyRoleMap: { 'api-key-id': ROLE_ID },
      }),
    ).toMatchObject({ kind: 'denied' });
  });

  it('denies non-system reads when configured metadata is invalid', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: { status: 'invalid', reason: 'missing field' },
        authContext: userAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
        apiKeyRoleMap: {},
      }),
    ).toMatchObject({ kind: 'denied' });
  });

  it('keeps the trusted system context unrestricted', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: { status: 'invalid', reason: 'missing field' },
        authContext: {
          type: 'system',
          workspace: { id: WORKSPACE_ID },
        } as WorkspaceAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: {},
        apiKeyRoleMap: {},
      }),
    ).toEqual({ kind: 'system-bypass' });
  });
});
