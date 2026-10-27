import {
  actor,
  makePoolHarness,
  originId,
  poolId,
  poolInput,
  recipientId,
} from './lead-pool.fixtures';

describe('integrated explicit Lead pool with simulated I/O', () => {
  it.each([0, 1, 49, 50, 51, 100, 1000])(
    'previews and transfers %i records in durable bounded batches',
    async (count) => {
      const harness = makePoolHarness(count);
      let operation = await harness.service.preview(actor, poolInput(count));
      expect(operation.selected).toBe(count);
      expect(operation.plannedChanges).toBe(count);
      let batches = 0;
      do {
        const before = operation.processed;
        operation = await harness.service.execute(actor, {
          operationId: operation.id,
          expectedVersion: operation.version,
        });
        expect(operation.processed - before).toBeLessThanOrEqual(50);
        batches++;
      } while (operation.status !== 'COMPLETED');
      expect(operation.counts.CHANGED).toBe(count);
      expect(batches).toBe(Math.max(1, Math.ceil(count / 50)));
      expect(
        [...harness.rows.values()].every((row) => row.ownerId === recipientId),
      ).toBe(true);
    },
  );

  it('queries the first 50 while keeping an authorized total of 1000 and later pages', async () => {
    const { service } = makePoolHarness(1000);
    const first = await service.list(actor, {
      objectId: originId,
      filter: {},
      first: 50,
    });
    const second = await service.list(actor, {
      objectId: originId,
      filter: {},
      first: 50,
      offset: 50,
    });
    expect(first.total).toBe(1000);
    expect(first.records).toHaveLength(50);
    expect(second.records).toHaveLength(50);
    expect(
      first.records.some((record) =>
        second.records.some((other) => record.id === other.id),
      ),
    ).toBe(false);
  });

  it.each(['EVEN', 'MANUAL_QUOTAS'] as const)(
    'implements uncategorized %s without Messaging facts',
    async (mode) => {
      const harness = makePoolHarness(51);
      const input = {
        ...poolInput(51),
        recipientIds: [recipientId, poolId(21)],
        mode,
        ...(mode === 'MANUAL_QUOTAS'
          ? {
              quotas: [
                { recipientId, quantity: 10 },
                { recipientId: poolId(21), quantity: 20 },
              ],
            }
          : {}),
      };
      let operation = await harness.service.preview(actor, input);
      expect(operation.recipients.map((entry) => entry.quantity)).toEqual(
        mode === 'EVEN' ? [26, 25] : [10, 20],
      );
      do {
        operation = await harness.service.execute(actor, {
          operationId: operation.id,
          expectedVersion: operation.version,
        });
      } while (operation.status !== 'COMPLETED');
      expect(operation.counts.REMAINING).toBe(mode === 'EVEN' ? 0 : 21);
    },
  );

  it('retains the existing owner without emitting an owner write', async () => {
    const harness = makePoolHarness(1);
    harness.rows.values().next().value!.ownerId = recipientId;
    const preview = await harness.service.preview(actor, poolInput(1));
    expect(preview.plannedUnchanged).toBe(1);
    const result = await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    });
    expect(result.counts.UNCHANGED).toBe(1);
    expect(harness.writes()).toBe(0);
  });

  it.each(['owner', 'updatedAt'] as const)(
    'rejects stale %s without overwriting the record',
    async (change) => {
      const harness = makePoolHarness(1);
      const preview = await harness.service.preview(actor, poolInput(1));
      const row = harness.rows.values().next().value!;
      if (change === 'owner') row.ownerId = poolId(99);
      else row.updatedAt = '2026-10-26 12:00:00.123457+00';
      const result = await harness.service.execute(actor, {
        operationId: preview.id,
        expectedVersion: 0,
      });
      expect(result.counts.CONFLICT).toBe(1);
      expect(harness.writes()).toBe(0);
    },
  );

  it.each(['deleted', 'inaccessible', 'filter drift'])(
    'does not disclose or update a %s record',
    async (change) => {
      const harness = makePoolHarness(1);
      const preview = await harness.service.preview(actor, {
        ...poolInput(1),
        filter: { ownerId: actor.workspaceMemberId },
      });
      const row = harness.rows.values().next().value!;
      if (change === 'deleted') harness.rows.delete(row.id);
      else if (change === 'inaccessible') row.visible = false;
      else row.ownerId = poolId(90);
      const result = await harness.service.execute(actor, {
        operationId: preview.id,
        expectedVersion: 0,
      });
      expect(result.counts.REJECTED).toBe(1);
      expect(harness.writes()).toBe(0);
      if (change !== 'filter drift') expect(result.items).toHaveLength(0);
    },
  );

  it.each([
    'recipient disabled',
    'actor permission lost',
    'team changed',
    'metadata changed',
  ])('revalidates %s after preview', async (change) => {
    const harness = makePoolHarness(1);
    const preview = await harness.service.preview(actor, poolInput(1));
    if (change === 'recipient disabled') harness.authority.recipients = [];
    else if (change === 'actor permission lost') harness.setAuthorized(false);
    else harness.authority.hash = 'b'.repeat(64);
    await expect(
      harness.service.execute(actor, {
        operationId: preview.id,
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
    expect(harness.writes()).toBe(0);
  });

  it('refuses inaccessible preview selections and forged recipients', async () => {
    const harness = makePoolHarness(1);
    harness.rows.values().next().value!.visible = false;
    await expect(
      harness.service.preview(actor, poolInput(1)),
    ).rejects.toThrow();
    await expect(
      harness.service.preview(actor, {
        ...poolInput(1),
        recipientIds: [poolId(666)],
      }),
    ).rejects.toThrow();
    expect(harness.operations().size).toBe(0);
  });

  it('binds operation identity to workspace, user and membership', async () => {
    const harness = makePoolHarness(1);
    const preview = await harness.service.preview(actor, poolInput(1));
    for (const other of [
      { ...actor, workspace: { ...actor.workspace, id: poolId(999) } },
      { ...actor, user: { ...actor.user, id: poolId(998) } },
      { ...actor, workspaceMemberId: poolId(997) },
    ]) {
      await expect(
        harness.service.result(other, { operationId: preview.id }),
      ).rejects.toThrow('Operation unavailable');
    }
  });

  it('preserves the original preview on duplicate request and refuses changed intention payload', async () => {
    const harness = makePoolHarness(1);
    const first = await harness.service.preview(actor, poolInput(1));
    expect((await harness.service.preview(actor, poolInput(1))).id).toBe(
      first.id,
    );
    await expect(
      harness.service.preview(actor, { ...poolInput(1), batchSize: 1 }),
    ).rejects.toThrow('different request');
    expect(harness.operations().size).toBe(1);
  });

  it('does not process a second batch on duplicate or concurrent execution', async () => {
    const harness = makePoolHarness(100);
    const preview = await harness.service.preview(actor, poolInput(100));
    const input = { operationId: preview.id, expectedVersion: 0 };
    const results = await Promise.all([
      harness.service.execute(actor, input),
      harness.service.execute(actor, input),
    ]);
    expect(results.map((result) => result.processed)).toEqual([50, 50]);
    expect(harness.writes()).toBe(50);
    expect(harness.sql.some(({ query }) => query.includes('FOR UPDATE'))).toBe(
      true,
    );
    expect(
      harness.sql.some(({ query }) => query.includes('pg_advisory_xact_lock')),
    ).toBe(true);
  });

  it('rejects a second active overlapping operation', async () => {
    const harness = makePoolHarness(1);
    await harness.service.preview(actor, poolInput(1));
    await expect(
      harness.service.preview(actor, {
        ...poolInput(1),
        intentionId: poolId(333),
      }),
    ).rejects.toThrow('reserves');
  });

  it('rolls back the failed batch, preserves earlier batches and resumes from durable state', async () => {
    const harness = makePoolHarness(100);
    const preview = await harness.service.preview(actor, poolInput(100));
    await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    });
    harness.failWrite(52);
    const failed = await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 1,
    });
    expect(failed.counts.CHANGED).toBe(50);
    expect(failed.counts.PENDING).toBe(50);
    expect(failed.batchFailures).toBe(1);
    expect(
      [...harness.rows.values()].filter((row) => row.ownerId === recipientId),
    ).toHaveLength(50);
    const recovered = await harness.service.result(actor, {
      operationId: preview.id,
    });
    const final = await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: recovered.version,
    });
    expect(final.counts.CHANGED).toBe(100);
    expect(final.status).toBe('COMPLETED');
  });

  it('reconciles a lost commit response instead of duplicating the batch', async () => {
    const harness = makePoolHarness(100);
    const preview = await harness.service.preview(actor, poolInput(100));
    harness.loseCommit();
    const result = await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    });
    expect(result.processed).toBe(50);
    expect(harness.writes()).toBe(50);
    expect(result.batchFailures).toBe(0);
  });

  it('limits failed attempts and reports FAILED without claiming total success', async () => {
    const harness = makePoolHarness(1);
    let operation = await harness.service.preview(actor, poolInput(1));
    for (let index = 1; index <= 3; index++) {
      harness.failWrite(index);
      operation = await harness.service.execute(actor, {
        operationId: operation.id,
        expectedVersion: operation.version,
      });
    }
    expect(operation.counts.FAILED).toBe(1);
    expect(operation.counts.CHANGED).toBe(0);
    expect(operation.status).toBe('COMPLETED');
  });

  it('cancels only pending records and preserves confirmed changes', async () => {
    const harness = makePoolHarness(100);
    const preview = await harness.service.preview(actor, poolInput(100));
    const first = await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    });
    const cancelled = await harness.service.cancel(actor, {
      operationId: preview.id,
      expectedVersion: first.version,
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.counts.CHANGED).toBe(50);
    expect(cancelled.counts.REMAINING).toBe(50);
    await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: cancelled.version,
    });
    expect(harness.writes()).toBe(50);
  });

  it('never writes another object, broad fields, Messaging, or Folios', async () => {
    const harness = makePoolHarness(1);
    const preview = await harness.service.preview(actor, poolInput(1));
    await harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    });
    expect(harness.updateCalls).toEqual([
      {
        data: { commercialOwner: { connect: { where: { id: recipientId } } } },
        filter: {
          id: { eq: poolId(100) },
          commercialOwnerId: { eq: actor.workspaceMemberId },
        },
        selectedFields: { id: true },
      },
    ]);
    expect(
      harness.sql
        .filter(({ query }) => /^(INSERT|UPDATE)/.test(query))
        .every(({ query }) => query.includes('inconnectLeadPoolOperation')),
    ).toBe(true);
  });

  it('keeps all-matching and Messaging classification unavailable without assuming NORMAL', async () => {
    const harness = makePoolHarness(1);
    const catalog = await harness.service.catalog(actor);
    expect(catalog.allMatchingReady).toBe(false);
    expect(catalog.messagingClassification).toBe('NOT_READY');
    await expect(
      harness.service.preview(actor, { ...poolInput(1), category: 'NORMAL' }),
    ).rejects.toThrow();
  });

  it('fails closed when operation storage is unavailable', async () => {
    const harness = makePoolHarness(1);
    harness.setUnavailable();
    expect((await harness.service.catalog(actor)).storageReady).toBe(false);
    await expect(harness.service.preview(actor, poolInput(1))).rejects.toThrow(
      'storage',
    );
    expect(harness.writes()).toBe(0);
  });
});
