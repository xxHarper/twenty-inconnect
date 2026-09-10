import { Injectable } from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';
import { type ObjectsPermissions } from 'twenty-shared/types';
import { type SelectQueryBuilder } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import {
  type UserWorkspaceAuthContext,
  type WorkspaceAuthContext,
} from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';

type MessagingOperation = 'read' | 'send' | 'triage';

type HumanAuthorization = {
  authContext: UserWorkspaceAuthContext;
  rolePermissionConfig: RolePermissionConfig;
  objectsPermissions: ObjectsPermissions;
};

type ConversationScopeQueryBuilder = Pick<
  SelectQueryBuilder<InconnectMessagingConversationEntity>,
  'andWhere'
>;

@Injectable()
export class InconnectMessagingAuthorizationService {
  constructor(
    @InjectWorkspaceScopedRepository(InconnectMessagingConversationEntity)
    private readonly conversationRepository: WorkspaceScopedRepository<InconnectMessagingConversationEntity>,
    @InjectWorkspaceScopedRepository(InconnectMessagingConfigurationEntity)
    private readonly configurationRepository: WorkspaceScopedRepository<InconnectMessagingConfigurationEntity>,
    private readonly permissionsService: PermissionsService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
  ) {}

  async findAuthorizedConversation({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationEntity | null> {
    return this.findConversationAuthorizedForOperation({
      authContext,
      conversationId,
      operation: 'read',
    });
  }

  async canReadConversation(args: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<boolean> {
    return Boolean(await this.findAuthorizedConversation(args));
  }

  async canSendConversation({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<boolean> {
    return Boolean(
      await this.findConversationAuthorizedForOperation({
        authContext,
        conversationId,
        operation: 'send',
      }),
    );
  }

  async canTriageConversation({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<boolean> {
    return Boolean(
      await this.findConversationAuthorizedForOperation({
        authContext,
        conversationId,
        operation: 'triage',
      }),
    );
  }

  async canManageMessaging(
    authContext: WorkspaceAuthContext,
  ): Promise<boolean> {
    const authorization = await this.resolveHumanAuthorization(authContext);

    return (
      authorization !== null &&
      this.hasPermissionFlags(authorization, [
        PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
      ])
    );
  }

  async applyConversationReadScope({
    authContext,
    queryBuilder,
    conversationAlias,
  }: {
    authContext: WorkspaceAuthContext;
    queryBuilder: ConversationScopeQueryBuilder;
    conversationAlias: string;
  }): Promise<void> {
    const authorization = await this.resolveHumanAuthorization(authContext);

    if (
      authorization === null ||
      !(await this.hasPermissionFlags(authorization, [
        PermissionFlagType.INCONNECT_MESSAGING,
      ]))
    ) {
      queryBuilder.andWhere('1 = 0');

      return;
    }

    const workspaceParameterName = 'inconnectMessagingWorkspaceId';

    queryBuilder.andWhere(
      `${escapeIdentifier(conversationAlias)}."workspaceId" = :${workspaceParameterName}`,
      { [workspaceParameterName]: authContext.workspace.id },
    );

    const visibilityConditions: string[] = [];
    const parameters: Record<string, unknown> = {};

    if (
      await this.hasPermissionFlags(authorization, [
        PermissionFlagType.TRIAGE_INCONNECT_MESSAGING,
      ])
    ) {
      visibilityConditions.push(
        `(${escapeIdentifier(
          conversationAlias,
        )}."linkedRecordObjectMetadataId" IS NULL AND ${escapeIdentifier(
          conversationAlias,
        )}."linkedRecordId" IS NULL)`,
      );
    }

    const configuration = await this.getConfiguration(authContext.workspace.id);

    if (
      configuration &&
      this.hasStandardObjectReadPermission({
        authorization,
        objectMetadataId: configuration.anchorObjectMetadataId,
      })
    ) {
      const existsCondition =
        await this.recordAccessAuthorizationService.buildAuthorizedRecordExistsCondition(
          {
            workspaceId: authContext.workspace.id,
            objectMetadataId: configuration.anchorObjectMetadataId,
            authContext,
            recordIdReference: {
              tableAlias: conversationAlias,
              columnName: 'linkedRecordId',
            },
          },
        );

      if (existsCondition.scope.kind !== 'denied') {
        const anchorParameterName = 'inconnectMessagingAnchorObjectMetadataId';

        visibilityConditions.push(
          `(${escapeIdentifier(
            conversationAlias,
          )}."linkedRecordObjectMetadataId" = :${anchorParameterName} AND ${existsCondition.sql})`,
        );
        parameters[anchorParameterName] = configuration.anchorObjectMetadataId;
        Object.assign(parameters, existsCondition.parameters);
      }
    }

    if (visibilityConditions.length === 0) {
      queryBuilder.andWhere('1 = 0');

      return;
    }

    queryBuilder.andWhere(`(${visibilityConditions.join(' OR ')})`, parameters);
  }

  private async findConversationAuthorizedForOperation({
    authContext,
    conversationId,
    operation,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    operation: MessagingOperation;
  }): Promise<InconnectMessagingConversationEntity | null> {
    const authorization = await this.resolveHumanAuthorization(authContext);

    if (authorization === null) {
      return null;
    }

    const requiredFlags = [PermissionFlagType.INCONNECT_MESSAGING];

    if (operation === 'send') {
      requiredFlags.push(PermissionFlagType.SEND_INCONNECT_MESSAGING);
    }

    if (operation === 'triage') {
      requiredFlags.push(PermissionFlagType.TRIAGE_INCONNECT_MESSAGING);
    }

    if (!(await this.hasPermissionFlags(authorization, requiredFlags))) {
      return null;
    }

    const conversation = await this.conversationRepository.findOne(
      authContext.workspace.id,
      {
        where: {
          id: conversationId,
        },
      },
    );

    if (
      !conversation ||
      conversation.workspaceId !== authContext.workspace.id
    ) {
      return null;
    }

    const isUnassigned =
      conversation.linkedRecordObjectMetadataId === null &&
      conversation.linkedRecordId === null;

    if (isUnassigned) {
      if (operation === 'triage') {
        return conversation;
      }

      return (await this.hasPermissionFlags(authorization, [
        PermissionFlagType.TRIAGE_INCONNECT_MESSAGING,
      ]))
        ? conversation
        : null;
    }

    if (
      conversation.linkedRecordObjectMetadataId === null ||
      conversation.linkedRecordId === null ||
      operation === 'triage'
    ) {
      return null;
    }

    const configuration = await this.getConfiguration(authContext.workspace.id);

    if (
      !configuration ||
      conversation.linkedRecordObjectMetadataId !==
        configuration.anchorObjectMetadataId ||
      !this.hasStandardObjectReadPermission({
        authorization,
        objectMetadataId: configuration.anchorObjectMetadataId,
      })
    ) {
      return null;
    }

    return (await this.recordAccessAuthorizationService.isRecordReadable({
      workspaceId: authContext.workspace.id,
      objectMetadataId: configuration.anchorObjectMetadataId,
      recordId: conversation.linkedRecordId,
      authContext,
    }))
      ? conversation
      : null;
  }

  private async resolveHumanAuthorization(
    authContext: WorkspaceAuthContext,
  ): Promise<HumanAuthorization | null> {
    if (
      !isUserAuthContext(authContext) ||
      authContext.workspaceMember.id !== authContext.workspaceMemberId ||
      !(await this.recordAccessAuthorizationService.isAuthenticatedWorkspaceMemberValid(
        {
          workspaceId: authContext.workspace.id,
          authContext,
        },
      ))
    ) {
      return null;
    }

    try {
      const { userWorkspaceRoleMap, apiKeyRoleMap, rolesPermissions } =
        await this.workspaceCacheService.getOrRecompute(
          authContext.workspace.id,
          ['userWorkspaceRoleMap', 'apiKeyRoleMap', 'rolesPermissions'],
        );
      const rolePermissionConfig = resolveRolePermissionConfig({
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });

      if (
        rolePermissionConfig === null ||
        'shouldBypassPermissionChecks' in rolePermissionConfig
      ) {
        return null;
      }

      return {
        authContext,
        rolePermissionConfig,
        objectsPermissions: getObjectsPermissionsFromRolePermissionConfig({
          rolesPermissions,
          rolePermissionConfig,
        }),
      };
    } catch {
      return null;
    }
  }

  private async hasPermissionFlags(
    authorization: HumanAuthorization,
    permissionFlags: PermissionFlagType[],
  ): Promise<boolean> {
    const results = await Promise.all(
      permissionFlags.map((permissionFlag) =>
        this.permissionsService.checkRolesPermissions(
          authorization.rolePermissionConfig,
          authorization.authContext.workspace.id,
          permissionFlag,
        ),
      ),
    );

    return results.every(Boolean);
  }

  private hasStandardObjectReadPermission({
    authorization,
    objectMetadataId,
  }: {
    authorization: HumanAuthorization;
    objectMetadataId: string;
  }): boolean {
    return (
      authorization.objectsPermissions[objectMetadataId]
        ?.canReadObjectRecords === true
    );
  }

  private async getConfiguration(
    workspaceId: string,
  ): Promise<InconnectMessagingConfigurationEntity | null> {
    try {
      return await this.configurationRepository.findOne(workspaceId, {
        where: {},
      });
    } catch {
      return null;
    }
  }
}
