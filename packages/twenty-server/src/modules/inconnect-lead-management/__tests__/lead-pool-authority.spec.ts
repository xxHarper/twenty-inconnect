import { makeAuthorityHarness } from './lead-pool-authority.fixtures';
import { actor, originId, poolId, recipientId } from './lead-pool.fixtures';

describe('real Lead pool authorization with simulated repositories and caches', () => {
  it('uses metadata and permission/policy identifiers, independently of role names', async () => {
    const harness = makeAuthorityHarness();
    harness.maps.flatRoleMaps.byUniversalIdentifier[harness.roleId].label =
      'Ejecutivo Supervisor';
    const result = await harness.service.resolve(actor, originId);
    expect(result.ownerColumn).toBe('commercialOwnerId');
    expect(result.recipients).toEqual([
      { id: recipientId, label: 'Ejecutivo Autorizado' },
    ]);
    expect(result.publicFields.map((field) => field.type)).toEqual([
      'TEXT',
      'SELECT',
      'BOOLEAN',
      'DATE_TIME',
    ]);
    expect(harness.repos.object.findOne).toHaveBeenCalledWith({
      where: { id: originId, workspaceId: actor.workspace.id, isActive: true },
    });
  });
  it.each(['system', 'apiKey', 'application', 'pendingActivationUser'])(
    'denies the %s principal',
    async (type) => {
      await expect(
        makeAuthorityHarness().service.resolve(
          { ...actor, type } as never,
          originId,
        ),
      ).rejects.toThrow();
    },
  );
  it('denies application-bound humans rather than dropping application authority', async () => {
    await expect(
      makeAuthorityHarness().service.resolve(
        { ...actor, application: { id: poolId(999) } } as never,
        originId,
      ),
    ).rejects.toThrow();
  });
  it('requires an active authenticated membership and matching user', async () => {
    const harness = makeAuthorityHarness();
    harness.recordAccess.isAuthenticatedWorkspaceMemberValid.mockResolvedValue(
      false,
    );
    await expect(harness.service.resolve(actor, originId)).rejects.toThrow();
    await expect(
      makeAuthorityHarness().service.resolve(
        { ...actor, user: { ...actor.user, id: poolId(999) } },
        originId,
      ),
    ).rejects.toThrow();
  });
  it.each([
    'read',
    'update',
    'owner read',
    'owner update',
    'label read',
    'member read',
    'member name',
  ])('requires standard %s permission', async (permission) => {
    const harness = makeAuthorityHarness();
    const objectPermission =
      harness.maps.rolesPermissions[harness.roleId][originId];
    if (permission === 'read') objectPermission.canReadObjectRecords = false;
    if (permission === 'update')
      objectPermission.canUpdateObjectRecords = false;
    if (permission === 'owner read')
      objectPermission.restrictedFields[harness.owner.id] = { canRead: false };
    if (permission === 'owner update')
      objectPermission.restrictedFields[harness.owner.id] = {
        canUpdate: false,
      };
    if (permission === 'label read')
      objectPermission.restrictedFields[harness.label.id] = { canRead: false };
    if (permission === 'member read')
      harness.maps.rolesPermissions[harness.roleId][
        harness.targetId
      ].canReadObjectRecords = false;
    if (permission === 'member name')
      harness.maps.rolesPermissions[harness.roleId][
        harness.targetId
      ].restrictedFields[poolId(80)] = { canRead: false };
    await expect(harness.service.resolve(actor, originId)).rejects.toThrow();
  });
  it('denies a managed Role with transfer denied, even when standard update is true', async () => {
    const harness = makeAuthorityHarness();
    if (harness.policy.status === 'configured')
      harness.policy.rules[0] = {
        ...harness.policy.rules[0],
        ownerTransferPolicy: 'denied',
      };
    await expect(harness.service.resolve(actor, originId)).rejects.toThrow();
  });
  it('denies missing Role assignment and missing applicable policy', async () => {
    const harness = makeAuthorityHarness();
    delete harness.maps.userWorkspaceRoleMap[actor.userWorkspaceId];
    await expect(harness.service.resolve(actor, originId)).rejects.toThrow();
    const missing = makeAuthorityHarness();
    if (missing.policy.status === 'configured') missing.policy.rules = [];
    await expect(missing.service.resolve(actor, originId)).rejects.toThrow();
  });
  it.each([
    'cross workspace',
    'owner target',
    'cached owner drift',
    'label type',
    'application drift',
  ])('fails closed for %s', async (change) => {
    const harness = makeAuthorityHarness();
    if (change === 'cross workspace')
      harness.maps.flatObjectMetadataMaps.byUniversalIdentifier[
        originId
      ].workspaceId = poolId(999);
    if (change === 'owner target')
      harness.owner.relationTargetObjectMetadataId = originId;
    if (change === 'cached owner drift')
      harness.maps.flatFieldMetadataMaps.byUniversalIdentifier[
        harness.owner.id
      ].name = 'changedOwner';
    if (change === 'label type')
      Object.assign(harness.label, { type: 'PHONES' });
    if (change === 'application drift')
      harness.object.applicationId = poolId(999);
    await expect(harness.service.resolve(actor, originId)).rejects.toThrow();
  });
  it('hides unreadable filter fields and rejects an inactive or Role-less destination', async () => {
    const harness = makeAuthorityHarness();
    harness.maps.rolesPermissions[harness.roleId][originId].restrictedFields[
      harness.boolean.id
    ] = { canRead: false };
    harness.profile.isAssignable = false;
    const result = await harness.service.resolve(actor, originId);
    expect(
      result.publicFields.some((field) => field.id === harness.boolean.id),
    ).toBe(false);
    expect(() =>
      harness.service.assertRecipients(result, [recipientId]),
    ).toThrow();
    harness.profile.isAssignable = true;
    delete harness.maps.userWorkspaceRoleMap[poolId(83)];
    expect((await harness.service.resolve(actor, originId)).recipients).toEqual(
      [],
    );
  });
  it('resolves current Team scope and revokes a destination after moving Teams', async () => {
    const harness = makeAuthorityHarness();
    if (harness.policy.status === 'configured')
      harness.policy.rules[0] = {
        ...harness.policy.rules[0],
        recordEffect: 'ownAndTeamRecords',
        ownerTransferPolicy: 'assignableOwners',
      };
    const before = await harness.service.resolve(actor, originId);
    harness.service.assertRecipients(before, [recipientId]);
    const teams = harness.maps.inconnectTeamAccessMaps;
    teams.membershipByWorkspaceMemberId[recipientId].teamId = poolId(85);
    teams.memberWorkspaceMemberIdsByTeamId[poolId(84)] = [
      actor.workspaceMemberId,
    ];
    teams.assignableMemberWorkspaceMemberIdsByTeamId[poolId(84)] = [
      actor.workspaceMemberId,
    ];
    teams.memberWorkspaceMemberIdsByTeamId[poolId(85)] = [recipientId];
    teams.assignableMemberWorkspaceMemberIdsByTeamId[poolId(85)] = [
      recipientId,
    ];
    const after = await harness.service.resolve(actor, originId);
    expect(after.hash).not.toBe(before.hash);
    expect(() =>
      harness.service.assertRecipients(after, [recipientId]),
    ).toThrow();
  });
  it('uses no Messaging service or permission when resolving transfer authority', async () => {
    const harness = makeAuthorityHarness();
    const result = await harness.service.resolve(actor, originId);
    expect(result.context.rolePermissionConfig).toEqual({
      intersectionOf: [harness.roleId],
    });
    expect(Object.keys(harness.maps.rolesPermissions[harness.roleId])).toEqual([
      originId,
      harness.targetId,
    ]);
  });
});
