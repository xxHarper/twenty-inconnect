import { Injectable } from '@nestjs/common';

import {
  getFieldPermissionUniversalIdentifier,
  getObjectPermissionUniversalIdentifier,
  getRoleUniversalIdentifier,
} from 'twenty-shared/application';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { type APP_LOCALES, SOURCE_LOCALE } from 'twenty-shared/translations';
import { OpenRecordIn } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
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
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  getInconnectMessagingAutomationFieldPermissionId,
  getInconnectMessagingAutomationInternalEmail,
  getInconnectMessagingAutomationPrincipalIds,
  getInconnectMessagingAutomationRoleTargetUniversalIdentifier,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAutomationRecordAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-access.service';
import { InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';
import { findInconnectMessagingAutoCreateOwnerFields } from 'src/modules/inconnect-messaging/utils/find-inconnect-messaging-auto-create-owner-fields.util';
import { resolveInconnectMessagingAutomationFieldAuthority } from 'src/modules/inconnect-messaging/utils/resolve-inconnect-messaging-automation-field-authority.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const ROLE_CACHE_KEYS = [
  'flatRoleMaps',
  'flatRoleTargetMaps',
  'flatObjectPermissionMaps',
  'flatFieldPermissionMaps',
  'flatRolePermissionFlagMaps',
  'rolesPermissions',
  'userWorkspaceRoleMap',
] as const;

export type InconnectMessagingAutomationPrincipalProvisioningResult = {
  workspaceId: string;
  userWorkspaceId: string;
  workspaceMemberId: string;
  roleId: string;
  status: 'PROVISIONED';
};

@Injectable()
export class InconnectMessagingAutomationPrincipalProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly primaryValidatorService: InconnectMessagingAutoCreatePrimaryValidatorService,
    private readonly automationPrincipalService: InconnectMessagingAutomationPrincipalService,
    private readonly automationRecordAccessService: InconnectMessagingAutomationRecordAccessService,
  ) {}

  async provision({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<InconnectMessagingAutomationPrincipalProvisioningResult> {
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(workspaceId);

    await this.reconcileCoreIdentity({ workspaceId });
    await this.reconcileWorkspaceMember({ workspaceId });
    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      'flatWorkspaceMemberMaps',
    ]);
    await this.reconcileRoleAndPermissions({ workspaceId });
    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      ...ROLE_CACHE_KEYS,
    ]);
    await this.automationRecordAccessService.reconcilePolicy({
      roleId: expectedIds.roleId,
      workspaceId,
    });

    await this.dataSource.transaction(async (manager) => {
      const configuration = await manager
        .getRepository(InconnectMessagingConfigurationEntity)
        .findOne({
          where: { workspaceId },
          lock: { mode: 'pessimistic_write' },
        });

      if (configuration === null) {
        throw new Error('Messaging configuration is unavailable');
      }

      configuration.automationUserWorkspaceId = expectedIds.userWorkspaceId;
      await manager
        .getRepository(InconnectMessagingConfigurationEntity)
        .save(configuration);

      const validation = await this.automationPrincipalService.validate({
        lock: true,
        manager,
        workspaceId,
      });

      if (validation.status !== 'VALID') {
        throw new Error(
          `Automation principal provisioning did not converge: ${validation.reason}`,
        );
      }
    });

    return {
      workspaceId,
      userWorkspaceId: expectedIds.userWorkspaceId,
      workspaceMemberId: expectedIds.workspaceMemberId,
      roleId: expectedIds.roleId,
      status: 'PROVISIONED',
    };
  }

  private async reconcileCoreIdentity({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<void> {
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(workspaceId);
    const expectedEmail =
      getInconnectMessagingAutomationInternalEmail(workspaceId);

    await this.dataSource.transaction(async (manager) => {
      const workspace = await manager.getRepository(WorkspaceEntity).findOne({
        where: { id: workspaceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (workspace === null || workspace.deletedAt !== null) {
        throw new Error('Workspace is unavailable');
      }

      const users = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .withDeleted()
        .where('user.id = :userId OR user.email = :email', {
          email: expectedEmail,
          userId: expectedIds.userId,
        })
        .setLock('pessimistic_write')
        .getMany();

      if (users.some(({ id }) => id !== expectedIds.userId)) {
        throw new Error('Automation technical User identity is occupied');
      }

      const userRepository = manager.getRepository(UserEntity);
      const user =
        users[0] ?? userRepository.create({ id: expectedIds.userId });

      Object.assign(user, {
        firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
        lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
        email: expectedEmail,
        isEmailVerified: false,
        disabled: false,
        passwordHash: null,
        canImpersonate: false,
        canAccessFullAdminPanel: false,
        locale: SOURCE_LOCALE,
        deletedAt: null,
      });
      await userRepository.save(user);

      const userWorkspaces = await manager
        .getRepository(UserWorkspaceEntity)
        .createQueryBuilder('userWorkspace')
        .withDeleted()
        .where(
          'userWorkspace.id = :userWorkspaceId OR (userWorkspace.userId = :userId AND userWorkspace.workspaceId = :workspaceId)',
          {
            userId: expectedIds.userId,
            userWorkspaceId: expectedIds.userWorkspaceId,
            workspaceId,
          },
        )
        .setLock('pessimistic_write')
        .getMany();

      if (
        userWorkspaces.some(
          ({ id, userId, workspaceId: rowWorkspaceId }) =>
            id !== expectedIds.userWorkspaceId ||
            userId !== expectedIds.userId ||
            rowWorkspaceId !== workspaceId,
        )
      ) {
        throw new Error('Automation UserWorkspace identity is occupied');
      }

      const userWorkspaceRepository =
        manager.getRepository(UserWorkspaceEntity);
      const userWorkspace =
        userWorkspaces[0] ??
        userWorkspaceRepository.create({ id: expectedIds.userWorkspaceId });

      Object.assign(userWorkspace, {
        userId: expectedIds.userId,
        workspaceId,
        defaultAvatarUrl: null,
        locale: SOURCE_LOCALE,
        deletedAt: null,
      });
      await userWorkspaceRepository.save(userWorkspace);
    });
  }

  private async reconcileWorkspaceMember({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<void> {
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(workspaceId);
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
          workspaceId,
          'workspaceMember',
          { shouldBypassPermissionChecks: true },
        );
      const rows = await repository.find({
        where: [
          { id: expectedIds.workspaceMemberId },
          { userId: expectedIds.userId },
        ],
        withDeleted: true,
      });

      if (
        rows.some(
          ({ id, userId }) =>
            id !== expectedIds.workspaceMemberId ||
            userId !== expectedIds.userId,
        )
      ) {
        throw new Error('Automation WorkspaceMember identity is occupied');
      }

      const values = {
        name: {
          firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
          lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
        },
        colorScheme: 'System',
        openRecordIn: OpenRecordIn.SIDE_PANEL,
        userId: expectedIds.userId,
        userEmail: getInconnectMessagingAutomationInternalEmail(workspaceId),
        avatarUrl: null,
        locale: SOURCE_LOCALE as keyof typeof APP_LOCALES,
        deletedAt: null,
      };

      if (rows.length === 0) {
        await repository.insert({
          id: expectedIds.workspaceMemberId,
          ...values,
        });
      } else {
        await repository.update({ id: expectedIds.workspaceMemberId }, values);
      }
    }, authContext);
  }

  private async reconcileRoleAndPermissions({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<void> {
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(workspaceId);

    await this.dataSource.transaction(async (manager) => {
      const workspace = await manager.getRepository(WorkspaceEntity).findOne({
        where: { id: workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      const configuration = await manager
        .getRepository(InconnectMessagingConfigurationEntity)
        .findOne({
          where: { workspaceId },
          lock: { mode: 'pessimistic_read' },
        });

      if (
        workspace === null ||
        configuration === null ||
        configuration.autoCreateAnchorObjectMetadataId !==
          configuration.anchorObjectMetadataId
      ) {
        throw new Error('Messaging auto-create configuration is unavailable');
      }

      const application = await manager
        .getRepository(ApplicationEntity)
        .findOne({
          where: {
            id: workspace.workspaceCustomApplicationId,
            workspaceId,
          },
        });
      const anchorObject = await manager
        .getRepository(ObjectMetadataEntity)
        .findOne({
          where: {
            id: configuration.anchorObjectMetadataId,
            workspaceId,
          },
        });
      const workspaceMemberObject = await manager
        .getRepository(ObjectMetadataEntity)
        .findOne({
          where: {
            universalIdentifier:
              STANDARD_OBJECTS.workspaceMember.universalIdentifier,
            workspaceId,
          },
        });

      if (
        application === null ||
        application.deletedAt !== null ||
        anchorObject === null ||
        workspaceMemberObject === null
      ) {
        throw new Error('Automation Role metadata is unavailable');
      }

      const primary = await this.primaryValidatorService.evaluate({
        configuration,
        manager,
      });
      const fields = await manager.getRepository(FieldMetadataEntity).find({
        where: {
          objectMetadataId: anchorObject.id,
          workspaceId,
        },
      });
      const ownerFields = findInconnectMessagingAutoCreateOwnerFields({
        fields,
        workspaceMemberObjectMetadataId: workspaceMemberObject.id,
      });
      const fieldAuthority =
        primary.summary.fieldMetadataId === null || ownerFields.length !== 1
          ? null
          : resolveInconnectMessagingAutomationFieldAuthority({
              fields,
              ownerFieldMetadataId: ownerFields[0].id,
              primaryFieldMetadataId: primary.summary.fieldMetadataId,
            });

      if (
        primary.summary.status !== 'VALID' ||
        primary.summary.fieldMetadataId === null ||
        ownerFields.length !== 1 ||
        fieldAuthority === null
      ) {
        throw new Error('Automation writable Field authority is unavailable');
      }

      const roleUniversalIdentifier = getRoleUniversalIdentifier({
        applicationUniversalIdentifier: application.universalIdentifier,
        label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
      });
      const roles = await manager
        .getRepository(RoleEntity)
        .createQueryBuilder('role')
        .where(
          'role.id = :roleId OR role.universalIdentifier = :universalIdentifier OR role.label = :label',
          {
            label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
            roleId: expectedIds.roleId,
            universalIdentifier: roleUniversalIdentifier,
          },
        )
        .andWhere('role.workspaceId = :workspaceId', { workspaceId })
        .setLock('pessimistic_write')
        .getMany();

      if (roles.some(({ id }) => id !== expectedIds.roleId)) {
        throw new Error('Reserved automation Role identity is occupied');
      }

      const roleRepository = manager.getRepository(RoleEntity);
      const role =
        roles[0] ?? roleRepository.create({ id: expectedIds.roleId });

      Object.assign(role, {
        workspaceId,
        applicationId: application.id,
        universalIdentifier: roleUniversalIdentifier,
        label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
        description:
          'Reserved least-privilege principal for INCONNECT Messaging CRM record automation',
        icon: null,
        isEditable: false,
        canBeAssignedToUsers: false,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
        canUpdateAllSettings: false,
        canAccessAllTools: false,
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
      });
      await roleRepository.save(role);

      await manager.getRepository(RoleTargetEntity).delete([
        { roleId: expectedIds.roleId, workspaceId },
        { userWorkspaceId: expectedIds.userWorkspaceId, workspaceId },
      ]);
      await manager.getRepository(RoleTargetEntity).save({
        id: expectedIds.roleTargetId,
        workspaceId,
        applicationId: application.id,
        universalIdentifier:
          getInconnectMessagingAutomationRoleTargetUniversalIdentifier({
            applicationUniversalIdentifier: application.universalIdentifier,
            userWorkspaceId: expectedIds.userWorkspaceId,
          }),
        roleId: expectedIds.roleId,
        userWorkspaceId: expectedIds.userWorkspaceId,
        agentId: null,
        apiKeyId: null,
      });

      await manager
        .getRepository(RolePermissionFlagEntity)
        .delete({ roleId: expectedIds.roleId, workspaceId });
      await manager
        .getRepository(ObjectPermissionEntity)
        .delete({ roleId: expectedIds.roleId, workspaceId });
      await manager
        .getRepository(FieldPermissionEntity)
        .delete({ roleId: expectedIds.roleId, workspaceId });

      await manager.getRepository(ObjectPermissionEntity).save({
        id: expectedIds.objectPermissionId,
        workspaceId,
        applicationId: application.id,
        universalIdentifier: getObjectPermissionUniversalIdentifier({
          applicationUniversalIdentifier: application.universalIdentifier,
          objectUniversalIdentifier: anchorObject.universalIdentifier,
          roleUniversalIdentifier,
        }),
        roleId: expectedIds.roleId,
        objectMetadataId: anchorObject.id,
        canReadObjectRecords: false,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
      });

      await manager.getRepository(FieldPermissionEntity).save(
        fields.map((field) => ({
          id: getInconnectMessagingAutomationFieldPermissionId({
            fieldMetadataId: field.id,
            workspaceId,
          }),
          workspaceId,
          applicationId: application.id,
          universalIdentifier: getFieldPermissionUniversalIdentifier({
            applicationUniversalIdentifier: application.universalIdentifier,
            fieldUniversalIdentifier: field.universalIdentifier,
            roleUniversalIdentifier,
          }),
          roleId: expectedIds.roleId,
          objectMetadataId: anchorObject.id,
          fieldMetadataId: field.id,
          canReadFieldValue: null,
          canUpdateFieldValue: fieldAuthority.writableFieldMetadataIds.has(
            field.id,
          )
            ? null
            : false,
        })),
      );
    });
  }
}
