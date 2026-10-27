import { FieldMetadataType } from 'twenty-shared/types';

import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { LeadPoolAuthorityService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import { actor, originId, poolId, recipientId } from './lead-pool.fixtures';

export const makeAuthorityHarness = () => {
  const roleId = poolId(70),
    targetId = poolId(71),
    recipientRoleId = poolId(72);
  const object = {
    id: originId,
    workspaceId: actor.workspace.id,
    nameSingular: 'customProspect',
    namePlural: 'customProspects',
    labelPlural: 'Prospectos',
    applicationId: poolId(73),
    applicationUniversalIdentifier: poolId(73),
    isActive: true,
    isRemote: false,
    isSystem: false,
    labelIdentifierFieldMetadataId: poolId(75),
  };
  const owner = {
    id: poolId(74),
    universalIdentifier: poolId(74),
    workspaceId: actor.workspace.id,
    objectMetadataId: originId,
    name: 'commercialOwner',
    label: 'Owner',
    type: FieldMetadataType.RELATION,
    isActive: true,
    settings: { relationType: 'MANY_TO_ONE' },
    relationTargetObjectMetadataId: targetId,
  };
  const label = {
    id: poolId(75),
    universalIdentifier: poolId(75),
    workspaceId: actor.workspace.id,
    objectMetadataId: originId,
    name: 'name',
    label: 'Nombre',
    type: FieldMetadataType.TEXT,
    isActive: true,
    settings: null,
  };
  const status = {
    ...label,
    id: poolId(76),
    universalIdentifier: poolId(76),
    name: 'stage',
    label: 'Estado',
    type: FieldMetadataType.SELECT,
    options: [
      {
        id: poolId(77),
        value: 'PENDING',
        label: 'Pendiente',
        color: 'red',
        position: 0,
      },
    ],
  };
  const boolean = {
    ...label,
    id: poolId(78),
    universalIdentifier: poolId(78),
    name: 'corporate',
    label: 'Clasificación comercial',
    type: FieldMetadataType.BOOLEAN,
  };
  const date = {
    ...label,
    id: poolId(79),
    universalIdentifier: poolId(79),
    name: 'attemptedAt',
    label: 'Último intento',
    type: FieldMetadataType.DATE_TIME,
  };
  const fields = [owner, label, status, boolean, date];
  const flatFields = [
    ...structuredClone(fields),
    {
      ...label,
      id: poolId(80),
      universalIdentifier: poolId(80),
      objectMetadataId: targetId,
      type: FieldMetadataType.FULL_NAME,
    },
  ];
  const flatObjects = [
    object,
    {
      id: targetId,
      workspaceId: actor.workspace.id,
      nameSingular: 'workspaceMember',
    },
  ];
  const maps = {
    flatObjectMetadataMaps: {
      byUniversalIdentifier: Object.fromEntries(
        flatObjects.map((entry) => [entry.id, structuredClone(entry)]),
      ),
      universalIdentifierById: Object.fromEntries(
        flatObjects.map((entry) => [entry.id, entry.id]),
      ),
    },
    flatFieldMetadataMaps: {
      byUniversalIdentifier: Object.fromEntries(
        flatFields.map((entry) => [entry.id, entry]),
      ),
      universalIdentifierById: Object.fromEntries(
        flatFields.map((entry) => [entry.id, entry.id]),
      ),
    },
    flatRoleMaps: {
      byUniversalIdentifier: {
        [roleId]: {
          id: roleId,
          workspaceId: actor.workspace.id,
          label: 'Any label',
        },
      },
      universalIdentifierById: {
        [roleId]: roleId,
        [recipientRoleId]: recipientRoleId,
      },
    },
    userWorkspaceRoleMap: {
      [actor.userWorkspaceId]: roleId,
      [poolId(83)]: recipientRoleId,
    },
    apiKeyRoleMap: {},
    rolesPermissions: {
      [roleId]: {
        [originId]: {
          canReadObjectRecords: true,
          canUpdateObjectRecords: true,
          canSoftDeleteObjectRecords: false,
          canDestroyObjectRecords: false,
          restrictedFields: {} as Record<
            string,
            { canRead?: boolean; canUpdate?: boolean }
          >,
        },
        [targetId]: {
          canReadObjectRecords: true,
          restrictedFields: {} as Record<string, { canRead?: boolean }>,
        },
      },
    },
    flatWorkspaceMemberMaps: {
      byId: { [recipientId]: { id: recipientId, userId: poolId(82) } },
    },
    inconnectTeamAccessMaps: {
      version: 1,
      status: 'valid',
      membershipByWorkspaceMemberId: {
        [actor.workspaceMemberId]: {
          teamId: poolId(84),
          membershipType: 'COORDINATOR',
          isWorkspaceMemberAssignable: true,
        },
        [recipientId]: {
          teamId: poolId(84),
          membershipType: 'EXECUTIVE',
          isWorkspaceMemberAssignable: true,
        },
      },
      memberWorkspaceMemberIdsByTeamId: {
        [poolId(84)]: [actor.workspaceMemberId, recipientId],
      },
      assignableMemberWorkspaceMemberIdsByTeamId: {
        [poolId(84)]: [actor.workspaceMemberId, recipientId],
      },
    },
  };
  const rule = {
    roleId,
    objectMetadataId: originId,
    ownerFieldMetadataId: owner.id,
    ownerFieldName: owner.name,
    ownerJoinColumnName: 'commercialOwnerId',
    recordEffect: 'allRecords',
    createPolicy: 'denied',
    ownerTransferPolicy: 'standardPermissionsOnly',
    ownerRequirement: 'required',
    missingOwnerPolicy: 'requireExplicit',
  } as const;
  const policy: InconnectRecordAccessWorkspacePolicy = {
    status: 'configured',
    managedObjectMetadataIds: [originId],
    rules: [{ ...rule }],
  };
  const profile = {
    id: recipientId,
    firstName: 'Ejecutivo',
    lastName: 'Autorizado',
    isAssignable: true,
  };
  const userWorkspaces = [
    {
      id: actor.userWorkspaceId,
      userId: actor.user.id,
      workspaceId: actor.workspace.id,
      deletedAt: null,
    },
    {
      id: poolId(83),
      userId: poolId(82),
      workspaceId: actor.workspace.id,
      deletedAt: null,
    },
  ];
  const repos = {
    workspace: {
      findOne: jest.fn(async () => ({
        id: actor.workspace.id,
        databaseSchema: actor.workspace.databaseSchema,
      })),
    },
    object: { findOne: jest.fn(async () => object) },
    field: { find: jest.fn(async () => fields) },
    userWorkspace: {
      findOne: jest.fn(async () => userWorkspaces[0]),
      find: jest.fn(async () => userWorkspaces),
    },
  };
  const dataSource = {
    manager: {},
    getRepository: (entity: unknown) => {
      if (entity === WorkspaceEntity) return repos.workspace;
      if (entity === ObjectMetadataEntity) return repos.object;
      if (entity === FieldMetadataEntity) return repos.field;
      if (entity === UserWorkspaceEntity) return repos.userWorkspace;
      throw new Error('Unexpected entity access');
    },
  };
  const cache = { getOrRecompute: jest.fn(async () => maps) };
  const recordAccess = {
    isAuthenticatedWorkspaceMemberValid: jest.fn(async () => true),
  };
  const members = {
    getAssignableWorkspaceMemberProfiles: jest.fn(async () => [profile]),
  };
  const service = new LeadPoolAuthorityService(
    dataSource as never,
    cache as never,
    { resolveWorkspacePolicy: async () => policy } as never,
    recordAccess as never,
    members as never,
  );
  return {
    service,
    maps,
    policy,
    roleId,
    targetId,
    recipientRoleId,
    owner,
    label,
    status,
    boolean,
    date,
    fields,
    profile,
    members,
    repos,
    recordAccess,
    object,
  };
};
