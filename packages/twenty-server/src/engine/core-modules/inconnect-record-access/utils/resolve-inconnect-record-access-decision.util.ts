import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  type InconnectRecordAccessDecision,
  type InconnectRecordAccessWorkspacePolicy,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type UserWorkspaceRoleMap } from 'src/engine/metadata-modules/role-target/types/user-workspace-role-map';
import { resolveRoleIdsFromAuthContext } from 'src/engine/twenty-orm/utils/resolve-role-ids-from-auth-context.util';

export const resolveInconnectRecordAccessDecision = ({
  policy,
  authContext,
  objectMetadataId,
  userWorkspaceRoleMap,
  apiKeyRoleMap,
}: {
  policy: InconnectRecordAccessWorkspacePolicy;
  authContext: WorkspaceAuthContext;
  objectMetadataId: string;
  userWorkspaceRoleMap: UserWorkspaceRoleMap;
  apiKeyRoleMap: Record<string, string>;
}): InconnectRecordAccessDecision => {
  if (authContext.type === 'system') {
    return { kind: 'unrestricted' };
  }

  if (policy.status === 'not-configured') {
    return { kind: 'unrestricted' };
  }

  if (policy.status === 'invalid') {
    return { kind: 'denied' };
  }

  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap,
    apiKeyRoleMap,
  });
  const applicableRules = policy.rules.filter(
    (rule) =>
      rule.objectMetadataId === objectMetadataId &&
      roleIds.includes(rule.roleId),
  );

  if (applicableRules.length === 0) {
    return { kind: 'unrestricted' };
  }

  if (!isUserAuthContext(authContext)) {
    return { kind: 'denied' };
  }

  const ownerJoinColumnNames = new Set(
    applicableRules.map((rule) => rule.ownerJoinColumnName),
  );

  if (ownerJoinColumnNames.size !== 1) {
    return { kind: 'denied' };
  }

  return {
    kind: 'scoped',
    ownerFieldMetadataId: applicableRules[0].ownerFieldMetadataId,
    ownerFieldName: applicableRules[0].ownerFieldName,
    ownerJoinColumnName: applicableRules[0].ownerJoinColumnName,
    workspaceMemberId: authContext.workspaceMemberId,
  };
};
