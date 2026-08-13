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
    return { kind: 'system-bypass' };
  }

  if (policy.status === 'not-configured') {
    return { kind: 'not-managed' };
  }

  if (policy.status === 'invalid') {
    return { kind: 'denied', reason: policy.reason };
  }

  const objectRules = policy.rules.filter(
    (rule) => rule.objectMetadataId === objectMetadataId,
  );

  if (objectRules.length === 0) {
    return { kind: 'not-managed' };
  }

  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap,
    apiKeyRoleMap,
  });
  const applicableRules = objectRules.filter((rule) =>
    roleIds.includes(rule.roleId),
  );

  if (applicableRules.length === 0) {
    return {
      kind: 'denied',
      reason: 'No INCONNECT rule applies to this Role on a managed object',
    };
  }

  if (applicableRules.length !== 1) {
    return { kind: 'denied', reason: 'Ambiguous INCONNECT Role rules' };
  }

  if (!isUserAuthContext(authContext)) {
    return {
      kind: 'denied',
      reason: 'A Workspace Member is required by the INCONNECT policy',
    };
  }

  const [applicableRule] = applicableRules;

  if (applicableRule.effect === 'allRecords') {
    return { kind: 'all-records' };
  }

  return {
    kind:
      applicableRule.effect === 'ownRecords'
        ? 'own-records'
        : 'own-and-team-records',
    ownerFieldMetadataId: applicableRule.ownerFieldMetadataId,
    ownerFieldName: applicableRule.ownerFieldName,
    ownerJoinColumnName: applicableRule.ownerJoinColumnName,
    workspaceMemberId: authContext.workspaceMemberId,
  };
};
