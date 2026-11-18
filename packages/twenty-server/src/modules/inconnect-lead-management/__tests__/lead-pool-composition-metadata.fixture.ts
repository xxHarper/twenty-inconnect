import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RelationType,
  type ObjectsPermissionsByRoleId,
} from 'twenty-shared/types';
import { DataSource, EntitySchema, type ObjectLiteral } from 'typeorm';

import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import {
  getFlatObjectMetadataMock,
  getStandardFlatObjectMetadataMock,
} from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { type WorkspaceCacheDataMap } from 'src/engine/workspace-cache/types/workspace-cache-key.type';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';

import { actor, originId, poolId, recipientId } from './lead-pool.fixtures';

export const schema = 'workspace_test';
export const roleId = poolId(70);
export const memberObjectId = poolId(72);
export const recipientUserId = poolId(82);
export const recipientUserWorkspaceId = poolId(83);
const teamId = poolId(84);
const applicationId = poolId(73);

const toMaps = <TEntity extends { id: string; universalIdentifier: string }>(
  entities: TEntity[],
) => ({
  byUniversalIdentifier: Object.fromEntries(
    entities.map((entity) => [entity.universalIdentifier, entity]),
  ),
  universalIdentifierById: Object.fromEntries(
    entities.map((entity) => [entity.id, entity.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
});

const field = <TType extends FieldMetadataType>(
  id: number,
  name: string,
  type: TType,
  objectMetadataId = originId,
) =>
  getFlatFieldMetadataMock({
    id: poolId(id),
    universalIdentifier: poolId(id),
    name,
    type,
    objectMetadataId,
    objectMetadataUniversalIdentifier: objectMetadataId,
    applicationId,
    applicationUniversalIdentifier: applicationId,
    workspaceId: actor.workspace.id,
  });

type CompositionCacheData = Pick<
  WorkspaceCacheDataMap,
  | 'flatObjectMetadataMaps'
  | 'flatFieldMetadataMaps'
  | 'flatRoleMaps'
  | 'flatWorkspaceMemberMaps'
  | 'flatIndexMaps'
  | 'flatRowLevelPermissionPredicateMaps'
  | 'flatRowLevelPermissionPredicateGroupMaps'
  | 'rolesPermissions'
  | 'userWorkspaceRoleMap'
  | 'apiKeyRoleMap'
  | 'featureFlagsMap'
  | 'ORMEntityMetadatas'
  | 'inconnectRecordAccessPolicyMaps'
  | 'inconnectTeamAccessMaps'
>;

type CompositionMetadata = {
  lead: FlatObjectMetadata;
  leadFields: FlatFieldMetadata[];
  owner: Pick<FlatFieldMetadata, 'id'>;
  maps: CompositionCacheData;
  team: Extract<InconnectTeamAccessMaps, { status: 'valid' }>;
};

export const makeCompositionMetadata =
  async (): Promise<CompositionMetadata> => {
    const owner = {
      ...field(74, 'commercialOwner', FieldMetadataType.RELATION),
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        joinColumnName: 'commercialOwnerId',
      },
      relationTargetObjectMetadataId: memberObjectId,
      relationTargetObjectMetadataUniversalIdentifier: memberObjectId,
    };
    const label = field(75, 'name', FieldMetadataType.TEXT);
    const leadFields = [
      {
        ...field(76, 'id', FieldMetadataType.UUID),
        isUnique: true,
        isNullable: false,
      },
      field(77, 'updatedAt', FieldMetadataType.DATE_TIME),
      field(78, 'deletedAt', FieldMetadataType.DATE_TIME),
      { ...field(87, 'updatedBy', FieldMetadataType.ACTOR), isSystem: true },
      owner,
      label,
    ];
    const memberFields = [
      {
        ...field(79, 'id', FieldMetadataType.UUID, memberObjectId),
        isUnique: true,
        isNullable: false,
      },
      field(80, 'name', FieldMetadataType.FULL_NAME, memberObjectId),
      field(81, 'deletedAt', FieldMetadataType.DATE_TIME, memberObjectId),
    ];
    const lead = getFlatObjectMetadataMock({
      id: originId,
      universalIdentifier: originId,
      applicationId,
      nameSingular: 'customProspect',
      workspaceId: actor.workspace.id,
      fieldIds: leadFields.map(({ id }) => id),
      labelIdentifierFieldMetadataId: label.id,
    });
    const member = getStandardFlatObjectMetadataMock({
      id: memberObjectId,
      universalIdentifier: STANDARD_OBJECTS.workspaceMember.universalIdentifier,
      nameSingular: 'workspaceMember',
      workspaceId: actor.workspace.id,
      fieldIds: memberFields.map(({ id }) => id),
    });
    const rolesPermissions: ObjectsPermissionsByRoleId = {
      [roleId]: {
        [originId]: {
          canReadObjectRecords: true,
          canUpdateObjectRecords: true,
          canSoftDeleteObjectRecords: false,
          canDestroyObjectRecords: false,
          restrictedFields: {},
          rowLevelPermissionPredicates: [],
          rowLevelPermissionPredicateGroups: [],
        },
        [memberObjectId]: {
          canReadObjectRecords: true,
          canUpdateObjectRecords: false,
          canSoftDeleteObjectRecords: false,
          canDestroyObjectRecords: false,
          restrictedFields: {},
          rowLevelPermissionPredicates: [],
          rowLevelPermissionPredicateGroups: [],
        },
      },
    };
    const policy: InconnectRecordAccessPolicyMaps = {
      version: 1,
      status: 'valid',
      revision: '1',
      enforcementMode: 'MANAGED',
      managedObjects: [
        {
          id: poolId(85),
          objectMetadataId: originId,
          ownerFieldMetadataId: owner.id,
          ownerFieldName: owner.name,
          ownerJoinColumnName: 'commercialOwnerId',
          ownerRequirement: 'required',
          policies: [
            {
              id: poolId(86),
              roleId,
              recordEffect: 'ownAndTeamRecords',
              createPolicy: 'denied',
              ownerTransferPolicy: 'assignableOwners',
              missingOwnerPolicy: 'requireExplicit',
            },
          ],
        },
      ],
    };
    const team: Extract<InconnectTeamAccessMaps, { status: 'valid' }> = {
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {
        [actor.workspaceMemberId]: {
          teamId,
          membershipType: 'COORDINATOR',
          isWorkspaceMemberAssignable: true,
        },
        [recipientId]: {
          teamId,
          membershipType: 'EXECUTIVE',
          isWorkspaceMemberAssignable: true,
        },
      },
      memberWorkspaceMemberIdsByTeamId: {
        [teamId]: [actor.workspaceMemberId, recipientId],
      },
      assignableMemberWorkspaceMemberIdsByTeamId: {
        [teamId]: [actor.workspaceMemberId, recipientId],
      },
    };
    const entitySchemaSource = new DataSource({
      type: 'postgres',
      entities: [
        new EntitySchema<ObjectLiteral>({
          name: lead.nameSingular,
          tableName: computeObjectTargetTable(lead),
          schema,
          columns: {
            id: { type: 'uuid', primary: true },
            commercialOwnerId: { type: 'uuid' },
            name: { type: String },
            updatedAt: { type: 'timestamptz', updateDate: true },
            deletedAt: {
              type: 'timestamptz',
              nullable: true,
              deleteDate: true,
            },
            updatedBySource: { type: String, nullable: true },
            updatedByName: { type: String, nullable: true },
            updatedByWorkspaceMemberId: { type: 'uuid', nullable: true },
            updatedByContext: { type: 'jsonb', nullable: true },
          },
          relations: {
            commercialOwner: {
              type: 'many-to-one',
              target: member.nameSingular,
              joinColumn: { name: 'commercialOwnerId' },
            },
          },
        }),
        new EntitySchema({
          name: member.nameSingular,
          tableName: computeObjectTargetTable(member),
          schema,
          columns: {
            id: { type: 'uuid', primary: true },
            deletedAt: {
              type: 'timestamptz',
              nullable: true,
              deleteDate: true,
            },
          },
        }),
      ],
    });

    // Build the TypeORM metadata graph in memory. The primary datasource uses it via workspace context.
    await entitySchemaSource['buildMetadatas']();

    const maps = {
      flatObjectMetadataMaps: toMaps([lead, member]),
      flatFieldMetadataMaps: toMaps([...leadFields, ...memberFields]),
      flatRoleMaps: toMaps([
        {
          id: roleId,
          universalIdentifier: roleId,
          workspaceId: actor.workspace.id,
        },
      ]),
      flatWorkspaceMemberMaps: {
        byId: { [recipientId]: { id: recipientId, userId: recipientUserId } },
      },
      flatIndexMaps: toMaps([]),
      flatRowLevelPermissionPredicateMaps: toMaps([]),
      flatRowLevelPermissionPredicateGroupMaps: toMaps([]),
      rolesPermissions,
      userWorkspaceRoleMap: {
        [actor.userWorkspaceId]: roleId,
        [recipientUserWorkspaceId]: roleId,
      },
      apiKeyRoleMap: {},
      featureFlagsMap: {},
      ORMEntityMetadatas: entitySchemaSource.entityMetadatas,
      inconnectRecordAccessPolicyMaps: policy,
      inconnectTeamAccessMaps: team,
    } as unknown as CompositionCacheData;

    return { lead, leadFields, owner, maps, team };
  };
