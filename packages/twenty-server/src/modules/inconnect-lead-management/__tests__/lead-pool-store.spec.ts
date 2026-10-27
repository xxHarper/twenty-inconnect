import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { actor } from './lead-pool.fixtures';

// Actual pg-pool acquisition/release/removal, actual TypeORM runner, actual
// Workspace lifecycle. Only the pg wire client is replaced. No sockets open.
class WireClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  active = false;
  ended = false;
  fault: 'none' | 'rollback' | 'commit-before' | 'commit-after' = 'none';
  statements: string[] = [];
  staged = 0;
  persisted = 0;
  connect(callback: (error?: Error) => void) {
    callback();
  }
  async query(statement: string) {
    if (this.ended) throw new Error('Ended client reused');
    this.statements.push(statement);
    if (statement === 'START TRANSACTION') this.active = true;
    if (statement === 'ROLLBACK') {
      if (this.fault === 'rollback') throw new Error('Rollback response lost');
      this.active = false;
      this.staged = 0;
    }
    if (statement === 'COMMIT') {
      if (this.fault === 'commit-before')
        throw new Error('Commit outcome unknown');
      this.active = false;
      this.persisted += this.staged;
      this.staged = 0;
      if (this.fault === 'commit-after')
        throw new Error('Commit response lost');
    }
    return { rows: [], rowCount: 0 };
  }
  end() {
    this.ended = true;
    this.active = false;
    this.staged = 0;
    this.emit('end');
  }
}
const makeTransport = () => {
  const pool = new Pool({ Client: WireClient, idleTimeoutMillis: 0 } as never);
  const published = jest.fn();
  const emitter = new WorkspaceEventEmitter({ emit: published } as never);
  const source = new GlobalWorkspaceDataSource(
    { type: 'postgres' },
    emitter,
    {} as never,
  );
  (source.driver as PostgresDriver).master = pool;
  const store = new LeadPoolStoreService(
    {} as never,
    {
      getGlobalWorkspaceDataSource: async () => source,
      executeInWorkspaceContext: (callback: () => Promise<unknown>) =>
        callback(),
    } as never,
  );
  jest.spyOn(store, 'ready').mockResolvedValue(true);
  const released: { error: unknown; client: WireClient }[] = [];
  pool.on('release', (error, client) => {
    if (!(client instanceof WireClient))
      throw new Error('Unexpected pool transport in source-only harness');
    released.push({ error, client });
  });
  return { pool, source, store, released, emitter, published };
};

it('returns a connection normally only after a confirmed rollback', async () => {
  const harness = makeTransport();
  let client!: WireClient;
  await expect(
    harness.store.transaction(actor, async (runner) => {
      client = await runner.connect();
      throw new Error('Callback rejected');
    }),
  ).rejects.toThrow('Callback rejected');
  expect(client.statements).toContain('ROLLBACK');
  expect(client.active).toBe(false);
  expect(harness.released[0].error).toBeUndefined();
  expect(harness.pool.idleCount).toBe(1);
  await harness.pool.end();
});

it.each(['before-rollback', 'during-rollback'] as const)(
  'discards the real client after %s; release cannot put it back and the next operation is healthy',
  async (failure) => {
    const harness = makeTransport();
    let client!: WireClient;
    let capturedRunner!: ReturnType<
      GlobalWorkspaceDataSource['createQueryRunner']
    >;
    await expect(
      harness.store.transaction(actor, async (runner) => {
        capturedRunner = runner;
        client = await runner.connect();
        if (failure === 'before-rollback') {
          const broadcast = runner.broadcaster.broadcast.bind(
            runner.broadcaster,
          );
          runner.broadcaster.broadcast = async (event, ...parameters) => {
            if (event === 'BeforeTransactionRollback')
              throw new Error('Subscriber blocked rollback');
            return broadcast(event, ...parameters);
          };
        } else client.fault = 'rollback';
        throw new Error('Callback rejected');
      }),
    ).rejects.toThrow('Callback rejected');
    expect(harness.released).toHaveLength(1);
    expect(harness.released[0].error).toBeInstanceOf(Error);
    expect(client.ended).toBe(true);
    expect(harness.pool.totalCount).toBe(0);
    expect(harness.pool.idleCount).toBe(0);
    expect(capturedRunner.isReleased).toBe(true);
    await capturedRunner.release();
    expect(harness.released).toHaveLength(1);
    await expect(capturedRunner.query('SELECT 1')).rejects.toThrow();
    await harness.store.transaction(actor, async (runner) => {
      const healthy = await runner.connect();
      expect(healthy).not.toBe(client);
      expect(healthy.ended).toBe(false);
    });
    expect(harness.released[1].error).toBeUndefined();
    expect(sourceDriver(harness.source).connectedQueryRunners).toHaveLength(0);
    await harness.pool.end();
  },
);
const sourceDriver = (source: GlobalWorkspaceDataSource) =>
  source.driver as PostgresDriver;

it.each(['none', 'commit-before', 'commit-after'] as const)(
  'keeps event and persisted-write outcomes separate for %s',
  async (fault) => {
    const harness = makeTransport();
    let client!: WireClient;
    const transaction = harness.store.transaction(actor, async (runner) => {
      client = await runner.connect();
      client.fault = fault;
      client.staged++;
      // Exercise the actual workspace event buffer, including cleanup on discard.
      harness.emitter.emitDatabaseBatchEvent(
        {
          objectMetadataNameSingular: 'lead',
          action: 'updated',
          events: [
            { recordId: 'record', properties: { before: {}, after: {} } },
          ],
          objectMetadata: {},
          workspaceId: actor.workspace.id,
        } as never,
        runner,
      );
      expect(harness.published).not.toHaveBeenCalled();
      return 'confirmed';
    });
    if (fault === 'none') {
      await expect(transaction).resolves.toBe('confirmed');
      expect(harness.published).toHaveBeenCalledTimes(1);
      expect(harness.released[0].error).toBeUndefined();
      expect(client.persisted).toBe(1);
    } else {
      await expect(transaction).rejects.toThrow('Commit');
      expect(client.statements).not.toContain('ROLLBACK');
      expect(client.persisted).toBe(fault === 'commit-after' ? 1 : 0);
      expect(client.ended).toBe(true);
      expect(harness.released[0].error).toBeInstanceOf(Error);
      expect(harness.published).not.toHaveBeenCalled();
      // A fresh primary read is admitted only after the uncertain client is removed.
      await harness.store.transaction(actor, async (runner) => {
        expect(await runner.connect()).not.toBe(client);
      });
      expect(harness.published).not.toHaveBeenCalled();
    }
    await harness.pool.end();
  },
);
