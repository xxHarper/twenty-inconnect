import { DataSource } from 'typeorm';
import { EventEmitter } from 'events';

import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { isLeadPoolStorageLayoutReady } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-storage-layout';
import { actor } from './lead-pool.fixtures';

const completeLayout = () => ({
  schema: 'core',
  table: 'inconnectLeadPoolOperation',
  kind: 'r',
  rowSecurity: false,
  columns: [
    'id',
    'workspaceId',
    'actorUserId',
    'actorWorkspaceMemberId',
    'intentionId',
    'requestHash',
    'state',
    'createdAt',
    'updatedAt',
  ].map((name) => ({
    name,
    type:
      name === 'state'
        ? 'jsonb'
        : name === 'requestHash'
          ? 'text'
          : name.endsWith('At')
            ? 'timestamptz'
            : 'uuid',
    notNull: true,
    defaultExpression: name.endsWith('At') ? 'now()' : null,
    generated: '',
    identity: '',
  })),
  constraints: [
    {
      kind: 'p',
      columns: ['id'],
      deferrable: false,
      validated: true,
      indexValid: true,
      definition: 'PRIMARY KEY (id)',
    },
    {
      kind: 'u',
      columns: ['workspaceId', 'actorUserId', 'intentionId'],
      deferrable: false,
      validated: true,
      indexValid: true,
      definition: 'UNIQUE ("workspaceId", "actorUserId", "intentionId")',
    },
    {
      kind: 'c',
      columns: ['requestHash'],
      deferrable: false,
      validated: true,
      indexValid: null,
      definition: 'CHECK ((length("requestHash") = 64))',
    },
    {
      kind: 'c',
      columns: ['state'],
      deferrable: false,
      validated: true,
      indexValid: null,
      definition: "CHECK ((jsonb_typeof(state) = 'object'::text))",
    },
    {
      kind: 'f',
      columns: ['workspaceId'],
      deferrable: false,
      validated: true,
      indexValid: false,
      definition:
        'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id) ON DELETE RESTRICT',
    },
    {
      kind: 'f',
      columns: ['actorUserId'],
      deferrable: false,
      validated: true,
      indexValid: false,
      definition:
        'FOREIGN KEY ("actorUserId") REFERENCES core."user"(id) ON DELETE RESTRICT',
    },
  ],
});
const cases = [
  'missing table',
  'missing updatedAt',
  'wrong updatedAt type',
  'missing PK',
  'missing UNIQUE',
  'deferred UNIQUE',
  'wrong JSONB',
  'nullable state',
  'wrong schema',
  'invalid identity index',
  'missing timestamp default',
  'unexpected required column',
  'missing FK',
  'missing CHECK',
  'RLS',
  'view',
] as const;
it.each(cases)(
  'reports NOT_READY for %s and never acquires a write runner',
  async (change) => {
    const layout = completeLayout();
    if (change === 'missing updatedAt')
      layout.columns = layout.columns.filter(
        (column) => column.name !== 'updatedAt',
      );
    if (change === 'wrong updatedAt type') layout.columns[8].type = 'timestamp';
    if (change === 'missing PK')
      layout.constraints = layout.constraints.filter(
        (constraint) => constraint.kind !== 'p',
      );
    if (change === 'missing UNIQUE')
      layout.constraints = layout.constraints.filter(
        (constraint) => constraint.kind !== 'u',
      );
    if (change === 'deferred UNIQUE') layout.constraints[1].deferrable = true;
    if (change === 'wrong JSONB') layout.columns[6].type = 'json';
    if (change === 'nullable state') layout.columns[6].notNull = false;
    if (change === 'wrong schema') layout.schema = 'public';
    if (change === 'invalid identity index')
      layout.constraints[1].indexValid = false;
    if (change === 'missing timestamp default')
      layout.columns[8].defaultExpression = null;
    if (change === 'unexpected required column')
      layout.columns.push({ ...layout.columns[0], name: 'requiredDrift' });
    if (change === 'missing FK') layout.constraints.pop();
    if (change === 'missing CHECK') layout.constraints.splice(2, 1);
    if (change === 'RLS') layout.rowSecurity = true;
    if (change === 'view') layout.kind = 'v';
    const query = jest.fn(async (sql: string) =>
      sql.includes('pg_attribute')
        ? change === 'missing table'
          ? []
          : [{ layout }]
        : [],
    );
    const acquire = jest.fn();
    const store = new LeadPoolStoreService(
      { query } as never,
      { executeInWorkspaceContext: acquire } as never,
    );
    expect(await store.ready()).toBe(false);
    const update = jest.fn();
    await expect(store.transaction(actor, update)).rejects.toThrow('storage');
    expect(acquire).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toContain('"updatedAt"');
    expect(query.mock.calls[1][0]).toContain("namespace_row.nspname = 'core'");
  },
);
it('accepts the complete proposed layout; malformed catalog and SQL availability errors fail closed', async () => {
  expect(isLeadPoolStorageLayoutReady(completeLayout())).toBe(true);
  expect(isLeadPoolStorageLayoutReady({ valid: true })).toBe(false);
  const store = new LeadPoolStoreService(
    {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ layout: completeLayout() }]),
    } as never,
    {} as never,
  );
  expect(await store.ready()).toBe(true);
  const unavailable = new LeadPoolStoreService(
    {
      query: async () => {
        throw new Error('catalog unavailable');
      },
    } as never,
    {} as never,
  );
  expect(await unavailable.ready()).toBe(false);
});
it('does not treat readiness as protection against drift after the check; real runner rolls the batch back', async () => {
  const source = new DataSource({ type: 'postgres' });
  const client = new EventEmitter();
  const statements: string[] = [];
  Object.assign(client, {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('UPDATE'))
        throw Object.assign(new Error('updatedAt disappeared'), {
          code: '42703',
        });
      return { rows: [], rowCount: 0 };
    },
  });
  const release = jest.fn();
  Object.assign(source.driver, {
    obtainMasterConnection: async () => [client, release],
  });
  const store = new LeadPoolStoreService(
    {
      query: async (sql: string) =>
        sql.includes('pg_attribute') ? [{ layout: completeLayout() }] : [],
    } as never,
    {
      getGlobalWorkspaceDataSource: async () => source,
      executeInWorkspaceContext: (callback: () => Promise<unknown>) =>
        callback(),
    } as never,
  );
  await expect(
    store.transaction(actor, (runner) =>
      runner.query(
        'UPDATE "core"."inconnectLeadPoolOperation" SET "updatedAt" = now()',
      ),
    ),
  ).rejects.toThrow('updatedAt disappeared');
  expect(statements).toContain('ROLLBACK');
  expect(statements).not.toContain('COMMIT');
  expect(release).toHaveBeenCalledWith(undefined);
});

it('rejects the original independent partial-schema counterexample that used to advertise ready without updatedAt', async () => {
  const query = async (sql: string) => {
    if (sql.includes('"updatedAt"')) throw new Error('column missing');
    return sql.includes('pg_constraint') ? [{ valid: true }] : [];
  };
  const store = new LeadPoolStoreService({ query } as never, {} as never);
  expect(await store.ready()).toBe(false);
});

it.each([
  {
    kind: 'c',
    columns: ['requestHash'],
    definition: 'CHECK ((length("requestHash") = 63))',
    indexValid: null,
  },
  {
    kind: 'u',
    columns: ['actorUserId'],
    definition: 'UNIQUE ("actorUserId")',
    indexValid: true,
  },
  {
    kind: 'c',
    columns: ['state'],
    definition: 'CHECK (false)',
    indexValid: null,
  },
  {
    kind: 'f',
    columns: ['actorWorkspaceMemberId'],
    definition:
      'FOREIGN KEY ("actorWorkspaceMemberId") REFERENCES core."user"(id)',
    indexValid: true,
  },
  {
    kind: 'x',
    columns: ['actorUserId'],
    definition: 'EXCLUDE USING gist ("actorUserId" WITH =)',
    indexValid: true,
  },
  {
    kind: 'c',
    columns: ['state'],
    definition: "CHECK ((jsonb_typeof(state) = 'o bject'::text))",
    indexValid: null,
  },
])(
  'N2: rejects additional restriction $definition before admitting any transfer',
  async (extra) => {
    const layout = completeLayout();
    layout.constraints.push({ ...extra, deferrable: false, validated: true });
    expect(isLeadPoolStorageLayoutReady(layout)).toBe(false);
    const query = jest.fn(async (sql: string) =>
      sql.includes('pg_attribute') ? [{ layout }] : [],
    );
    const acquire = jest.fn();
    const transfer = jest.fn();
    const store = new LeadPoolStoreService(
      { query } as never,
      { executeInWorkspaceContext: acquire } as never,
    );
    expect(await store.ready()).toBe(false);
    await expect(store.transaction(actor, transfer)).rejects.toThrow('storage');
    expect(acquire).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
  },
);

it('N2: accepts the expected constraints and harmless recognized duplicates independently of their names', () => {
  const layout = completeLayout();
  layout.constraints.push({ ...layout.constraints[2] });
  const named = {
    ...layout,
    constraints: layout.constraints.map((constraint, index) => ({
      ...constraint,
      name: `arbitrary_${index}`,
    })),
  };
  expect(isLeadPoolStorageLayoutReady(named)).toBe(true);
});

it('N2: accepts an ordinary auxiliary index outside the constraint contract', async () => {
  const layout = {
    ...completeLayout(),
    indexes: [
      {
        name: 'arbitrary_actor_index',
        unique: false,
        columns: ['workspaceId', 'actorUserId', 'createdAt'],
      },
    ],
  };
  const store = new LeadPoolStoreService(
    {
      query: async (sql: string) =>
        sql.includes('pg_attribute') ? [{ layout }] : [],
    } as never,
    {} as never,
  );
  expect(isLeadPoolStorageLayoutReady(layout)).toBe(true);
  expect(await store.ready()).toBe(true);
});

it.each(['deferred', 'not validated'] as const)(
  'N2: does not ignore an extra %s CHECK that still restricts new rows',
  (mode) => {
    const layout = completeLayout();
    layout.constraints.push({
      kind: 'c',
      columns: ['state'],
      definition: 'CHECK (false)',
      indexValid: null,
      deferrable: mode === 'deferred',
      validated: mode !== 'not validated',
    });
    expect(isLeadPoolStorageLayoutReady(layout)).toBe(false);
  },
);
