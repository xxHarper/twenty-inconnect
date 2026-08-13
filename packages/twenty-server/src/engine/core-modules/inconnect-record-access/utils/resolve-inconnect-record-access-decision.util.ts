import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import {
  type InconnectRecordAccessDecision,
  type InconnectRecordAccessWorkspacePolicy,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
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

  const authenticatedWorkspaceMemberId = authContext.workspaceMemberId;

  if (applicableRule.effect === 'ownRecords') {
    return Object.freeze({
      kind: 'owner-workspace-member-ids',
      ownerFieldMetadataId: applicableRule.ownerFieldMetadataId,
      ownerFieldName: applicableRule.ownerFieldName,
      ownerJoinColumnName: applicableRule.ownerJoinColumnName,
      authenticatedWorkspaceMemberId,
      recordScopeOwnerWorkspaceMemberIds: Object.freeze([
        authenticatedWorkspaceMemberId,
      ]),
      assignableOwnerWorkspaceMemberIds: Object.freeze([
        authenticatedWorkspaceMemberId,
      ]),
      sourceEffect: 'ownRecords',
    });
  }

  const teamAccessMapsDecision = resolveInconnectTeamAccessMapsForAuthorization(
    inconnectTeamAccessMaps,
  );

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
  const teamWorkspaceMemberIds =
    membership?.membershipType ===
    InconnectCommercialTeamMembershipType.COORDINATOR
      ? teamAccessMapsDecision.maps.memberWorkspaceMemberIdsByTeamId[
          membership.teamId
        ]
      : undefined;
  const assignableTeamWorkspaceMemberIds =
    membership?.membershipType ===
    InconnectCommercialTeamMembershipType.COORDINATOR
      ? teamAccessMapsDecision.maps.assignableMemberWorkspaceMemberIdsByTeamId[
          membership.teamId
        ]
      : undefined;
  const recordScopeOwnerWorkspaceMemberIds = Object.freeze([
    ...new Set([
      authenticatedWorkspaceMemberId,
      ...(teamWorkspaceMemberIds ?? []),
    ]),
  ]);
  const assignableOwnerWorkspaceMemberIds = Object.freeze([
    ...new Set([
      authenticatedWorkspaceMemberId,
      ...(assignableTeamWorkspaceMemberIds ?? []),
    ]),
  ]);

  return Object.freeze({
    kind: 'owner-workspace-member-ids',
    ownerFieldMetadataId: applicableRule.ownerFieldMetadataId,
    ownerFieldName: applicableRule.ownerFieldName,
    ownerJoinColumnName: applicableRule.ownerJoinColumnName,
    authenticatedWorkspaceMemberId,
    recordScopeOwnerWorkspaceMemberIds,
    assignableOwnerWorkspaceMemberIds,
    sourceEffect: 'ownAndTeamRecords',
  });
};
