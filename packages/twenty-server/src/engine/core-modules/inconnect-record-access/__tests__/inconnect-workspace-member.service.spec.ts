import { type EntityManager } from 'typeorm';

import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_MEMBER_ID = '00000000-0000-4000-8000-000000000201';

const buildManager = (rows: Array<Record<string, unknown>>) => {
  const query = jest.fn().mockResolvedValue(rows);
  const manager = {
    getRepository: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue({
        id: WORKSPACE_ID,
        databaseSchema: 'workspace_test_schema',
      }),
    })),
    query,
  } as unknown as EntityManager;

  return { manager, query };
};

describe('InconnectWorkspaceMemberService', () => {
  it('locks WorkspaceMember, UserWorkspace and User against concurrent deactivation', async () => {
    const { manager, query } = buildManager([{ id: WORKSPACE_MEMBER_ID }]);
    const service = new InconnectWorkspaceMemberService();

    await expect(
      service.assertAssignableWorkspaceMember({
        manager,
        workspaceId: WORKSPACE_ID,
        workspaceMemberId: WORKSPACE_MEMBER_ID,
      }),
    ).resolves.toBeUndefined();

    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toContain('workspace_test_schema');
    expect(sql).toContain('INNER JOIN "core"."userWorkspace"');
    expect(sql).toContain('INNER JOIN "core"."user"');
    expect(sql).toContain(
      'FOR UPDATE OF workspace_member, user_workspace, workspace_user',
    );
    expect(sql).not.toContain('disabled');
    expect(parameters).toEqual([WORKSPACE_MEMBER_ID, WORKSPACE_ID]);
  });

  it.each([
    'WorkspaceMember missing or deleted',
    'UserWorkspace missing or deleted',
    'User missing or deleted',
  ])('rejects when %s', async () => {
    const { manager } = buildManager([]);
    const service = new InconnectWorkspaceMemberService();

    await expect(
      service.assertAssignableWorkspaceMember({
        manager,
        workspaceId: WORKSPACE_ID,
        workspaceMemberId: WORKSPACE_MEMBER_ID,
      }),
    ).rejects.toThrow();
  });

  it('retains historical member state in record scope but marks it non-assignable', async () => {
    const { manager, query } = buildManager([
      { id: WORKSPACE_MEMBER_ID, isAssignable: false },
    ]);
    const service = new InconnectWorkspaceMemberService();

    await expect(
      service.getWorkspaceMemberStates({
        manager,
        workspaceId: WORKSPACE_ID,
        workspaceMemberIds: [WORKSPACE_MEMBER_ID],
      }),
    ).resolves.toEqual(
      new Map([
        [WORKSPACE_MEMBER_ID, { id: WORKSPACE_MEMBER_ID, isAssignable: false }],
      ]),
    );

    const [sql] = query.mock.calls[0];

    expect(sql).toContain('LEFT JOIN "core"."userWorkspace"');
    expect(sql).toContain('LEFT JOIN "core"."user"');
    expect(sql).not.toContain('disabled');
    expect(sql).not.toContain('FOR UPDATE');
  });

  it('loads presentation profiles for active and historical Team members without making historical members assignable', async () => {
    const { manager, query } = buildManager([
      {
        id: WORKSPACE_MEMBER_ID,
        firstName: 'Scott',
        lastName: 'Forstall',
        email: 'scott@apple.dev',
        isAssignable: false,
      },
    ]);
    const service = new InconnectWorkspaceMemberService();

    await expect(
      service.getWorkspaceMemberProfiles({
        manager,
        workspaceId: WORKSPACE_ID,
        workspaceMemberIds: [WORKSPACE_MEMBER_ID],
      }),
    ).resolves.toEqual(
      new Map([
        [
          WORKSPACE_MEMBER_ID,
          {
            id: WORKSPACE_MEMBER_ID,
            firstName: 'Scott',
            lastName: 'Forstall',
            email: 'scott@apple.dev',
            isAssignable: false,
          },
        ],
      ]),
    );

    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toContain('LEFT JOIN "core"."userWorkspace"');
    expect(sql).toContain('LEFT JOIN "core"."user"');
    expect(sql).toContain('workspace_member."userEmail" AS "email"');
    expect(sql).not.toContain('disabled');
    expect(parameters).toEqual([[WORKSPACE_MEMBER_ID], WORKSPACE_ID]);
  });

  it('lists assignable member profiles from the canonical WorkspaceMember, UserWorkspace and User lifecycle', async () => {
    const { manager, query } = buildManager([
      {
        id: WORKSPACE_MEMBER_ID,
        firstName: 'Tim',
        lastName: 'Apple',
        email: 'tim@apple.dev',
        isAssignable: true,
      },
    ]);
    const service = new InconnectWorkspaceMemberService();

    await expect(
      service.getAssignableWorkspaceMemberProfiles({
        manager,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual([
      {
        id: WORKSPACE_MEMBER_ID,
        firstName: 'Tim',
        lastName: 'Apple',
        email: 'tim@apple.dev',
        isAssignable: true,
      },
    ]);

    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toContain('INNER JOIN "core"."userWorkspace"');
    expect(sql).toContain('INNER JOIN "core"."user"');
    expect(sql).toContain('workspace_member."deletedAt" IS NULL');
    expect(sql).not.toContain('disabled');
    expect(parameters).toEqual([WORKSPACE_ID]);
  });
});
