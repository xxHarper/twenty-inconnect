import { Logger } from '@nestjs/common';
import { types as postgresTypes } from 'pg';
import { QueryFailedError } from 'typeorm';

import { InconnectMessagingWebhookReceiptEntity as Receipt } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';

import {
  INBOUND_ROUTE_PAUSE_CATEGORY as PAUSE,
  INBOUND_ROUTE_SQL,
} from '../inbound-route-boundary';
import {
  cooldownIdentifier,
  cooldownOrmFixture,
} from './inbound-cooldown-orm.fixtures';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service',
  () => ({ InconnectMessagingOutboxService: class {} }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service',
  () => ({ InconnectMessagingMediaIngestionService: class {} }),
);

beforeEach(() => jest.setSystemTime(new Date('2026-10-26T12:00:00Z')));

const paused = {
  error: { category: PAUSE },
  updatedAt: new Date('2026-10-26T12:00:00Z'),
};

describe('N1 final Repository recovery SQL at the pg driver boundary', () => {
  it('quotes the exact declared alias and JSONB column, binds values and filters before ORDER/LIMIT even on an empty table', async () => {
    const fixture = await cooldownOrmFixture();
    fixture.setEmpty();
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
    const { sql, parameters } = fixture.queries[0];
    const alias = '"InconnectMessagingWebhookReceiptEntity"';
    expect(sql).toContain(
      `FROM "core"."inconnectMessagingWebhookReceipt" ${alias}`,
    );
    expect(sql).toContain(`${alias}."error"->>'category' IS DISTINCT FROM $2`);
    expect(sql).toContain(
      `${alias}."updatedAt" <= clock_timestamp() - ($3 * INTERVAL '1 millisecond')`,
    );
    expect(sql).not.toContain('OR InconnectMessagingWebhookReceiptEntity.');
    expect(sql).not.toContain(PAUSE);
    expect(parameters).toEqual([
      'RECEIVED',
      PAUSE,
      60_000,
      'PROCESSING',
      new Date(),
    ]);
    expect(sql).toContain(`ORDER BY ${alias}."firstReceivedAt" ASC LIMIT 100`);
    expect(sql.indexOf('IS DISTINCT FROM')).toBeLessThan(
      sql.indexOf('ORDER BY'),
    );
    expect(fixture.add).not.toHaveBeenCalled();
    fixture.done();
  });
  it.each([
    ['normal RECEIVED', {}, 1],
    ['paused RECEIVED within window', paused, 0],
    [
      'paused RECEIVED exactly expired',
      { ...paused, updatedAt: new Date('2026-10-26T11:59:00Z') },
      1,
    ],
    [
      'expired PROCESSING with pause diagnostic',
      {
        ...paused,
        processingState: 'PROCESSING',
        leaseToken: cooldownIdentifier(4),
        leaseExpiresAt: new Date('2026-10-26T11:59:59.999Z'),
      },
      1,
    ],
    [
      'live PROCESSING',
      {
        processingState: 'PROCESSING',
        leaseToken: cooldownIdentifier(4),
        leaseExpiresAt: new Date('2026-10-26T12:00:00.001Z'),
      },
      0,
    ],
    [
      'STATUS_CALLBACK with pause diagnostic',
      { ...paused, eventKind: 'STATUS_CALLBACK' },
      1,
    ],
    [
      'other diagnostic',
      { error: { category: 'TRANSIENT' }, updatedAt: new Date() },
      1,
    ],
    [
      'PROCESSED with expired pause',
      { ...paused, processingState: 'PROCESSED', updatedAt: new Date(0) },
      0,
    ],
    ['FAILED', { processingState: 'FAILED' }, 0],
  ] as const)(
    'selects only eligible %s using the emitted SQL',
    async (_name, initial, count) => {
      const fixture = await cooldownOrmFixture(initial);
      expect(await fixture.recovery.recoverPendingReceipts()).toBe(count);
      expect(fixture.add).toHaveBeenCalledTimes(count);
      fixture.done();
    },
  );
  it('propagates a real Repository QueryFailedError instead of returning an empty set', async () => {
    const fixture = await cooldownOrmFixture();
    const failure = Object.assign(new Error('simulated pg rejection'), {
      code: '42P01',
    });
    fixture.setFault(() => {
      throw failure;
    });
    await expect(
      fixture.recovery.recoverPendingReceipts(),
    ).rejects.toBeInstanceOf(QueryFailedError);
    expect(fixture.add).not.toHaveBeenCalled();
  });
});

describe('N2 explicit durable cooldown updates through real TypeORM persistence', () => {
  it.each(['PREPARING', 'SUSPENDED', 'ENABLED'])(
    'renews second and third expired %s pauses and excludes recovery during every new window',
    async (mode) => {
      const fixture = await cooldownOrmFixture({ attemptCount: 0 }, mode);
      const fact = structuredClone({
        metadata: fixture.state.normalizedMetadata,
        version: fixture.state.ingressContractVersion,
        idempotencyKey: fixture.state.idempotencyKey,
        payloadHash: fixture.state.payloadHash,
        firstReceivedAt: fixture.state.firstReceivedAt,
      });
      for (let window = 0; window < 3; window++) {
        await fixture.worker().processReceipt(fixture.state.id); // A fresh instance each time.
        expect(fixture.updates()).toHaveLength(window + 1);
        const update = fixture.updates()[window];
        expect(update.affected).toBe(1);
        expect(update.sql).toContain('"updatedAt" = clock_timestamp()');
        expect(update.sql).not.toContain('"attemptCount" = "attemptCount" + 1');
        expect(update.sql.split(' WHERE ')[0]).not.toContain(
          '"attemptCount" =',
        );
        expect(update.sql).not.toContain('ingressContractVersion');
        expect(fixture.state).toMatchObject({
          processingState: 'RECEIVED',
          attemptCount: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          error: { category: PAUSE },
          updatedAt: fixture.databaseNow(),
        });
        expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
        if (window === 2) fixture.setMode('DISABLED');
        fixture.advance(59_999);
        await fixture.worker().processReceipt(fixture.state.id);
        expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
        expect(fixture.updates()).toHaveLength(window + 1);
        fixture.advance(1);
        expect(await fixture.recovery.recoverPendingReceipts()).toBe(1);
      }
      expect({
        metadata: fixture.state.normalizedMetadata,
        version: fixture.state.ingressContractVersion,
        idempotencyKey: fixture.state.idempotencyKey,
        payloadHash: fixture.state.payloadHash,
        firstReceivedAt: fixture.state.firstReceivedAt,
      }).toEqual(fact);
      const worker = fixture.worker() as unknown as {
        claimReceipt: (id: string) => Promise<unknown>;
      };
      expect(await worker.claimReceipt(fixture.state.id)).not.toBeNull();
      expect(fixture.state).toMatchObject({
        processingState: 'PROCESSING',
        attemptCount: 1,
        error: null,
      });
      expect(fixture.updates()).toHaveLength(4); // Three pauses, one legacy claim.
      fixture.done();
    },
  );
  it('persists the first pause across worker restart and two immediate duplicate jobs', async () => {
    const fixture = await cooldownOrmFixture();
    await fixture.worker().processReceipt(fixture.state.id);
    const saved = fixture.state.updatedAt;
    await Promise.all([
      fixture.worker().processReceipt(fixture.state.id),
      fixture.worker().processReceipt(fixture.state.id),
    ]);
    expect(fixture.state.updatedAt).toEqual(saved);
    expect(fixture.updates()).toHaveLength(1);
    expect(
      fixture.queries.filter(({ sql }) => sql === INBOUND_ROUTE_SQL),
    ).toHaveLength(1);
    fixture.done();
  });
  it('uses DB time for selection and renewal despite a skewed application clock', async () => {
    const fixture = await cooldownOrmFixture(paused);
    jest.setSystemTime(new Date(Date.now() + 3600_000));
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(0);
    fixture.advance(60_000);
    jest.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.state.updatedAt).toEqual(fixture.databaseNow());
    expect(fixture.updates()).toHaveLength(1);
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
    fixture.done();
  });
  it('emits one renewal for two competing workers, rechecking the window after the receipt lock', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    await Promise.all([
      fixture.worker().processReceipt(fixture.state.id),
      fixture.worker().processReceipt(fixture.state.id),
    ]);
    expect(
      fixture.queries.filter(({ sql }) => sql.includes('FOR UPDATE')),
    ).toHaveLength(2);
    expect(fixture.updates()).toHaveLength(1);
    expect(fixture.state.attemptCount).toBe(4);
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
    fixture.done();
  });
  it('keeps ownership and window predicates in the actual UPDATE and its parameters', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    await fixture.worker().processReceipt(fixture.state.id);
    const { sql, parameters } = fixture.updates()[0];
    const where = sql.split(' WHERE ')[1];
    for (const column of [
      'id',
      'workspaceId',
      'providerConnectionId',
      'eventKind',
      'processingState',
      'attemptCount',
    ])
      expect(where).toMatch(new RegExp(`"${column}" = \\$\\d+`));
    expect(where).toContain('"leaseToken" IS NULL');
    expect(where).toContain('"leaseExpiresAt" IS NULL');
    expect(where).toMatch(
      /"error" IS NOT DISTINCT FROM CAST\(\$\d+ AS jsonb\)/,
    );
    expect(where).toMatch(
      /"updatedAt" <= clock_timestamp\(\) - \(\$\d+ \* INTERVAL '1 millisecond'\)/,
    );
    expect(parameters).toEqual(
      expect.arrayContaining([
        fixture.state.id,
        fixture.state.workspaceId,
        fixture.state.providerConnectionId,
        'INBOUND_MESSAGE',
        'RECEIVED',
        4,
        JSON.stringify({ category: PAUSE }),
        PAUSE,
        60_000,
      ]),
    );
    const lastLock = fixture.queries.findIndex(({ sql: statement }) =>
      statement.includes('FOR UPDATE'),
    );
    expect(lastLock).toBeLessThan(
      fixture.queries.findIndex(({ sql: statement }) =>
        statement.startsWith('UPDATE '),
      ),
    );
    fixture.done();
  });
  it.each([
    ['PROCESSED', { processingState: 'PROCESSED' }],
    ['FAILED', { processingState: 'FAILED' }],
    [
      'other owner',
      {
        processingState: 'PROCESSING',
        leaseToken: cooldownIdentifier(99),
        leaseExpiresAt: new Date('2026-10-26T12:05:00Z'),
        attemptCount: 5,
      },
    ],
    ['other workspace', { workspaceId: cooldownIdentifier(99) }],
    ['other connection', { providerConnectionId: cooldownIdentifier(99) }],
    ['other identity', { id: cooldownIdentifier(99) }],
    ['callback', { eventKind: 'STATUS_CALLBACK' }],
    ['no longer paused', { error: { category: 'OTHER' } }],
    ['already renewed', { updatedAt: new Date() }],
    ['lease unexpectedly present', { leaseToken: cooldownIdentifier(99) }],
    ['attempt count changed', { attemptCount: 5 }],
  ] as const)('cannot replay renewal against %s', async (_name, changes) => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    await fixture.worker().processReceipt(fixture.state.id);
    const update = fixture.updates()[0];
    Object.assign(
      fixture.state,
      { ...paused, updatedAt: new Date(0) },
      changes,
    );
    const before = structuredClone(fixture.state);
    const result = await fixture.source
      .createQueryRunner()
      .query(update.sql, update.parameters, true);
    expect(result.affected).toBe(0);
    expect(fixture.state).toEqual(before);
    fixture.done();
  });
  it.each(['PROCESSED', 'FAILED'] as const)(
    'does not write a terminal %s receipt',
    async (processingState) => {
      const fixture = await cooldownOrmFixture({ processingState });
      await fixture.worker().processReceipt(fixture.state.id);
      expect(fixture.updates()).toHaveLength(0);
      fixture.done();
    },
  );
  it('does not clear a live lease and only converts an expired lease under its exact token', async () => {
    const fixture = await cooldownOrmFixture({
      processingState: 'PROCESSING',
      leaseToken: cooldownIdentifier(4),
      leaseExpiresAt: new Date('2026-10-26T12:00:00.001Z'),
    });
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(0);
    fixture.advance(2);
    jest.advanceTimersByTime(2);
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.state).toMatchObject({
      processingState: 'RECEIVED',
      leaseToken: null,
      leaseExpiresAt: null,
      attemptCount: 4,
    });
    expect(fixture.updates()[0].sql).toContain(
      '"leaseExpiresAt" <= clock_timestamp()',
    );
    expect(fixture.updates()[0].parameters).toContain(cooldownIdentifier(4));
    fixture.done();
  });
  it('allows legacy claim after DISABLED resumes and the current window expires', async () => {
    const fixture = await cooldownOrmFixture(paused);
    fixture.setMode('DISABLED');
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(0);
    fixture.advance(60_000);
    // Focus on the existing private claim boundary: no CRM/Message simulation.
    const worker = fixture.worker() as unknown as {
      claimReceipt: (id: string) => Promise<unknown>;
    };
    expect(await worker.claimReceipt(fixture.state.id)).not.toBeNull();
    expect(fixture.state).toMatchObject({
      processingState: 'PROCESSING',
      attemptCount: 5,
      error: null,
    });
    expect(
      fixture.queries.filter(({ sql }) => sql === INBOUND_ROUTE_SQL),
    ).toHaveLength(1);
    fixture.done();
  });
  it('keeps STATUS_CALLBACK outside inbound cooldown and gate checks', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      eventKind: 'STATUS_CALLBACK',
    });
    const worker = fixture.worker() as unknown as {
      claimReceipt: (id: string) => Promise<unknown>;
    };
    expect(await worker.claimReceipt(fixture.state.id)).not.toBeNull();
    expect(fixture.state.processingState).toBe('PROCESSING');
    expect(fixture.queries.some(({ sql }) => sql === INBOUND_ROUTE_SQL)).toBe(
      false,
    );
    fixture.done();
  });
  it('refunds an expired original token once but never a later owner', async () => {
    const fixture = await cooldownOrmFixture();
    fixture.setGatePlan((count) => {
      if (count === 2) fixture.state.leaseExpiresAt = new Date(0);
      return count === 1 ? 'DISABLED' : 'PREPARING';
    });
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.state).toMatchObject({
      processingState: 'RECEIVED',
      attemptCount: 4,
      error: { category: PAUSE, refundedAttemptCount: 5 },
    });
    const refund = fixture
      .updates()
      .find(({ sql }) => sql.includes('"attemptCount" - 1'))!;
    expect(refund.sql.split(' WHERE ')[1]).not.toContain('leaseExpiresAt');
    const duplicate = await fixture.source
      .createQueryRunner()
      .query(refund.sql, refund.parameters, true);
    expect(duplicate.affected).toBe(0);
    Object.assign(fixture.state, {
      processingState: 'PROCESSING',
      leaseToken: cooldownIdentifier(99),
      attemptCount: 6,
    });
    const takeover = await fixture.source
      .createQueryRunner()
      .query(refund.sql, refund.parameters, true);
    expect(takeover.affected).toBe(0);
    expect(fixture.state.attemptCount).toBe(6);
    fixture.done();
  });
  it('does not claim a durable pause when a conditional update affects zero rows', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    const log = jest.spyOn(Logger.prototype, 'log');
    fixture.setUpdateCount(0);
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(1);
    expect(fixture.state.updatedAt).toEqual(new Date(0));
    expect(
      log.mock.calls.some(([message]) =>
        String(message).includes('"processingResult":"INBOUND_ROUTE_PAUSED"'),
      ),
    ).toBe(false);
    log.mockRestore();
    fixture.done();
  });
  it.each([null, 2])(
    'rejects an incomplete update count %s instead of claiming persistence',
    async (count) => {
      const fixture = await cooldownOrmFixture({
        ...paused,
        updatedAt: new Date(0),
      });
      fixture.setUpdateCount(count);
      await expect(
        fixture.worker().processReceipt(fixture.state.id),
      ).rejects.toThrow('Incomplete inbound pause disposition');
      expect(fixture.state.updatedAt).toEqual(new Date(0));
      expect(fixture.queries.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
      fixture.done();
    },
  );
  it('does not overwrite an owner acquired between locator and locked reread', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    fixture.setFault(({ sql }) => {
      if (sql.includes('FOR UPDATE'))
        Object.assign(fixture.state, {
          processingState: 'PROCESSING',
          leaseToken: cooldownIdentifier(99),
          leaseExpiresAt: new Date('2026-10-26T12:05:00Z'),
          attemptCount: 5,
        });
    });
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(0);
    expect(fixture.state).toMatchObject({
      processingState: 'PROCESSING',
      leaseToken: cooldownIdentifier(99),
      attemptCount: 5,
    });
    fixture.done();
  });
  it('propagates SQL failure during renewal and never logs a durable pause', async () => {
    const fixture = await cooldownOrmFixture({
      ...paused,
      updatedAt: new Date(0),
    });
    const log = jest.spyOn(Logger.prototype, 'log');
    fixture.setFault(({ sql }) => {
      if (sql.startsWith('UPDATE '))
        throw Object.assign(new Error('pg error'), { code: '40001' });
    });
    await expect(
      fixture.worker().processReceipt(fixture.state.id),
    ).rejects.toBeInstanceOf(QueryFailedError);
    expect(fixture.state.updatedAt).toEqual(new Date(0));
    expect(fixture.queries.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    expect(
      log.mock.calls.some(([message]) =>
        String(message).includes('"processingResult":"INBOUND_ROUTE_PAUSED"'),
      ),
    ).toBe(false);
    log.mockRestore();
  });
});

describe('N3 SQL NULL binding at the real TypeORM / simulated pg boundary', () => {
  it.each([
    ['RECEIVED PREPARING', 'PREPARING', false],
    ['RECEIVED SUSPENDED', 'SUSPENDED', false],
    ['RECEIVED ENABLED closed', 'ENABLED', false],
    ['expired PROCESSING PREPARING', 'PREPARING', true],
  ] as const)('initial SQL NULL pause: %s', async (_name, mode, processing) => {
    const fixture = await cooldownOrmFixture(
      {
        attemptCount: 0,
        ...(processing
          ? {
              processingState: 'PROCESSING',
              leaseToken: cooldownIdentifier(4),
              leaseExpiresAt: new Date(Date.now() - 1),
            }
          : {}),
      },
      mode,
    );
    await fixture.worker().processReceipt(fixture.state.id);
    const update = fixture.updates()[0];
    const binding = update.sql.match(/IS NOT DISTINCT FROM CAST\(\$(\d+)/)!;
    expect(update.parameters[Number(binding[1]) - 1]).toBeNull();
    expect(update.affected).toBe(1);
    expect(update.sql).toContain('"updatedAt" = clock_timestamp()');
    expect(fixture.state).toMatchObject({
      processingState: 'RECEIVED',
      attemptCount: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      error: { category: PAUSE },
      updatedAt: fixture.databaseNow(),
    });
    for (let duplicate = 0; duplicate < 10; duplicate++)
      await fixture.worker().processReceipt(fixture.state.id);
    fixture.advance(59_999);
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(0);
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(1);
    expect(fixture.state.attemptCount).toBe(0);
    fixture.advance(1);
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(1);
    fixture.done();
  });

  it.each([
    ['SQL NULL', null, false, null, 1],
    ['SQL NULL versus text null', null, false, 'null', 0],
    ['JSONB null versus SQL NULL', null, true, null, 0],
    ['JSONB null versus text null', null, true, 'null', 1],
    ['JSONB null versus JSON string null', null, true, '"null"', 0],
    ['empty object', {}, false, '{}', 1],
    ['empty object versus SQL NULL', {}, false, null, 0],
    [
      'object key order',
      { category: 'TRANSIENT', code: '40001' },
      false,
      '{"code":"40001","category":"TRANSIENT"}',
      1,
    ],
    [
      'contradictory object',
      { category: 'OTHER' },
      false,
      '{"category":"TRANSIENT"}',
      0,
    ],
  ] as const)(
    'CAST and null-safe CAS: %s',
    async (_name, error, jsonNull, previous, affected) => {
      const fixture = await cooldownOrmFixture();
      await fixture.worker().processReceipt(fixture.state.id);
      const update = fixture.updates()[0];
      fixture.state.error = error;
      fixture.state.updatedAt = new Date(0);
      if (jsonNull) fixture.setJsonNull();
      const before = structuredClone(fixture.state);
      const parameters = [...update.parameters];
      const binding = update.sql.match(/IS NOT DISTINCT FROM CAST\(\$(\d+)/)!;
      parameters[Number(binding[1]) - 1] = previous;
      const runner = fixture.source.createQueryRunner();
      try {
        const result = await runner.query(update.sql, parameters, true);
        expect(result.affected).toBe(affected);
        if (affected === 0) expect(fixture.state).toEqual(before);
        else expect(fixture.state.error).toEqual({ category: PAUSE });
      } finally {
        await runner.release();
      }
      fixture.done();
    },
  );

  it.each([{}, { category: 'TRANSIENT', code: '40001' }])(
    'binds a previous JSONB object and persists only its exact CAS',
    async (error) => {
      const fixture = await cooldownOrmFixture({ error });
      await fixture.worker().processReceipt(fixture.state.id);
      const update = fixture.updates()[0];
      const binding = update.sql.match(/IS NOT DISTINCT FROM CAST\(\$(\d+)/)!;
      expect(update.parameters[Number(binding[1]) - 1]).toBe(
        JSON.stringify(error),
      );
      expect(update.affected).toBe(1);
      expect(fixture.state.error).toEqual({ category: PAUSE });
      fixture.done();
    },
  );

  it('cannot distinguish hydrated JSONB null; keeps CAS at zero without claiming a durable pause', async () => {
    const fixture = await cooldownOrmFixture();
    const repository = fixture.source.getRepository(Receipt);
    const sqlNull = await repository.findOneByOrFail({ id: fixture.state.id });
    fixture.setJsonNull();
    const jsonNull = await repository.findOneByOrFail({ id: fixture.state.id });
    expect(sqlNull.error).toBeNull();
    expect(jsonNull.error).toBeNull();
    const column = repository.metadata.findColumnWithPropertyName('error')!;
    expect(postgresTypes.getTypeParser(3802, 'text')('null')).toBeNull();
    expect(
      fixture.source.driver.preparePersistentValue(null, column),
    ).toBeNull();
    const before = structuredClone(fixture.state);
    const log = jest.spyOn(Logger.prototype, 'log');
    try {
      await fixture.worker().processReceipt(fixture.state.id);
      expect(fixture.updates()[0].affected).toBe(0);
      expect(fixture.state).toEqual(before);
      expect(log.mock.calls).toEqual([]);
    } finally {
      log.mockRestore();
    }
    // An anomalous JSONB null has no durable cooldown: no physical-null
    // discriminator exists in this scoped hydration. Never report it persisted.
    expect(await fixture.recovery.recoverPendingReceipts()).toBe(1);
    fixture.done();
  });

  it('does not infer SQL NULL from an unexpectedly absent hydrated error', async () => {
    const fixture = await cooldownOrmFixture();
    fixture.setFault(({ sql }) => {
      if (sql.includes('FOR UPDATE'))
        Reflect.deleteProperty(fixture.state, 'error');
    });
    await fixture.worker().processReceipt(fixture.state.id);
    expect(fixture.updates()).toHaveLength(0);
    expect(fixture.state.attemptCount).toBe(4);
    fixture.done();
  });

  it('does not overwrite a contradictory error observed at the UPDATE boundary', async () => {
    const fixture = await cooldownOrmFixture();
    const log = jest.spyOn(Logger.prototype, 'log');
    fixture.setFault(({ sql }) => {
      if (sql.startsWith('UPDATE '))
        fixture.state.error = { category: 'OTHER' };
    });
    try {
      await fixture.worker().processReceipt(fixture.state.id);
      expect(fixture.updates()[0].affected).toBe(0);
      expect(fixture.state.error).toEqual({ category: 'OTHER' });
      expect(fixture.state.attemptCount).toBe(4);
      expect(log.mock.calls).toEqual([]);
    } finally {
      log.mockRestore();
    }
    fixture.done();
  });
});
