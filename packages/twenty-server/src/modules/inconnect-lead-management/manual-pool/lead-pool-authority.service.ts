import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { createHash } from 'crypto';
import { FieldMetadataType, type LeadPoolField } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { validateInconnectRecordAccessUpdateValues } from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';
import { doesInconnectRecordAccessPolicyRequireTeamAuthority } from 'src/engine/core-modules/inconnect-record-access/utils/does-inconnect-record-access-policy-require-team-authority.util';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

export const hashLeadPoolValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const denyLeadPool = (): never => {
  throw new ForbiddenException(
    'Lead Management unavailable: current authority or metadata does not permit this operation',
  );
};

export type LeadPoolAuthority = {
  context: CommonBaseQueryRunnerContext;
  schema: string;
  owner: FieldMetadataEntity;
  ownerColumn: string;
  labelField: FieldMetadataEntity;
  fields: FieldMetadataEntity[];
  publicFields: LeadPoolField[];
  recipients: { id: string; label: string }[];
  decision: InconnectRecordAccessDecision;
  hash: string;
};

@Injectable()
export class LeadPoolAuthorityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cache: WorkspaceCacheService,
    private readonly policySource: InconnectRecordAccessPolicySourceService,
    private readonly recordAccess: InconnectRecordAccessAuthorizationService,
    private readonly members: InconnectWorkspaceMemberService,
  ) {}

  async assertHuman(authContext: WorkspaceAuthContext) {
    // Browser human sessions only. Application/API/system tokens cannot acquire a grant here.
    if (
      !isUserAuthContext(authContext) ||
      authContext.application !== undefined ||
      authContext.workspaceMember.userId !== authContext.user.id ||
      !(await this.recordAccess.isAuthenticatedWorkspaceMemberValid({
        authContext,
        workspaceId: authContext.workspace.id,
      }))
    )
      return denyLeadPool();
    const userWorkspace = await this.dataSource
      .getRepository(UserWorkspaceEntity)
      .findOne({
        where: {
          id: authContext.userWorkspaceId,
          workspaceId: authContext.workspace.id,
          userId: authContext.user.id,
        },
      });
    if (!userWorkspace || userWorkspace.deletedAt) return denyLeadPool();
    return authContext;
  }

  async getManagedObjectIds(
    authContext: WorkspaceAuthContext,
  ): Promise<string[]> {
    await this.assertHuman(authContext);
    const maps = await this.cache.getOrRecompute(authContext.workspace.id, [
      'flatRoleMaps',
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
    ]);
    const policy = await this.policySource.resolveWorkspacePolicy({
      workspaceId: authContext.workspace.id,
      ...maps,
    });
    return policy.status === 'configured'
      ? [...policy.managedObjectMetadataIds]
      : [];
  }

  async resolve(
    authContext: WorkspaceAuthContext,
    objectId: string,
    options: { requireRecipientRead: boolean } = { requireRecipientRead: true },
  ): Promise<LeadPoolAuthority> {
    const human = await this.assertHuman(authContext);
    const workspaceId = human.workspace.id;
    const maps = await this.cache.getOrRecompute(workspaceId, [
      'flatRoleMaps',
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'userWorkspaceRoleMap',
      'apiKeyRoleMap',
      'rolesPermissions',
      'flatWorkspaceMemberMaps',
    ]);
    const rolePermissionConfig = resolveRolePermissionConfig({
      authContext,
      ...maps,
    });
    if (
      !rolePermissionConfig ||
      'shouldBypassPermissionChecks' in rolePermissionConfig
    )
      return denyLeadPool();
    const permissions = getObjectsPermissionsFromRolePermissionConfig({
      rolePermissionConfig,
      rolesPermissions: maps.rolesPermissions,
    });
    const objectPermission = permissions[objectId];
    if (
      objectPermission?.canReadObjectRecords !== true ||
      objectPermission.canUpdateObjectRecords !== true
    )
      return denyLeadPool();
    const policy = await this.policySource.resolveWorkspacePolicy({
      workspaceId,
      ...maps,
    });
    const needsTeam = doesInconnectRecordAccessPolicyRequireTeamAuthority({
      policy,
      authContext,
      ...maps,
    });
    const teamMaps = needsTeam
      ? (
          await this.cache.getOrRecompute(workspaceId, [
            'inconnectTeamAccessMaps',
          ])
        ).inconnectTeamAccessMaps
      : undefined;
    const decision = resolveInconnectRecordAccessDecision({
      policy,
      authContext,
      objectMetadataId: objectId,
      ...maps,
      inconnectTeamAccessMaps: teamMaps,
    });
    // An explicit managed origin supplies the owner identity; no object-name heuristics.
    if (
      (decision.kind !== 'all-records' &&
        decision.kind !== 'owner-workspace-member-ids') ||
      decision.ownerTransferPolicy === 'denied'
    )
      return denyLeadPool();
    const [workspace, liveObject, fields] = await Promise.all([
      this.dataSource
        .getRepository(WorkspaceEntity)
        .findOne({ where: { id: workspaceId } }),
      this.dataSource
        .getRepository(ObjectMetadataEntity)
        .findOne({ where: { id: objectId, workspaceId, isActive: true } }),
      this.dataSource.getRepository(FieldMetadataEntity).find({
        where: { objectMetadataId: objectId, workspaceId, isActive: true },
        order: { id: 'ASC' },
      }),
    ]);
    const object = findFlatEntityByIdInFlatEntityMaps({
      flatEntityId: objectId,
      flatEntityMaps: maps.flatObjectMetadataMaps,
    });
    if (
      !workspace ||
      workspace.deletedAt ||
      workspace.databaseSchema !== human.workspace.databaseSchema ||
      !workspace.databaseSchema ||
      !object ||
      !liveObject ||
      object.workspaceId !== workspaceId ||
      object.nameSingular !== liveObject.nameSingular ||
      liveObject.isSystem ||
      liveObject.isRemote ||
      object.applicationId !== liveObject.applicationId ||
      object.isSystem ||
      object.isRemote ||
      object.labelIdentifierFieldMetadataId !==
        liveObject.labelIdentifierFieldMetadataId
    )
      return denyLeadPool();
    const owner = fields.find(
      (field) => field.id === decision.ownerFieldMetadataId,
    );
    const target = owner?.relationTargetObjectMetadataId
      ? findFlatEntityByIdInFlatEntityMaps({
          flatEntityId: owner.relationTargetObjectMetadataId,
          flatEntityMaps: maps.flatObjectMetadataMaps,
        })
      : undefined;
    const memberName = Object.values(
      maps.flatFieldMetadataMaps.byUniversalIdentifier,
    ).find(
      (field) =>
        field?.objectMetadataId === target?.id && field?.name === 'name',
    );
    const labelField = fields.find(
      (field) => field.id === liveObject.labelIdentifierFieldMetadataId,
    );
    const readable = (id: string) =>
      objectPermission.restrictedFields?.[id]?.canRead !== false;
    const canReadRecipients =
      !!target &&
      !!memberName &&
      permissions[target.id]?.canReadObjectRecords === true &&
      permissions[target.id]?.restrictedFields?.[memberName.id]?.canRead !==
        false;
    if (
      !owner ||
      owner.type !== FieldMetadataType.RELATION ||
      !owner.settings ||
      !('relationType' in owner.settings) ||
      owner.settings.relationType !== RelationType.MANY_TO_ONE ||
      owner.name !== decision.ownerFieldName ||
      target?.nameSingular !== 'workspaceMember' ||
      target.workspaceId !== workspaceId ||
      (options.requireRecipientRead && !canReadRecipients) ||
      !readable(owner.id) ||
      objectPermission.restrictedFields?.[owner.id]?.canUpdate === false ||
      !labelField ||
      labelField.type !== FieldMetadataType.TEXT ||
      !readable(labelField.id)
    )
      return denyLeadPool();
    // Live definitions and the definitions used by the ordinary ORM must agree.
    for (const field of fields) {
      const cached = findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: field.id,
        flatEntityMaps: maps.flatFieldMetadataMaps,
      });
      if (
        !cached ||
        cached.workspaceId !== workspaceId ||
        cached.objectMetadataId !== objectId ||
        cached.name !== field.name ||
        cached.type !== field.type ||
        cached.isActive !== field.isActive ||
        JSON.stringify(cached.settings) !== JSON.stringify(field.settings) ||
        cached.relationTargetObjectMetadataId !==
          field.relationTargetObjectMetadataId
      )
        return denyLeadPool();
    }
    const profiles = await this.members.getAssignableWorkspaceMemberProfiles({
      manager: this.dataSource.manager,
      workspaceId,
    });
    const userWorkspaces = await this.dataSource
      .getRepository(UserWorkspaceEntity)
      .find({ where: { workspaceId } });
    const recipients = profiles
      .filter((profile) => {
        const member = maps.flatWorkspaceMemberMaps.byId[profile.id];
        const userWorkspace = userWorkspaces.find(
          (entry) => entry.userId === member?.userId && !entry.deletedAt,
        );
        const roleId = userWorkspace
          ? maps.userWorkspaceRoleMap[userWorkspace.id]
          : undefined;
        return (
          canReadRecipients &&
          profile.isAssignable &&
          roleId &&
          maps.flatRoleMaps.universalIdentifierById[roleId] &&
          (decision.ownerTransferPolicy === 'standardPermissionsOnly' ||
            decision.assignableOwnerWorkspaceMemberIds.includes(profile.id))
        );
      })
      .map((profile) => ({
        id: profile.id,
        label: `${profile.firstName} ${profile.lastName}`.trim(),
      }))
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    const readableFields = fields.filter((field) => readable(field.id));
    const publicFields: LeadPoolField[] = readableFields.flatMap((field) => {
      if (
        ![
          FieldMetadataType.TEXT,
          FieldMetadataType.SELECT,
          FieldMetadataType.BOOLEAN,
          FieldMetadataType.DATE,
          FieldMetadataType.DATE_TIME,
        ].includes(field.type)
      )
        return [];
      return [
        {
          id: field.id,
          label: field.label,
          type: field.type as LeadPoolField['type'],
          options:
            field.options?.map((option) => ({
              value: option.value,
              label: option.label,
            })) ?? [],
        },
      ];
    });
    return {
      context: {
        authContext,
        flatObjectMetadata: object,
        flatObjectMetadataMaps: maps.flatObjectMetadataMaps,
        flatFieldMetadataMaps: maps.flatFieldMetadataMaps,
        objectIdByNameSingular: buildObjectIdByNameMaps(
          maps.flatObjectMetadataMaps,
        ).idByNameSingular,
        rolePermissionConfig,
      },
      schema: workspace.databaseSchema,
      owner,
      ownerColumn: decision.ownerJoinColumnName,
      labelField,
      fields: readableFields,
      publicFields,
      recipients,
      decision,
      hash: hashLeadPoolValue({
        rolePermissionConfig,
        objectPermission,
        decision,
        teamMaps,
        metadata: fields.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          settings: field.settings,
          options: field.options,
        })),
        object: {
          id: object.id,
          name: object.nameSingular,
          applicationId: object.applicationId,
          applicationUniversalIdentifier: object.applicationUniversalIdentifier,
          labelId: object.labelIdentifierFieldMetadataId,
        },
      }),
    };
  }

  assertRecipients(authority: LeadPoolAuthority, recipientIds: string[]): void {
    for (const id of recipientIds) {
      if (
        !authority.recipients.some(
          (recipient) =>
            recipient.id === id && recipient.label.trim().length > 0,
        )
      )
        return denyLeadPool();
      validateInconnectRecordAccessUpdateValues({
        decision: authority.decision,
        valuesSet: { [authority.ownerColumn]: id },
      });
    }
  }
}
