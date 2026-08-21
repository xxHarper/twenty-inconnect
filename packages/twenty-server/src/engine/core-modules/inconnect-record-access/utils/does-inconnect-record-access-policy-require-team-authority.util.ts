import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { getInconnectRecordAccessRuleKey } from 'src/engine/core-modules/inconnect-record-access/utils/get-inconnect-record-access-rule-key.util';
import { type UserWorkspaceRoleMap } from 'src/engine/metadata-modules/role-target/types/user-workspace-role-map';
import { resolveRoleIdsFromAuthContext } from 'src/engine/twenty-orm/utils/resolve-role-ids-from-auth-context.util';

export const doesInconnectRecordAccessPolicyRequireTeamAuthority = ({
  policy,
  authContext,
  userWorkspaceRoleMap,
  apiKeyRoleMap,
}: {
  policy: InconnectRecordAccessWorkspacePolicy;
  authContext: WorkspaceAuthContext;
  userWorkspaceRoleMap: UserWorkspaceRoleMap;
  apiKeyRoleMap: Record<string, string>;
}): boolean => {
  if (policy.status !== 'configured' || !isUserAuthContext(authContext)) {
    return false;
  }

  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap,
    apiKeyRoleMap,
  });

  const applicableRules = policy.ruleByObjectMetadataIdAndRoleId
    ? policy.managedObjectMetadataIds.flatMap((objectMetadataId) =>
        roleIds.flatMap((roleId) => {
          const rule =
            policy.ruleByObjectMetadataIdAndRoleId?.[
              getInconnectRecordAccessRuleKey({ objectMetadataId, roleId })
            ];

          return rule ? [rule] : [];
        }),
      )
    : policy.rules.filter((rule) => roleIds.includes(rule.roleId));

  return applicableRules.some(
    (rule) =>
      rule.recordEffect === 'ownAndTeamRecords' ||
      rule.createPolicy === 'assignableOwners' ||
      rule.ownerTransferPolicy === 'assignableOwners',
  );
};
