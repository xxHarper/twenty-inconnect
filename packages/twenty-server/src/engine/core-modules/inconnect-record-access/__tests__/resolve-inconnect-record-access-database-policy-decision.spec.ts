import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';

const OBJECT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_OBJECT_ID = '00000000-0000-4000-8000-000000000002';
const OWNER_FIELD_ID = '00000000-0000-4000-8000-000000000003';
const EXECUTIVE_ROLE_ID = '00000000-0000-4000-8000-000000000010';
const COORDINATOR_ROLE_ID = '00000000-0000-4000-8000-000000000011';
const SUPERVISOR_ROLE_ID = '00000000-0000-4000-8000-000000000012';
const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000013';
const SCOTT_ID = '00000000-0000-4000-8000-000000000020';
const TIM_ID = '00000000-0000-4000-8000-000000000021';
const PHIL_ID = '00000000-0000-4000-8000-000000000022';
const JANE_ID = '00000000-0000-4000-8000-000000000023';
const TEAM_ID = '00000000-0000-4000-8000-000000000030';

const buildRule = (
  roleId: string,
  recordEffect: 'ownRecords' | 'ownAndTeamRecords' | 'allRecords',
) => ({
  roleId,
  objectMetadataId: OBJECT_ID,
  ownerFieldMetadataId: OWNER_FIELD_ID,
  ownerFieldName: 'owner',
  ownerJoinColumnName: 'ownerId',
  recordEffect,
  createPolicy: 'denied' as const,
  ownerTransferPolicy: 'denied' as const,
  ownerRequirement: 'required' as const,
  missingOwnerPolicy: 'requireExplicit' as const,
});

const policy: InconnectRecordAccessWorkspacePolicy = {
  status: 'configured',
  managedObjectMetadataIds: [OBJECT_ID],
  rules: [
    buildRule(EXECUTIVE_ROLE_ID, 'ownRecords'),
    buildRule(COORDINATOR_ROLE_ID, 'ownAndTeamRecords'),
    buildRule(SUPERVISOR_ROLE_ID, 'allRecords'),
    buildRule(ADMIN_ROLE_ID, 'allRecords'),
  ],
};

const teamMaps: InconnectTeamAccessMaps = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [TIM_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
      isWorkspaceMemberAssignable: true,
    },
    [SCOTT_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: true,
    },
  },
  memberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [TIM_ID, SCOTT_ID],
  },
  assignableMemberWorkspaceMemberIdsByTeamId: {
    [TEAM_ID]: [TIM_ID, SCOTT_ID],
  },
};

const actors = [
  {
    name: 'Scott',
    userWorkspaceId: 'scott-user-workspace',
    workspaceMemberId: SCOTT_ID,
    roleId: EXECUTIVE_ROLE_ID,
  },
  {
    name: 'Tim',
    userWorkspaceId: 'tim-user-workspace',
    workspaceMemberId: TIM_ID,
    roleId: COORDINATOR_ROLE_ID,
  },
  {
    name: 'Phil',
    userWorkspaceId: 'phil-user-workspace',
    workspaceMemberId: PHIL_ID,
    roleId: SUPERVISOR_ROLE_ID,
  },
  {
    name: 'Jane',
    userWorkspaceId: 'jane-user-workspace',
    workspaceMemberId: JANE_ID,
    roleId: ADMIN_ROLE_ID,
  },
] as const;

const resolveForActor = (actor: (typeof actors)[number]) =>
  resolveInconnectRecordAccessDecision({
    policy,
    authContext: {
      type: 'user',
      workspace: { id: 'workspace-id' },
      userWorkspaceId: actor.userWorkspaceId,
      workspaceMemberId: actor.workspaceMemberId,
    } as WorkspaceAuthContext,
    objectMetadataId: OBJECT_ID,
    userWorkspaceRoleMap: {
      [actor.userWorkspaceId]: actor.roleId,
    },
    apiKeyRoleMap: {},
    inconnectTeamAccessMaps: teamMaps,
  });

describe('persisted INCONNECT policy actor decisions', () => {
  it('resolves actor-specific scopes from one shared workspace policy snapshot', () => {
    const scott = resolveForActor(actors[0]);
    const tim = resolveForActor(actors[1]);
    const phil = resolveForActor(actors[2]);
    const jane = resolveForActor(actors[3]);

    expect(scott).toMatchObject({
      kind: 'owner-workspace-member-ids',
      authenticatedWorkspaceMemberId: SCOTT_ID,
      recordScopeOwnerWorkspaceMemberIds: [SCOTT_ID],
    });
    expect(tim).toMatchObject({
      kind: 'owner-workspace-member-ids',
      authenticatedWorkspaceMemberId: TIM_ID,
      recordScopeOwnerWorkspaceMemberIds: [TIM_ID, SCOTT_ID],
    });
    expect(phil).toMatchObject({
      kind: 'all-records',
      authenticatedWorkspaceMemberId: PHIL_ID,
    });
    expect(jane).toMatchObject({
      kind: 'all-records',
      authenticatedWorkspaceMemberId: JANE_ID,
    });
    expect(policy).not.toHaveProperty('authenticatedWorkspaceMemberId');
  });

  it('denies every human Role for an explicitly managed object with zero policies', () => {
    const decision = resolveInconnectRecordAccessDecision({
      policy: {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [],
      },
      authContext: {
        type: 'user',
        workspace: { id: 'workspace-id' },
        userWorkspaceId: actors[0].userWorkspaceId,
        workspaceMemberId: SCOTT_ID,
      } as WorkspaceAuthContext,
      objectMetadataId: OBJECT_ID,
      userWorkspaceRoleMap: {
        [actors[0].userWorkspaceId]: EXECUTIVE_ROLE_ID,
      },
      apiKeyRoleMap: {},
    });

    expect(decision).toMatchObject({ kind: 'denied' });
  });

  it('leaves an object outside the explicit managed-object set to Twenty standard permissions', () => {
    const decision = resolveInconnectRecordAccessDecision({
      policy,
      authContext: {
        type: 'user',
        workspace: { id: 'workspace-id' },
        userWorkspaceId: actors[0].userWorkspaceId,
        workspaceMemberId: SCOTT_ID,
      } as WorkspaceAuthContext,
      objectMetadataId: OTHER_OBJECT_ID,
      userWorkspaceRoleMap: {
        [actors[0].userWorkspaceId]: EXECUTIVE_ROLE_ID,
      },
      apiKeyRoleMap: {},
    });

    expect(decision).toEqual({ kind: 'not-managed' });
  });
});
