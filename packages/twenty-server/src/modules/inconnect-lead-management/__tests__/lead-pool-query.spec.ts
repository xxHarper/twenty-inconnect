import { DataSource } from 'typeorm';

import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import { makeAuthorityHarness } from './lead-pool-authority.fixtures';
import { actor, originId, poolId } from './lead-pool.fixtures';

const queryHarness = async () => {
  const authorityHarness = makeAuthorityHarness();
  const authority = await authorityHarness.service.resolve(actor, originId);
  if (authorityHarness.policy.status === 'configured')
    authorityHarness.policy.rules[0] = {
      ...authorityHarness.policy.rules[0],
      recordEffect: 'ownRecords',
    };
  // Real TypeORM SQL builders and real public Record Access facade; no connection initialization.
  const source = new DataSource({ type: 'postgres' });
  const facade = new InconnectRecordAccessAuthorizationService(
    source,
    { getOrRecompute: async () => authorityHarness.maps } as never,
    { resolveWorkspacePolicy: async () => authorityHarness.policy } as never,
    { assertActiveWorkspaceMember: async () => undefined } as never,
  );
  const queries = new LeadPoolQueryService(source, facade);
  return { ...authorityHarness, authority, queries };
};

describe('Lead pool SQL authorization and metadata filters', () => {
  it('keeps authorization in the SQL before ordering and paging and parameterizes user values', async () => {
    const harness = await queryHarness();
    const query = await harness.queries.build(actor, harness.authority, {
      search: "%' OR 1=1 --",
      ownerId: poolId(20),
      orderFieldId: harness.date.id,
      direction: 'DESC',
      conditions: [
        { fieldId: harness.status.id, operator: 'EQ', value: 'PENDING' },
        { fieldId: harness.boolean.id, operator: 'EQ', value: 'false' },
        { fieldId: harness.date.id, operator: 'BEFORE', value: '2026-10-26' },
      ],
    });
    const [sql, parameters] = query
      .offset(50)
      .limit(50)
      .getQueryAndParameters();
    expect(sql).toContain('"commercialOwnerId" IN');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain(
      'ORDER BY pool."attemptedAt" DESC NULLS LAST, pool."id" ASC LIMIT 50 OFFSET 50',
    );
    expect(sql).not.toContain('OR 1=1');
    expect(parameters).toContain(false);
    expect(parameters).toContain('PENDING');
    expect(parameters).toContain(actor.workspaceMemberId);
    expect(
      parameters.some(
        (value) => typeof value === 'string' && value.includes('OR 1=1'),
      ),
    ).toBe(true);
  });
  it('does not allow manipulated field IDs, sort IDs, incompatible types or select options', async () => {
    const harness = await queryHarness();
    for (const filter of [
      {
        conditions: [
          { fieldId: poolId(999), operator: 'EQ', value: 'private' },
        ],
      },
      { orderFieldId: poolId(999) },
      {
        conditions: [
          {
            fieldId: harness.boolean.id,
            operator: 'EQ',
            value: 'FALSE OR TRUE',
          },
        ],
      },
      {
        conditions: [
          { fieldId: harness.status.id, operator: 'EQ', value: 'UNKNOWN' },
        ],
      },
      {
        conditions: [
          { fieldId: harness.status.id, operator: 'BEFORE', value: 'PENDING' },
        ],
      },
      {
        conditions: [
          { fieldId: harness.date.id, operator: 'BEFORE', value: 'invalid' },
        ],
      },
    ]) {
      await expect(
        harness.queries.build(actor, harness.authority, filter as never),
      ).rejects.toThrow();
    }
  });
  it('counts only the already-authorized filter without LIMIT/OFFSET or ORDER', async () => {
    const harness = await queryHarness();
    const query = await harness.queries.build(actor, harness.authority, {
      search: 'Authorized',
    });
    const capture: string[] = [];
    // Simulate only TypeORM's terminal I/O; retain the cloned real query builder.
    const cloned = query.clone.bind(query);
    query.clone = () => {
      const copy = cloned();
      copy.getRawOne = jest.fn(async () => {
        capture.push(copy.getSql());
        return { count: '1000' };
      }) as never;
      return copy;
    };
    expect(await harness.queries.count(query)).toBe(1000);
    expect(capture[0]).toContain('COUNT(1)');
    expect(capture[0]).toContain('"commercialOwnerId" IN');
    expect(capture[0]).not.toMatch(/LIMIT|OFFSET|ORDER BY/);
  });
  it.each([
    undefined,
    null,
    { count: null },
    { count: '-1' },
    { count: '9007199254740992' },
    { count: 'NaN' },
  ])(
    'rejects an incomplete or invalid authoritative count %j',
    async (result) => {
      const harness = await queryHarness();
      const query = await harness.queries.build(actor, harness.authority, {});
      query.clone = () =>
        ({
          select: () => ({
            orderBy: () => ({ getRawOne: async () => result }),
          }),
        }) as never;
      await expect(harness.queries.count(query)).rejects.toThrow('count');
    },
  );
  it('rejects current cross-workspace and invalid-policy scopes before executing SQL', async () => {
    const harness = await queryHarness();
    await expect(
      harness.queries.build(
        { ...actor, workspace: { ...actor.workspace, id: poolId(999) } },
        harness.authority,
        {},
      ),
    ).rejects.toThrow();
    Object.assign(harness.policy, { status: 'invalid', reason: 'unavailable' });
    await expect(
      harness.queries.build(actor, harness.authority, {}),
    ).rejects.toThrow();
  });
});
