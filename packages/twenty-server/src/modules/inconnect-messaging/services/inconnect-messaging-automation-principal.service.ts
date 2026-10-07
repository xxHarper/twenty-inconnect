import { Injectable } from '@nestjs/common';

import {
  getFieldPermissionUniversalIdentifier,
  getObjectPermissionUniversalIdentifier,
  getRoleUniversalIdentifier,
} from 'twenty-shared/application';
import { type EntityManager } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { RolePermissionFlagEntity } from 'src/engine/metadata-modules/role-permission-flag/role-permission-flag.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  getInconnectMessagingAutomationFieldPermissionId,
  getInconnectMessagingAutomationInternalEmail,
  getInconnectMessagingAutomationPrincipalIds,
  getInconnectMessagingAutomationRoleTargetUniversalIdentifier,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
  INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingAutomationRecordAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-access.service';
import { resolveInconnectMessagingAutomationFieldAuthority } from 'src/modules/inconnect-messaging/utils/resolve-inconnect-messaging-automation-field-authority.util';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

export const INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON = {
  PRINCIPAL_MISSING: 'AUTOMATION_PRINCIPAL_MISSING',
  PRINCIPAL_INVALID: 'AUTOMATION_PRINCIPAL_INVALID',
  ROLE_INVALID: 'AUTOMATION_ROLE_INVALID',
  PERMISSIONS_INVALID: 'AUTOMATION_PERMISSIONS_INVALID',
  RECORD_ACCESS_POLICY_INVALID: 'AUTOMATION_RECORD_ACCESS_POLICY_INVALID',
} as const;

export type InconnectMessagingAutomationPrincipalValidationReason =
  (typeof INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON)[keyof typeof INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON];

export type InconnectMessagingValidatedAutomationPrincipal = Readonly<{
  workspaceId: string;
  userId: string;
  userWorkspaceId: string;
  workspaceMemberId: string;
  roleId: string;
  name: typeof INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME;
}>;

export type InconnectMessagingAutomationPrincipalValidation =
  | {
      status: 'VALID';
      principal: InconnectMessagingValidatedAutomationPrincipal;
    }
  | {
      status: 'INVALID';
      reason: InconnectMessagingAutomationPrincipalValidationReason;
    };

type WorkspaceMemberRow = {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  deletedAt: Date | null;
};

const invalid = (
  reason: InconnectMessagingAutomationPrincipalValidationReason,
): InconnectMessagingAutomationPrincipalValidation => ({
  status: 'INVALID',
  reason,
});

@Injectable()
export class InconnectMessagingAutomationPrincipalService {
  constructor(
    private readonly automationRecordAccessService: InconnectMessagingAutomationRecordAccessService,
  ) {}

  async validate({
    manager,
    workspaceId,
    lock = false,
  }: {
    manager: EntityManager;
    workspaceId: string;
    lock?: boolean;
  }): Promise<InconnectMessagingAutomationPrincipalValidation> {
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(workspaceId);
    const configurationQuery = manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .createQueryBuilder('configuration')
      .where('configuration.workspaceId = :workspaceId', { workspaceId });

    if (lock) {
      configurationQuery.setLock('pessimistic_read');
    }

    const configuration = await configurationQuery.getOne();

    if (configuration?.automationUserWorkspaceId === null) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_MISSING,
      );
    }

    if (
      configuration === null ||
      configuration.automationUserWorkspaceId !== expectedIds.userWorkspaceId
    ) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_INVALID,
      );
    }

    const workspaceQuery = manager
      .getRepository(WorkspaceEntity)
      .createQueryBuilder('workspace')
      .withDeleted()
      .where('workspace.id = :workspaceId', { workspaceId });
    const userWorkspaceQuery = manager
      .getRepository(UserWorkspaceEntity)
      .createQueryBuilder('userWorkspace')
      .withDeleted()
      .where('userWorkspace.id = :userWorkspaceId', {
        userWorkspaceId: expectedIds.userWorkspaceId,
      });
    const userQuery = manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.id = :userId', { userId: expectedIds.userId });

    if (lock) {
      workspaceQuery.setLock('pessimistic_read');
      userWorkspaceQuery.setLock('pessimistic_read');
      userQuery.setLock('pessimistic_read');
    }

    const [workspace, userWorkspace, user, credentialCount] = await Promise.all(
      [
        workspaceQuery.getOne(),
        userWorkspaceQuery.getOne(),
        userQuery.getOne(),
        manager.getRepository(AppTokenEntity).count({
          where: { userId: expectedIds.userId },
        }),
      ],
    );

    if (
      workspace === null ||
      workspace.deletedAt !== null ||
      !workspace.databaseSchema ||
      userWorkspace === null ||
      userWorkspace.workspaceId !== workspaceId ||
      userWorkspace.userId !== expectedIds.userId ||
      userWorkspace.deletedAt !== null ||
      user === null ||
      user.deletedAt !== null ||
      user.disabled !== false ||
      user.passwordHash !== null ||
      user.isEmailVerified !== false ||
      user.canImpersonate !== false ||
      user.canAccessFullAdminPanel !== false ||
      user.firstName !== INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME ||
      user.lastName !== INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME ||
      user.email !==
        getInconnectMessagingAutomationInternalEmail(workspaceId) ||
      credentialCount !== 0
    ) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_INVALID,
      );
    }

    const workspaceMemberRows = (await manager.query(
      `SELECT
        workspace_member."id",
        workspace_member."userId",
        workspace_member."nameFirstName" AS "firstName",
        workspace_member."nameLastName" AS "lastName",
        workspace_member."deletedAt"
      FROM ${escapeIdentifier(workspace.databaseSchema)}."workspaceMember" workspace_member
      WHERE workspace_member."id" = $1::uuid
        OR workspace_member."userId" = $2::uuid
      ${lock ? 'FOR SHARE OF workspace_member' : ''}`,
      [expectedIds.workspaceMemberId, expectedIds.userId],
    )) as WorkspaceMemberRow[];

    if (
      workspaceMemberRows.length !== 1 ||
      workspaceMemberRows[0].id !== expectedIds.workspaceMemberId ||
      workspaceMemberRows[0].userId !== expectedIds.userId ||
      workspaceMemberRows[0].deletedAt !== null ||
      workspaceMemberRows[0].firstName !==
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME ||
      workspaceMemberRows[0].lastName !==
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME
    ) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_INVALID,
      );
    }

    const application = await manager.getRepository(ApplicationEntity).findOne({
      where: {
        id: workspace.workspaceCustomApplicationId,
        workspaceId,
      },
    });

    if (application === null || application.deletedAt !== null) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.ROLE_INVALID,
      );
    }

    const expectedRoleUniversalIdentifier = getRoleUniversalIdentifier({
      applicationUniversalIdentifier: application.universalIdentifier,
      label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
    });
    const roleQuery = manager
      .getRepository(RoleEntity)
      .createQueryBuilder('role')
      .where('role.id = :roleId', { roleId: expectedIds.roleId });
    const roleTargetsQuery = manager
      .getRepository(RoleTargetEntity)
      .createQueryBuilder('roleTarget')
      .where(
        '(roleTarget.roleId = :roleId OR roleTarget.userWorkspaceId = :userWorkspaceId)',
        {
          roleId: expectedIds.roleId,
          userWorkspaceId: expectedIds.userWorkspaceId,
        },
      );

    if (lock) {
      roleQuery.setLock('pessimistic_read');
      roleTargetsQuery.setLock('pessimistic_read');
    }

    const [role, roleTargets] = await Promise.all([
      roleQuery.getOne(),
      roleTargetsQuery.getMany(),
    ]);
    const expectedRoleTargetUniversalIdentifier =
      getInconnectMessagingAutomationRoleTargetUniversalIdentifier({
        applicationUniversalIdentifier: application.universalIdentifier,
        userWorkspaceId: expectedIds.userWorkspaceId,
      });

    if (
      role === null ||
      role.workspaceId !== workspaceId ||
      role.applicationId !== application.id ||
      role.universalIdentifier !== expectedRoleUniversalIdentifier ||
      role.label !== INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL ||
      role.isEditable !== false ||
      role.canBeAssignedToUsers !== false ||
      role.canBeAssignedToAgents !== false ||
      role.canBeAssignedToApiKeys !== false ||
      role.canUpdateAllSettings !== false ||
      role.canAccessAllTools !== false ||
      role.canReadAllObjectRecords !== false ||
      role.canUpdateAllObjectRecords !== false ||
      role.canSoftDeleteAllObjectRecords !== false ||
      role.canDestroyAllObjectRecords !== false ||
      roleTargets.length !== 1 ||
      roleTargets[0].id !== expectedIds.roleTargetId ||
      roleTargets[0].workspaceId !== workspaceId ||
      roleTargets[0].applicationId !== application.id ||
      roleTargets[0].universalIdentifier !==
        expectedRoleTargetUniversalIdentifier ||
      roleTargets[0].roleId !== expectedIds.roleId ||
      roleTargets[0].userWorkspaceId !== expectedIds.userWorkspaceId ||
      roleTargets[0].agentId !== null ||
      roleTargets[0].apiKeyId !== null
    ) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.ROLE_INVALID,
      );
    }

    const permissionsAreValid = await this.validatePermissions({
      application,
      configuration,
      expectedIds,
      lock,
      manager,
      workspaceId,
    });

    if (!permissionsAreValid) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PERMISSIONS_INVALID,
      );
    }

    if (
      !(await this.automationRecordAccessService.validatePolicy({
        configuration,
        expectedRoleId: expectedIds.roleId,
        lock,
        manager,
        workspaceId,
      }))
    ) {
      return invalid(
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.RECORD_ACCESS_POLICY_INVALID,
      );
    }

    return {
      status: 'VALID',
      principal: Object.freeze({
        workspaceId,
        userId: expectedIds.userId,
        userWorkspaceId: expectedIds.userWorkspaceId,
        workspaceMemberId: expectedIds.workspaceMemberId,
        roleId: expectedIds.roleId,
        name: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
      }),
    };
  }

  private async validatePermissions({
    application,
    configuration,
    expectedIds,
    lock,
    manager,
    workspaceId,
  }: {
    application: ApplicationEntity;
    configuration: InconnectMessagingConfigurationEntity;
    expectedIds: ReturnType<typeof getInconnectMessagingAutomationPrincipalIds>;
    lock: boolean;
    manager: EntityManager;
    workspaceId: string;
  }): Promise<boolean> {
    const anchorObject = await manager
      .getRepository(ObjectMetadataEntity)
      .findOne({
        where: {
          id: configuration.anchorObjectMetadataId,
          workspaceId,
        },
      });

    if (anchorObject === null) {
      return false;
    }

    const primaryRows = await manager
      .getRepository(InconnectMessagingPhoneIdentityFieldEntity)
      .find({
        where: {
          workspaceId,
          objectMetadataId: anchorObject.id,
          role: 'PRIMARY',
        },
      });
    const fields = await manager.getRepository(FieldMetadataEntity).find({
      where: {
        objectMetadataId: anchorObject.id,
        workspaceId,
      },
    });
    const managedObjects = await manager
      .getRepository(InconnectRecordAccessManagedObjectEntity)
      .find({
        where: { objectMetadataId: anchorObject.id, workspaceId },
      });

    if (primaryRows.length !== 1 || managedObjects.length !== 1) {
      return false;
    }

    const fieldAuthority = resolveInconnectMessagingAutomationFieldAuthority({
      fields,
      ownerFieldMetadataId: managedObjects[0].ownerFieldMetadataId,
      primaryFieldMetadataId: primaryRows[0].fieldMetadataId,
    });

    if (fieldAuthority === null) {
      return false;
    }
    const objectPermissionQuery = manager
      .getRepository(ObjectPermissionEntity)
      .createQueryBuilder('objectPermission')
      .where('objectPermission.roleId = :roleId', {
        roleId: expectedIds.roleId,
      });
    const fieldPermissionQuery = manager
      .getRepository(FieldPermissionEntity)
      .createQueryBuilder('fieldPermission')
      .where('fieldPermission.roleId = :roleId', {
        roleId: expectedIds.roleId,
      });
    const permissionFlagQuery = manager
      .getRepository(RolePermissionFlagEntity)
      .createQueryBuilder('rolePermissionFlag')
      .where('rolePermissionFlag.roleId = :roleId', {
        roleId: expectedIds.roleId,
      });

    if (lock) {
      objectPermissionQuery.setLock('pessimistic_read');
      fieldPermissionQuery.setLock('pessimistic_read');
      permissionFlagQuery.setLock('pessimistic_read');
    }

    const [objectPermissions, fieldPermissions, permissionFlags] =
      await Promise.all([
        objectPermissionQuery.getMany(),
        fieldPermissionQuery.getMany(),
        permissionFlagQuery.getMany(),
      ]);
    const roleUniversalIdentifier = getRoleUniversalIdentifier({
      applicationUniversalIdentifier: application.universalIdentifier,
      label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
    });
    const expectedObjectPermissionUniversalIdentifier =
      getObjectPermissionUniversalIdentifier({
        applicationUniversalIdentifier: application.universalIdentifier,
        objectUniversalIdentifier: anchorObject.universalIdentifier,
        roleUniversalIdentifier,
      });

    if (
      permissionFlags.length !== 0 ||
      objectPermissions.length !== 1 ||
      objectPermissions[0].id !== expectedIds.objectPermissionId ||
      objectPermissions[0].workspaceId !== workspaceId ||
      objectPermissions[0].applicationId !== application.id ||
      objectPermissions[0].universalIdentifier !==
        expectedObjectPermissionUniversalIdentifier ||
      objectPermissions[0].objectMetadataId !== anchorObject.id ||
      objectPermissions[0].canReadObjectRecords !== false ||
      objectPermissions[0].canUpdateObjectRecords !== true ||
      objectPermissions[0].canSoftDeleteObjectRecords !== false ||
      objectPermissions[0].canDestroyObjectRecords !== false ||
      fieldPermissions.length !== fields.length
    ) {
      return false;
    }

    const fieldById = new Map(fields.map((field) => [field.id, field]));

    return fieldPermissions.every((fieldPermission) => {
      const field = fieldById.get(fieldPermission.fieldMetadataId);

      if (field === undefined) {
        return false;
      }

      const expectedUniversalIdentifier = getFieldPermissionUniversalIdentifier(
        {
          applicationUniversalIdentifier: application.universalIdentifier,
          fieldUniversalIdentifier: field.universalIdentifier,
          roleUniversalIdentifier,
        },
      );
      const expectedUpdatePermission =
        fieldAuthority.writableFieldMetadataIds.has(field.id) ? null : false;

      return (
        fieldPermission.id ===
          getInconnectMessagingAutomationFieldPermissionId({
            fieldMetadataId: field.id,
            workspaceId,
          }) &&
        fieldPermission.workspaceId === workspaceId &&
        fieldPermission.applicationId === application.id &&
        fieldPermission.universalIdentifier === expectedUniversalIdentifier &&
        fieldPermission.objectMetadataId === anchorObject.id &&
        fieldPermission.canReadFieldValue === null &&
        fieldPermission.canUpdateFieldValue === expectedUpdatePermission
      );
    });
  }
}
