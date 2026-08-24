import { Injectable } from '@nestjs/common';

import { type EntityManager } from 'typeorm';

import {
  InconnectCommercialTeamException,
  InconnectCommercialTeamExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team.exception';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

export type InconnectWorkspaceMemberState = {
  id: string;
  isAssignable: boolean;
};

export type InconnectWorkspaceMemberProfile = InconnectWorkspaceMemberState & {
  firstName: string;
  lastName: string;
  email: string | null;
};

type WorkspaceMemberStateRow = {
  id: string;
  isAssignable: boolean;
};

type WorkspaceMemberProfileRow = WorkspaceMemberStateRow & {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

@Injectable()
export class InconnectWorkspaceMemberService {
  async getWorkspaceMemberStates({
    manager,
    workspaceId,
    workspaceMemberIds,
  }: {
    manager: EntityManager;
    workspaceId: string;
    workspaceMemberIds: string[];
  }): Promise<Map<string, InconnectWorkspaceMemberState>> {
    if (workspaceMemberIds.length === 0) {
      return new Map();
    }

    const databaseSchema = await this.getWorkspaceDatabaseSchema({
      manager,
      workspaceId,
    });
    const rows = (await manager.query(
      `SELECT
        workspace_member."id",
        (
          workspace_member."deletedAt" IS NULL
          AND user_workspace."id" IS NOT NULL
          AND workspace_user."id" IS NOT NULL
        ) AS "isAssignable"
      FROM ${escapeIdentifier(databaseSchema)}."workspaceMember" workspace_member
      LEFT JOIN "core"."userWorkspace" user_workspace
        ON user_workspace."workspaceId" = $2
        AND user_workspace."userId" = workspace_member."userId"
        AND user_workspace."deletedAt" IS NULL
      LEFT JOIN "core"."user" workspace_user
        ON workspace_user."id" = workspace_member."userId"
        AND workspace_user."deletedAt" IS NULL
      WHERE workspace_member."id" = ANY($1::uuid[])`,
      [workspaceMemberIds, workspaceId],
    )) as WorkspaceMemberStateRow[];

    return new Map(
      rows.map((row) => [
        row.id,
        { id: row.id, isAssignable: row.isAssignable },
      ]),
    );
  }

  async getWorkspaceMemberProfiles({
    manager,
    workspaceId,
    workspaceMemberIds,
  }: {
    manager: EntityManager;
    workspaceId: string;
    workspaceMemberIds: string[];
  }): Promise<Map<string, InconnectWorkspaceMemberProfile>> {
    if (workspaceMemberIds.length === 0) {
      return new Map();
    }

    const databaseSchema = await this.getWorkspaceDatabaseSchema({
      manager,
      workspaceId,
    });
    const rows = (await manager.query(
      `SELECT
        workspace_member."id",
        workspace_member."nameFirstName" AS "firstName",
        workspace_member."nameLastName" AS "lastName",
        workspace_member."userEmail" AS "email",
        (
          workspace_member."deletedAt" IS NULL
          AND user_workspace."id" IS NOT NULL
          AND workspace_user."id" IS NOT NULL
        ) AS "isAssignable"
      FROM ${escapeIdentifier(databaseSchema)}."workspaceMember" workspace_member
      LEFT JOIN "core"."userWorkspace" user_workspace
        ON user_workspace."workspaceId" = $2
        AND user_workspace."userId" = workspace_member."userId"
        AND user_workspace."deletedAt" IS NULL
      LEFT JOIN "core"."user" workspace_user
        ON workspace_user."id" = workspace_member."userId"
        AND workspace_user."deletedAt" IS NULL
      WHERE workspace_member."id" = ANY($1::uuid[])`,
      [workspaceMemberIds, workspaceId],
    )) as WorkspaceMemberProfileRow[];

    return this.toWorkspaceMemberProfileMap(rows);
  }

  async getAssignableWorkspaceMemberProfiles({
    manager,
    workspaceId,
  }: {
    manager: EntityManager;
    workspaceId: string;
  }): Promise<InconnectWorkspaceMemberProfile[]> {
    const databaseSchema = await this.getWorkspaceDatabaseSchema({
      manager,
      workspaceId,
    });
    const rows = (await manager.query(
      `SELECT
        workspace_member."id",
        workspace_member."nameFirstName" AS "firstName",
        workspace_member."nameLastName" AS "lastName",
        workspace_member."userEmail" AS "email",
        true AS "isAssignable"
      FROM ${escapeIdentifier(databaseSchema)}."workspaceMember" workspace_member
      INNER JOIN "core"."userWorkspace" user_workspace
        ON user_workspace."workspaceId" = $1
        AND user_workspace."userId" = workspace_member."userId"
        AND user_workspace."deletedAt" IS NULL
      INNER JOIN "core"."user" workspace_user
        ON workspace_user."id" = workspace_member."userId"
        AND workspace_user."deletedAt" IS NULL
      WHERE workspace_member."deletedAt" IS NULL
      ORDER BY
        workspace_member."nameFirstName",
        workspace_member."nameLastName",
        workspace_member."id"`,
      [workspaceId],
    )) as WorkspaceMemberProfileRow[];

    return [...this.toWorkspaceMemberProfileMap(rows).values()];
  }

  async assertAssignableWorkspaceMember({
    manager,
    workspaceId,
    workspaceMemberId,
  }: {
    manager: EntityManager;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<void> {
    const databaseSchema = await this.getWorkspaceDatabaseSchema({
      manager,
      workspaceId,
    });
    const rows = (await manager.query(
      `SELECT workspace_member."id"
      FROM ${escapeIdentifier(databaseSchema)}."workspaceMember" workspace_member
      INNER JOIN "core"."userWorkspace" user_workspace
        ON user_workspace."workspaceId" = $2
        AND user_workspace."userId" = workspace_member."userId"
        AND user_workspace."deletedAt" IS NULL
      INNER JOIN "core"."user" workspace_user
        ON workspace_user."id" = workspace_member."userId"
        AND workspace_user."deletedAt" IS NULL
      WHERE workspace_member."id" = $1::uuid
        AND workspace_member."deletedAt" IS NULL
      FOR UPDATE OF workspace_member, user_workspace, workspace_user`,
      [workspaceMemberId, workspaceId],
    )) as Array<{ id: string }>;

    if (rows.length !== 1) {
      throw new InconnectCommercialTeamException(
        'Workspace Member does not exist in this workspace or is not assignable',
        InconnectCommercialTeamExceptionCode.WORKSPACE_MEMBER_INVALID,
      );
    }
  }

  async assertActiveWorkspaceMember(args: {
    manager: EntityManager;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<void> {
    return this.assertAssignableWorkspaceMember(args);
  }

  private toWorkspaceMemberProfileMap(
    rows: WorkspaceMemberProfileRow[],
  ): Map<string, InconnectWorkspaceMemberProfile> {
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          firstName: row.firstName ?? '',
          lastName: row.lastName ?? '',
          email: row.email,
          isAssignable: row.isAssignable,
        },
      ]),
    );
  }

  private async getWorkspaceDatabaseSchema({
    manager,
    workspaceId,
  }: {
    manager: EntityManager;
    workspaceId: string;
  }): Promise<string> {
    const workspace = await manager.getRepository(WorkspaceEntity).findOne({
      where: { id: workspaceId },
      select: { id: true, databaseSchema: true },
    });

    if (!workspace?.databaseSchema) {
      throw new InconnectCommercialTeamException(
        'Workspace has no database schema',
        InconnectCommercialTeamExceptionCode.WORKSPACE_MEMBER_INVALID,
      );
    }

    return workspace.databaseSchema;
  }
}
