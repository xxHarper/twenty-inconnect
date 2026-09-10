import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { isNonEmptyString } from '@sniptt/guards';
import { type DataSource, type SelectQueryBuilder } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import {
  type InconnectRecordAccessDecision,
  type InconnectRecordAccessWorkspacePolicy,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { doesInconnectRecordAccessPolicyRequireTeamAuthority } from 'src/engine/core-modules/inconnect-record-access/utils/does-inconnect-record-access-policy-require-team-authority.util';
import { invalidInconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';
import { renderInconnectRecordAccessCondition } from 'src/engine/core-modules/inconnect-record-access/utils/render-inconnect-record-access-condition.util';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type UserWorkspaceRoleMap } from 'src/engine/metadata-modules/role-target/types/user-workspace-role-map';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

export type InconnectRecordAccessReadScope =
  | { kind: 'not-managed' }
  | { kind: 'system-bypass' }
  | { kind: 'denied' }
  | { kind: 'all-records' }
  | { kind: 'owner-scoped' };

export type InconnectRecordAccessExistsCondition = {
  scope: InconnectRecordAccessReadScope;
  sql: string;
  parameters: Record<string, unknown>;
};

type ReadScopeQueryBuilder = Pick<
  SelectQueryBuilder<object>,
  'andWhere' | 'setParameters'
>;

type ResolveReadAuthorizationArgs = {
  workspaceId: string;
  objectMetadataId: string;
  authContext: WorkspaceAuthContext;
};

type ResolvedReadAuthorization = {
  scope: InconnectRecordAccessReadScope;
  decision: InconnectRecordAccessDecision;
  objectMetadata: FlatObjectMetadata;
  databaseSchema: string;
};

const DENIED_SCOPE = Object.freeze({ kind: 'denied' } as const);

@Injectable()
export class InconnectRecordAccessAuthorizationService {
  constructor(
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly policySourceService: InconnectRecordAccessPolicySourceService,
    private readonly workspaceMemberService: InconnectWorkspaceMemberService,
  ) {}

  async resolveReadScope(
    args: ResolveReadAuthorizationArgs,
  ): Promise<InconnectRecordAccessReadScope> {
    return (await this.resolveReadAuthorization(args))?.scope ?? DENIED_SCOPE;
  }

  async isAuthenticatedWorkspaceMemberValid({
    workspaceId,
    authContext,
  }: {
    workspaceId: string;
    authContext: WorkspaceAuthContext;
  }): Promise<boolean> {
    if (
      !isUserAuthContext(authContext) ||
      authContext.workspace.id !== workspaceId ||
      !isNonEmptyString(authContext.workspace.databaseSchema) ||
      authContext.workspaceMember.id !== authContext.workspaceMemberId
    ) {
      return false;
    }

    try {
      await this.workspaceMemberService.assertActiveWorkspaceMember({
        manager: this.coreDataSource.manager,
        workspaceId,
        workspaceMemberId: authContext.workspaceMemberId,
      });

      return true;
    } catch {
      return false;
    }
  }

  async applyReadScopeToQueryBuilder({
    queryBuilder,
    tableAlias,
    ...args
  }: ResolveReadAuthorizationArgs & {
    queryBuilder: ReadScopeQueryBuilder;
    tableAlias: string;
  }): Promise<InconnectRecordAccessReadScope> {
    const authorization = await this.resolveReadAuthorization(args);

    if (!authorization) {
      queryBuilder.andWhere('1 = 0');

      return DENIED_SCOPE;
    }

    this.applyDecisionToQueryBuilder({
      queryBuilder,
      tableAlias,
      decision: authorization.decision,
    });

    return authorization.scope;
  }

  async isRecordReadable({
    recordId,
    ...args
  }: ResolveReadAuthorizationArgs & { recordId: string }): Promise<boolean> {
    const authorization = await this.resolveReadAuthorization(args);

    if (!authorization) {
      return false;
    }

    try {
      const tableAlias = 'inconnect_authorized_record';
      const qualifiedTableName = `${authorization.databaseSchema}.${computeObjectTargetTable(
        authorization.objectMetadata,
      )}`;
      const queryBuilder = this.coreDataSource
        .createQueryBuilder()
        .select('1', 'authorized')
        .from(qualifiedTableName, tableAlias)
        .where(`${escapeIdentifier(tableAlias)}."id" = :recordId`, {
          recordId,
        })
        .andWhere(`${escapeIdentifier(tableAlias)}."deletedAt" IS NULL`)
        .limit(1);

      this.applyDecisionToQueryBuilder({
        queryBuilder,
        tableAlias,
        decision: authorization.decision,
      });

      return Boolean(await queryBuilder.getRawOne());
    } catch {
      return false;
    }
  }

  async buildAuthorizedRecordExistsCondition({
    recordIdReference,
    ...args
  }: ResolveReadAuthorizationArgs & {
    recordIdReference: { tableAlias: string; columnName: string };
  }): Promise<InconnectRecordAccessExistsCondition> {
    const authorization = await this.resolveReadAuthorization(args);

    if (!authorization) {
      return { scope: DENIED_SCOPE, sql: '1 = 0', parameters: {} };
    }

    const recordAlias = `inconnect_record_${args.objectMetadataId.replace(
      /-/g,
      '_',
    )}`;
    const qualifiedTableName = `${escapeIdentifier(
      authorization.databaseSchema,
    )}.${escapeIdentifier(
      computeObjectTargetTable(authorization.objectMetadata),
    )}`;
    const conditions = [
      `${escapeIdentifier(recordAlias)}."id" = ${escapeIdentifier(
        recordIdReference.tableAlias,
      )}.${escapeIdentifier(recordIdReference.columnName)}`,
      `${escapeIdentifier(recordAlias)}."deletedAt" IS NULL`,
    ];
    let parameters: Record<string, unknown> = {};

    if (
      authorization.decision.kind === 'denied' ||
      authorization.decision.kind === 'owner-workspace-member-ids'
    ) {
      const renderedCondition = renderInconnectRecordAccessCondition({
        decision: authorization.decision,
        tableAlias: recordAlias,
      });

      conditions.push(renderedCondition.sql);
      parameters = renderedCondition.parameters;
    }

    return {
      scope: authorization.scope,
      sql: `EXISTS (SELECT 1 FROM ${qualifiedTableName} ${escapeIdentifier(
        recordAlias,
      )} WHERE ${conditions.join(' AND ')})`,
      parameters,
    };
  }

  private async resolveReadAuthorization({
    workspaceId,
    objectMetadataId,
    authContext,
  }: ResolveReadAuthorizationArgs): Promise<ResolvedReadAuthorization | null> {
    if (
      authContext.workspace.id !== workspaceId ||
      !isNonEmptyString(authContext.workspace.databaseSchema)
    ) {
      return null;
    }

    if (authContext.type === 'pendingActivationUser') {
      return null;
    }

    if (
      isUserAuthContext(authContext) &&
      !(await this.isAuthenticatedWorkspaceMemberValid({
        workspaceId,
        authContext,
      }))
    ) {
      return null;
    }

    try {
      const {
        flatRoleMaps,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatRoleMaps',
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
        'userWorkspaceRoleMap',
        'apiKeyRoleMap',
      ]);
      const objectUniversalIdentifier =
        flatObjectMetadataMaps.universalIdentifierById[objectMetadataId];
      const objectMetadata = objectUniversalIdentifier
        ? flatObjectMetadataMaps.byUniversalIdentifier[
            objectUniversalIdentifier
          ]
        : undefined;

      if (
        !objectMetadata ||
        objectMetadata.id !== objectMetadataId ||
        objectMetadata.workspaceId !== workspaceId
      ) {
        return null;
      }

      const policy = await this.policySourceService.resolveWorkspacePolicy({
        workspaceId,
        flatRoleMaps,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
      });
      const inconnectTeamAccessMaps = await this.loadTeamAuthorityIfRequired({
        workspaceId,
        policy,
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });
      const decision = resolveInconnectRecordAccessDecision({
        policy,
        authContext,
        objectMetadataId,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
        inconnectTeamAccessMaps,
      });

      return {
        scope: this.toPublicReadScope(decision),
        decision,
        objectMetadata,
        databaseSchema: authContext.workspace.databaseSchema,
      };
    } catch {
      return null;
    }
  }

  private async loadTeamAuthorityIfRequired({
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
  }): Promise<unknown> {
    if (
      !doesInconnectRecordAccessPolicyRequireTeamAuthority({
        policy,
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      })
    ) {
      return undefined;
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

  private applyDecisionToQueryBuilder({
    queryBuilder,
    tableAlias,
    decision,
  }: {
    queryBuilder: ReadScopeQueryBuilder;
    tableAlias: string;
    decision: InconnectRecordAccessDecision;
  }): void {
    if (
      decision.kind !== 'denied' &&
      decision.kind !== 'owner-workspace-member-ids'
    ) {
      return;
    }

    const renderedCondition = renderInconnectRecordAccessCondition({
      decision,
      tableAlias,
    });

    queryBuilder.andWhere(renderedCondition.sql);
    queryBuilder.setParameters(renderedCondition.parameters);
  }

  private toPublicReadScope(
    decision: InconnectRecordAccessDecision,
  ): InconnectRecordAccessReadScope {
    switch (decision.kind) {
      case 'not-managed':
      case 'system-bypass':
      case 'denied':
      case 'all-records':
        return { kind: decision.kind };
      case 'owner-workspace-member-ids':
        return { kind: 'owner-scoped' };
    }
  }
}
