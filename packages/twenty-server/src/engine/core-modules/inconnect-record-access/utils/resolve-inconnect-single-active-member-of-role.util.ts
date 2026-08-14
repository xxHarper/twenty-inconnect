import { type QueryRunner } from 'typeorm';

import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

type IdRow = {
  id: string;
};

const throwDefaultOwnerResolutionDenied = (message: string): never => {
  throw new InconnectRecordAccessException(
    message,
    InconnectRecordAccessExceptionCode.ACCESS_DENIED,
  );
};

export const resolveInconnectSingleActiveMemberOfRole = async ({
  queryRunner,
  workspaceId,
  workspaceSchema,
  roleId,
}: {
  queryRunner: QueryRunner;
  workspaceId: string;
  workspaceSchema: string;
  roleId: string;
}): Promise<string> => {
  const roleRows = (await queryRunner.query(
    `SELECT configured_role."id"
    FROM "core"."role" configured_role
    WHERE configured_role."id" = $1::uuid
      AND configured_role."workspaceId" = $2::uuid
    FOR UPDATE OF configured_role`,
    [roleId, workspaceId],
  )) as IdRow[];

  if (roleRows.length !== 1) {
    return throwDefaultOwnerResolutionDenied(
      'The configured default owner Role is not available in this workspace',
    );
  }

  const candidateRows = (await queryRunner.query(
    `SELECT workspace_member."id"
    FROM ${escapeIdentifier(workspaceSchema)}."workspaceMember" workspace_member
    INNER JOIN "core"."userWorkspace" user_workspace
      ON user_workspace."workspaceId" = $2::uuid
      AND user_workspace."userId" = workspace_member."userId"
      AND user_workspace."deletedAt" IS NULL
    INNER JOIN "core"."user" workspace_user
      ON workspace_user."id" = workspace_member."userId"
      AND workspace_user."deletedAt" IS NULL
    INNER JOIN "core"."roleTarget" role_target
      ON role_target."workspaceId" = $2::uuid
      AND role_target."userWorkspaceId" = user_workspace."id"
      AND role_target."roleId" = $1::uuid
    WHERE workspace_member."deletedAt" IS NULL
    ORDER BY workspace_member."id"
    FOR UPDATE OF workspace_member, user_workspace, workspace_user, role_target`,
    [roleId, workspaceId],
  )) as IdRow[];

  if (candidateRows.length !== 1) {
    return throwDefaultOwnerResolutionDenied(
      'The configured default owner Role must have exactly one active Workspace Member',
    );
  }

  return candidateRows[0].id;
};
