import { Injectable, type Type } from '@nestjs/common';

import { type ObjectLiteral } from 'typeorm';

import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { doesInconnectRecordAccessPolicyRequireTeamAuthority } from 'src/engine/core-modules/inconnect-record-access/utils/does-inconnect-record-access-policy-require-team-authority.util';
import { invalidInconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { type UserWorkspaceRoleMap } from 'src/engine/metadata-modules/role-target/types/user-workspace-role-map';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { ExecuteInWorkspaceContextOptions } from 'src/engine/twenty-orm/global-workspace-datasource/types/execute-in-workspace-context-options.type';
import type { WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import {
  type ORMWorkspaceContext,
  withWorkspaceContext,
} from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import type { RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { convertClassNameToObjectMetadataName } from 'src/engine/workspace-manager/utils/convert-class-to-object-metadata-name.util';

const EMPTY_INCONNECT_TEAM_ACCESS_MAPS: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {},
  memberWorkspaceMemberIdsByTeamId: {},
  assignableMemberWorkspaceMemberIdsByTeamId: {},
};

@Injectable()
export class GlobalWorkspaceOrmManager {
  constructor(
    private readonly globalWorkspaceDataSourceService: GlobalWorkspaceDataSourceService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly inconnectRecordAccessPolicySourceService: InconnectRecordAccessPolicySourceService,
  ) {}

  async getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    workspaceEntity: Type<T>,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>>;

  async getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    objectMetadataName: string,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>>;

  async getRepository<T extends ObjectLiteral>(
    _workspaceId: string,
    workspaceEntityOrObjectMetadataName: Type<T> | string,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>> {
    let objectMetadataName: string;

    if (typeof workspaceEntityOrObjectMetadataName === 'string') {
      objectMetadataName = workspaceEntityOrObjectMetadataName;
    } else {
      objectMetadataName = convertClassNameToObjectMetadataName(
        workspaceEntityOrObjectMetadataName.name,
      );
    }

    const globalDataSource = await this.getGlobalWorkspaceDataSource();

    return globalDataSource.getRepository<T>(
      objectMetadataName,
      permissionOptions,
    );
  }

  async getGlobalWorkspaceDataSource(): Promise<GlobalWorkspaceDataSource> {
    return this.globalWorkspaceDataSourceService.getGlobalWorkspaceDataSource();
  }

  async getGlobalWorkspaceDataSourceReplica(): Promise<GlobalWorkspaceDataSource> {
    return this.globalWorkspaceDataSourceService.getGlobalWorkspaceDataSourceReplica();
  }

  async executeInWorkspaceContext<T>(
    fn: () => T | Promise<T>,
    authContext?: WorkspaceAuthContext,
    options?: ExecuteInWorkspaceContextOptions,
  ): Promise<T> {
    const resolvedAuthContext = authContext ?? getWorkspaceAuthContext();
    const context = options?.lite
      ? await this.loadLiteWorkspaceContext(resolvedAuthContext)
      : await this.loadWorkspaceContext(resolvedAuthContext);

    return withWorkspaceContext(context, fn);
  }
  private async loadInconnectTeamAccessMapsIfRequired({
    workspaceId,
    policy,
    authContext,
    userWorkspaceRoleMap,
    apiKeyRoleMap,
  }: {
    workspaceId: string;
    policy: InconnectRecordAccessWorkspacePolicy;
    authContext: WorkspaceAuthContext;
    userWorkspaceRoleMap: UserWorkspaceRoleMap;
    apiKeyRoleMap: Record<string, string>;
  }): Promise<InconnectTeamAccessMaps> {
    if (
      !doesInconnectRecordAccessPolicyRequireTeamAuthority({
        policy,
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      })
    ) {
      return EMPTY_INCONNECT_TEAM_ACCESS_MAPS;
    }

    try {
      return (
        await this.workspaceCacheService.getOrRecompute(workspaceId, [
          'inconnectTeamAccessMaps',
        ])
      ).inconnectTeamAccessMaps;
    } catch {
      return invalidInconnectTeamAccessMaps(
        'INCONNECT team cache is unavailable',
        'recomputation-failed',
      );
    }
  }
  private async loadWorkspaceContext(
    authContext: WorkspaceAuthContext,
  ): Promise<ORMWorkspaceContext> {
    const workspaceId = authContext.workspace.id;

    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
      featureFlagsMap,
      rolesPermissions: permissionsPerRoleId,
      ORMEntityMetadatas: entityMetadatas,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
      flatRoleMaps,
      flatRowLevelPermissionPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'flatIndexMaps',
      'featureFlagsMap',
      'rolesPermissions',
      'ORMEntityMetadatas',
      'userWorkspaceRoleMap',
      'apiKeyRoleMap',
      'flatRoleMaps',
      'flatRowLevelPermissionPredicateMaps',
      'flatRowLevelPermissionPredicateGroupMaps',
    ]);

    const { idByNameSingular: objectIdByNameSingular } =
      buildObjectIdByNameMaps(flatObjectMetadataMaps);
    const inconnectRecordAccessPolicy =
      await this.inconnectRecordAccessPolicySourceService.resolveWorkspacePolicy(
        {
          workspaceId,
          flatRoleMaps,
          flatObjectMetadataMaps,
          flatFieldMetadataMaps,
        },
      );
    const inconnectTeamAccessMaps =
      await this.loadInconnectTeamAccessMapsIfRequired({
        workspaceId,
        policy: inconnectRecordAccessPolicy,
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });

    return {
      authContext,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
      flatRowLevelPermissionPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps,
      inconnectRecordAccessPolicy,
      inconnectTeamAccessMaps,
      objectIdByNameSingular,
      featureFlagsMap,
      permissionsPerRoleId,
      entityMetadatas,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
    };
  }

  private async loadLiteWorkspaceContext(
    authContext: WorkspaceAuthContext,
  ): Promise<ORMWorkspaceContext> {
    const workspaceId = authContext.workspace.id;

    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatRoleMaps,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
      ORMEntityMetadatas: entityMetadatas,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'flatRoleMaps',
      'userWorkspaceRoleMap',
      'apiKeyRoleMap',
      'ORMEntityMetadatas',
    ]);

    const { idByNameSingular: objectIdByNameSingular } =
      buildObjectIdByNameMaps(flatObjectMetadataMaps);
    const inconnectRecordAccessPolicy =
      await this.inconnectRecordAccessPolicySourceService.resolveWorkspacePolicy(
        {
          workspaceId,
          flatRoleMaps,
          flatObjectMetadataMaps,
          flatFieldMetadataMaps,
        },
      );
    const inconnectTeamAccessMaps =
      await this.loadInconnectTeamAccessMapsIfRequired({
        workspaceId,
        policy: inconnectRecordAccessPolicy,
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });

    return {
      authContext,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatRowLevelPermissionPredicateMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatRowLevelPermissionPredicateGroupMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      inconnectRecordAccessPolicy,
      inconnectTeamAccessMaps,
      objectIdByNameSingular,
      featureFlagsMap: {} as ORMWorkspaceContext['featureFlagsMap'],
      permissionsPerRoleId: {},
      entityMetadatas,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
    };
  }
}
