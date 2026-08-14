import { type QueryRunner } from 'typeorm';

import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { resolveInconnectSingleActiveMemberOfRole } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-single-active-member-of-role.util';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';
const SUPERVISOR_WORKSPACE_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_SUPERVISOR_WORKSPACE_MEMBER_ID =
  '44444444-4444-4444-8444-444444444444';
const WORKSPACE_SCHEMA = 'workspace_11111111-1111-4111-8111-111111111111';

const buildQueryRunner = (candidateIds: string[], roleExists = true) =>
  ({
    query: jest
      .fn()
      .mockResolvedValueOnce(roleExists ? [{ id: ROLE_ID }] : [])
      .mockResolvedValueOnce(candidateIds.map((id) => ({ id }))),
  }) as unknown as QueryRunner;

describe('resolveInconnectSingleActiveMemberOfRole', () => {
  it('returns the only assignable Workspace Member and locks all authority rows', async () => {
    const queryRunner = buildQueryRunner([SUPERVISOR_WORKSPACE_MEMBER_ID]);

    await expect(
      resolveInconnectSingleActiveMemberOfRole({
        queryRunner,
        workspaceId: WORKSPACE_ID,
        workspaceSchema: WORKSPACE_SCHEMA,
        roleId: ROLE_ID,
      }),
    ).resolves.toBe(SUPERVISOR_WORKSPACE_MEMBER_ID);

    const query = queryRunner.query as jest.Mock;
    const roleSql = query.mock.calls[0][0] as string;
    const memberSql = query.mock.calls[1][0] as string;

    expect(roleSql).toContain('FOR UPDATE OF configured_role');
    expect(memberSql).toContain(
      'FOR UPDATE OF workspace_member, user_workspace, workspace_user, role_target',
    );
    expect(memberSql).toContain(
      '"workspace_11111111-1111-4111-8111-111111111111"."workspaceMember"',
    );
    expect(memberSql).toContain('workspace_member."deletedAt" IS NULL');
    expect(memberSql).toContain('user_workspace."deletedAt" IS NULL');
    expect(memberSql).toContain('workspace_user."deletedAt" IS NULL');
    expect(memberSql).not.toContain('workspace_user."disabled"');
    expect(query.mock.calls[1][1]).toEqual([ROLE_ID, WORKSPACE_ID]);
  });

  it.each([
    ['zero', []],
    [
      'two',
      [SUPERVISOR_WORKSPACE_MEMBER_ID, SECOND_SUPERVISOR_WORKSPACE_MEMBER_ID],
    ],
  ])('denies when the Role has %s active members', async (_count, ids) => {
    const queryRunner = buildQueryRunner(ids);

    await expect(
      resolveInconnectSingleActiveMemberOfRole({
        queryRunner,
        workspaceId: WORKSPACE_ID,
        workspaceSchema: WORKSPACE_SCHEMA,
        roleId: ROLE_ID,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      }) as InconnectRecordAccessException,
    );
  });

  it('denies when the configured Role no longer exists in the workspace', async () => {
    const queryRunner = buildQueryRunner([], false);

    await expect(
      resolveInconnectSingleActiveMemberOfRole({
        queryRunner,
        workspaceId: WORKSPACE_ID,
        workspaceSchema: WORKSPACE_SCHEMA,
        roleId: ROLE_ID,
      }),
    ).rejects.toBeInstanceOf(InconnectRecordAccessException);
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
  });

  it('escapes a schema identifier instead of accepting executable SQL', async () => {
    const queryRunner = buildQueryRunner([SUPERVISOR_WORKSPACE_MEMBER_ID]);

    await resolveInconnectSingleActiveMemberOfRole({
      queryRunner,
      workspaceId: WORKSPACE_ID,
      workspaceSchema: 'workspace_schema"; DROP TABLE core.user; --',
      roleId: ROLE_ID,
    });

    const memberSql = (queryRunner.query as jest.Mock).mock
      .calls[1][0] as string;

    expect(memberSql).toContain(
      '"workspace_schema""; DROP TABLE core.user; --"."workspaceMember"',
    );
  });
});
