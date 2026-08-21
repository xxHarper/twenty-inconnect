import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import {
  type InconnectRecordAccessDecision,
  type InconnectRecordAccessWorkspacePolicy,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { getInconnectRecordAccessRuleKey } from 'src/engine/core-modules/inconnect-record-access/utils/get-inconnect-record-access-rule-key.util';
import { resolveInconnectTeamAccessMapsForAuthorization } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';
import { type UserWorkspaceRoleMap } from 'src/engine/metadata-modules/role-target/types/user-workspace-role-map';
import { resolveRoleIdsFromAuthContext } from 'src/engine/twenty-orm/utils/resolve-role-ids-from-auth-context.util';

export const resolveInconnectRecordAccessDecision = ({
  policy,
  authContext,
  objectMetadataId,
  userWorkspaceRoleMap,
  apiKeyRoleMap,
  inconnectTeamAccessMaps,
}: {
  policy: InconnectRecordAccessWorkspacePolicy;
  authContext: WorkspaceAuthContext;
  objectMetadataId: string;
  userWorkspaceRoleMap: UserWorkspaceRoleMap;
  apiKeyRoleMap: Record<string, string>;
  inconnectTeamAccessMaps?: unknown;
}): InconnectRecordAccessDecision => {
  if (authContext.type === 'system') {
    return { kind: 'system-bypass' };
  }

  if (policy.status === 'not-configured' || policy.status === 'unmanaged') {
    return { kind: 'not-managed' };
  }

  if (policy.status === 'invalid') {
    return { kind: 'denied', reason: policy.reason };
  }

  if (!policy.managedObjectMetadataIds.includes(objectMetadataId)) {
    return { kind: 'not-managed' };
  }

  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap,
    apiKeyRoleMap,
  });
  const applicableRules = policy.ruleByObjectMetadataIdAndRoleId
    ? roleIds.flatMap((roleId) => {
        const rule =
          policy.ruleByObjectMetadataIdAndRoleId?.[
            getInconnectRecordAccessRuleKey({ objectMetadataId, roleId })
          ];

        return rule ? [rule] : [];
      })
    : policy.rules.filter(
        (rule) =>
          rule.objectMetadataId === objectMetadataId &&
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
  const authenticatedWorkspaceMemberId = authContext.workspaceMemberId;
  const needsTeamAuthority =
    applicableRule.recordEffect === 'ownAndTeamRecords' ||
    applicableRule.createPolicy === 'assignableOwners' ||
    applicableRule.ownerTransferPolicy === 'assignableOwners';
  let teamWorkspaceMemberIds: readonly string[] = [];
  let assignableTeamWorkspaceMemberIds: readonly string[] = [];

  if (needsTeamAuthority) {
    const teamAccessMapsDecision =
      resolveInconnectTeamAccessMapsForAuthorization(inconnectTeamAccessMaps);

    if (teamAccessMapsDecision.kind === 'denied') {
      return {
        kind: 'denied',
        reason: `INCONNECT team authority is ${teamAccessMapsDecision.reason}`,
      };
    }

    const membership =
      teamAccessMapsDecision.maps.membershipByWorkspaceMemberId[
        authenticatedWorkspaceMemberId
      ];

    if (
      membership?.membershipType ===
      InconnectCommercialTeamMembershipType.COORDINATOR
    ) {
      teamWorkspaceMemberIds =
        teamAccessMapsDecision.maps.memberWorkspaceMemberIdsByTeamId[
          membership.teamId
        ] ?? [];
      assignableTeamWorkspaceMemberIds =
        teamAccessMapsDecision.maps.assignableMemberWorkspaceMemberIdsByTeamId[
          membership.teamId
        ] ?? [];
    }
  }

  const recordScopeOwnerWorkspaceMemberIds = Object.freeze([
    ...new Set([
      authenticatedWorkspaceMemberId,
      ...(applicableRule.recordEffect === 'ownAndTeamRecords'
        ? teamWorkspaceMemberIds
        : []),
    ]),
  ]);
  const assignableOwnerWorkspaceMemberIds = Object.freeze([
    ...new Set([
      authenticatedWorkspaceMemberId,
      ...(applicableRule.createPolicy === 'assignableOwners' ||
      applicableRule.ownerTransferPolicy === 'assignableOwners'
        ? assignableTeamWorkspaceMemberIds
        : []),
    ]),
  ]);
  const managedDecision = {
    ownerFieldMetadataId: applicableRule.ownerFieldMetadataId,
    ownerFieldName: applicableRule.ownerFieldName,
    ownerJoinColumnName: applicableRule.ownerJoinColumnName,
    authenticatedWorkspaceMemberId,
    assignableOwnerWorkspaceMemberIds,
    createPolicy: applicableRule.createPolicy,
    ownerTransferPolicy: applicableRule.ownerTransferPolicy,
    ownerRequirement: applicableRule.ownerRequirement,
    missingOwnerPolicy: applicableRule.missingOwnerPolicy,
    ...(applicableRule.defaultOwnerRoleId
      ? { defaultOwnerRoleId: applicableRule.defaultOwnerRoleId }
      : {}),
  } as const;

  if (applicableRule.recordEffect === 'allRecords') {
    return Object.freeze({
      kind: 'all-records',
      ...managedDecision,
      sourceRecordEffect: 'allRecords',
    });
  }

  return Object.freeze({
    kind: 'owner-workspace-member-ids',
    ...managedDecision,
    recordScopeOwnerWorkspaceMemberIds,
    sourceRecordEffect: applicableRule.recordEffect,
  });
};
