import { FieldMetadataType } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { type InconnectRecordAccessConfig } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
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
  workspaceMemberId: 'scott-workspace-member-id',
} as WorkspaceAuthContext;

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
      kind: 'scoped',
      ownerFieldMetadataId: OWNER_FIELD_ID,
      ownerFieldName: 'propietarioDeLead',
      ownerJoinColumnName: 'propietarioDeLeadId',
      workspaceMemberId: 'scott-workspace-member-id',
    });
  });

  it('leaves a Role without an INCONNECT rule unrestricted', () => {
    expect(
      resolveInconnectRecordAccessDecision({
        policy: resolvePolicy(),
        authContext: userAuthContext,
        objectMetadataId: LEAD_OBJECT_ID,
        userWorkspaceRoleMap: { 'user-workspace-id': 'another-role-id' },
        apiKeyRoleMap: {},
      }),
    ).toEqual({ kind: 'unrestricted' });
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
    ).toEqual({ kind: 'denied' });
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
    ).toEqual({ kind: 'denied' });
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
    ).toEqual({ kind: 'unrestricted' });
  });
});
