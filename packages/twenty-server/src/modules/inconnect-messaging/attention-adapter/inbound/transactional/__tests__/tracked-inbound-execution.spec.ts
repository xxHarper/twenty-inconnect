import { randomUUID } from 'node:crypto';
import { type DataSource } from 'typeorm';

import { identifier } from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  executeTrackedInbound,
  INBOUND_SESSION_SETTINGS,
  requestCommittedInboundWork,
} from '../execute-tracked-inbound';
import {
  processTrackedInboundReceipt,
  processTrackedInboundJob,
  INBOUND_JOB_IDENTITY_SQL,
  INBOUND_RECOVERY_STATE_SQL,
} from '../process-tracked-inbound-receipt';
import {
  INBOUND_CLAIM_SQL,
  INBOUND_RELEASE_SQL,
  INBOUND_EXHAUSTED_SQL,
  claimTrackedInbound,
  releaseTrackedInbound,
} from '../tracked-inbound-recovery';
import { causalFixture } from './tracked-inbound.fixtures';
import {
  INBOUND_INSERT_MESSAGE_SQL,
  INBOUND_FINALIZE_RECEIPT_SQL,
} from '../tracked-inbound-sql';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

const transactionFixture = async (commitError?: Error) => {
  const fixture = await causalFixture();
  const harness = fixture.start();
  const order: string[] = [];
  const originalQuery = harness.runner.query.getMockImplementation()!;
  harness.runner.query.mockImplementation(
    async (statement, values, structured) => {
      if (
        INBOUND_SESSION_SETTINGS.includes(
          statement as (typeof INBOUND_SESSION_SETTINGS)[number],
        )
      ) {
        expect(structured).toBeUndefined();
        order.push('setting');
        return {};
      }
      return originalQuery(statement, values, structured);
    },
  );
  harness.runner.connect.mockImplementation(async () => {
    order.push('connect');
  });
  harness.runner.startTransaction.mockImplementation(async (isolation) => {
    expect(isolation).toBe('READ COMMITTED');
    order.push('begin');
    harness.runner.isTransactionActive = true;
  });
  harness.runner.commitTransaction.mockImplementation(async () => {
    order.push('commit');
    if (commitError) throw commitError;
    harness.runner.isTransactionActive = false;
  });
  harness.runner.rollbackTransaction.mockImplementation(async () => {
    order.push('rollback');
    harness.runner.isTransactionActive = false;
  });
  harness.runner.release.mockImplementation(async () => {
    order.push('release');
  });
  const source = {
    createQueryRunner: jest.fn((mode) => {
      expect(mode).toBe('master');
      return harness.queryRunner;
    }),
  };
  const done = () => {
    for (const method of [
      harness.runner.connect,
      harness.runner.startTransaction,
      harness.runner.commitTransaction,
      harness.runner.rollbackTransaction,
      harness.runner.release,
    ])
      method.mockClear();
    harness.done();
  };
  return {
    fixture,
    harness,
    order,
    source,
    dataSource: source as unknown as DataSource,
    done,
  };
};

describe('transaction owner, transport recovery and post-COMMIT work', () => {
  it('returns COMMITTED only after commit and then requests both outboxes and media', async () => {
    const fixture = await transactionFixture();
    const committed = await executeTrackedInbound(
      fixture.dataSource,
      fixture.fixture.claim,
    );
    expect(fixture.order).toEqual([
      'connect',
      'begin',
      'setting',
      'setting',
      'setting',
      'commit',
      'release',
    ]);
    expect(committed.status).toBe('COMMITTED');
    const requestPublication = jest.fn(async () => {
      fixture.order.push('publish');
    });
    const requestMedia = jest.fn(async () => {
      fixture.order.push('media');
    });
    await requestCommittedInboundWork(committed, {
      requestPublication,
      requestMedia,
    });
    expect(requestPublication).toHaveBeenCalledTimes(2);
    expect(requestMedia).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: 'provider-message' }),
    );
    expect(fixture.order.indexOf('commit')).toBeLessThan(
      fixture.order.indexOf('publish'),
    );
    fixture.done();
  });

  it('does not turn post-commit media or enqueue failures into a causal retry', async () => {
    const fixture = await transactionFixture();
    const committed = await executeTrackedInbound(
      fixture.dataSource,
      fixture.fixture.claim,
    );
    const result = await requestCommittedInboundWork(committed, {
      requestPublication: jest.fn().mockRejectedValue(new Error('queue')),
      requestMedia: jest.fn().mockRejectedValue(new Error('media')),
    });
    expect(
      result.publication.every((entry) => entry.status === 'rejected'),
    ).toBe(true);
    expect(result.media[0].status).toBe('rejected');
    expect(fixture.order).not.toContain('rollback');
    fixture.done();
  });

  it.each(['08006', '23514', '57014'])(
    'never invents success or automatically retries a COMMIT error %s',
    async (code) => {
      const fixture = await transactionFixture(
        Object.assign(new Error('ambiguous server response'), { code }),
      );
      await expect(
        executeTrackedInbound(fixture.dataSource, fixture.fixture.claim),
      ).rejects.toMatchObject({ disposition: 'COMMIT_INDETERMINATE' });
      expect(fixture.source.createQueryRunner).toHaveBeenCalledTimes(1);
      expect(fixture.order).toContain('rollback');
      fixture.done();
    },
  );

  it.each([
    ['23505', 'unknown_constraint', 'INTERVENTION'],
    ['55P03', undefined, 'RETRY'],
    ['57014', undefined, 'RETRY'],
    ['23503', undefined, 'INTERVENTION'],
  ])(
    'rolls back SQLSTATE %s before returning %s',
    async (code, constraint, disposition) => {
      const fixture = await transactionFixture();
      const index = fixture.fixture.steps.findIndex(
        (entry) => entry.sql === INBOUND_INSERT_MESSAGE_SQL,
      );
      fixture.fixture.steps[index].error = Object.assign(
        new Error('private driver text'),
        { code, constraint },
      );
      fixture.fixture.steps.splice(index + 1);
      await expect(
        executeTrackedInbound(fixture.dataSource, fixture.fixture.claim),
      ).rejects.toMatchObject({ disposition, sqlState: code });
      expect(fixture.order).toContain('rollback');
      expect(fixture.order).not.toContain('commit');
      fixture.done();
    },
  );

  it.each([
    ['23505', 'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE'],
    ['40P01', undefined],
    ['40001', undefined],
  ])(
    'retries %s in a fresh runner with the same durable identity',
    async (code, constraint) => {
      const failed = await transactionFixture();
      const success = await transactionFixture();
      const index = failed.fixture.steps.findIndex(
        (entry) => entry.sql === INBOUND_INSERT_MESSAGE_SQL,
      );
      failed.fixture.steps[index].error = Object.assign(
        new Error('transient'),
        { code, constraint },
      );
      failed.fixture.steps.splice(index + 1);
      const source = {
        createQueryRunner: jest
          .fn()
          .mockReturnValueOnce(failed.harness.queryRunner)
          .mockImplementationOnce(() => {
            // New random physical candidates are allowed; the receipt/event/provider
            // identity is stable. This fixture supplies the corresponding IDs again.
            const queue = [...success.fixture.ids];
            jest
              .mocked(randomUUID)
              .mockImplementation(
                () => queue.shift()! as ReturnType<typeof randomUUID>,
              );
            return success.harness.queryRunner;
          }),
      };
      const queue = [...failed.fixture.ids];
      jest
        .mocked(randomUUID)
        .mockImplementation(
          () => queue.shift()! as ReturnType<typeof randomUUID>,
        );
      await expect(
        executeTrackedInbound(
          source as unknown as DataSource,
          failed.fixture.claim,
        ),
      ).resolves.toMatchObject({
        status: 'COMMITTED',
        receiptId: identifier(27),
      });
      expect(failed.order).toContain('rollback');
      expect(success.order).toContain('commit');
      failed.done();
      success.done();
    },
  );

  it.each([true, false])(
    'claims RECEIVED/expired PROCESSING with a DB-clock lease, claimed=%s',
    async (claimed) => {
      const identity = {
        receiptId: identifier(27),
        workspaceId: identifier(1),
        providerConnectionId: identifier(3),
      };
      jest
        .mocked(randomUUID)
        .mockReturnValue(identifier(28) as ReturnType<typeof randomUUID>);
      const query = jest.fn(async (statement, parameters) => {
        expect(statement).toBe(INBOUND_CLAIM_SQL);
        expect(parameters).toEqual([
          ...Object.values(identity),
          identifier(28),
        ]);
        return claimed ? [{ id: identifier(27) }] : [];
      });
      const source = {
        transaction: jest.fn(async (isolation, callback) => {
          expect(isolation).toBe('READ COMMITTED');
          return callback({ query });
        }),
      };
      expect(
        await claimTrackedInbound(source as unknown as DataSource, identity),
      ).toEqual(claimed ? { ...identity, leaseToken: identifier(28) } : null);
      expect(INBOUND_CLAIM_SQL).toContain(
        '"leaseExpiresAt" <= clock_timestamp()',
      );
      expect(INBOUND_CLAIM_SQL).toContain('"attemptCount" < 10');
    },
  );

  it.each([
    ['40P01', undefined, 3, 'RETRY'],
    [
      '23505',
      'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE',
      2,
      'INTERVENTION',
    ],
  ] as const)(
    'bounds repeated %s to %s attempts',
    async (code, constraint, count, disposition) => {
      const attempts = await Promise.all(
        Array.from({ length: count }, () => transactionFixture()),
      );
      attempts.forEach((attempt) => {
        const index = attempt.fixture.steps.findIndex(
          (entry) => entry.sql === INBOUND_INSERT_MESSAGE_SQL,
        );
        attempt.fixture.steps[index].error = Object.assign(new Error('retry'), {
          code,
          constraint,
        });
        attempt.fixture.steps.splice(index + 1);
      });
      let current = 0;
      const createQueryRunner = jest.fn(() => {
        const attempt = attempts[current++];
        if (!attempt) throw new Error('Exceeded retry budget');
        const ids = [...attempt.fixture.ids];
        jest
          .mocked(randomUUID)
          .mockImplementation(
            () => ids.shift()! as ReturnType<typeof randomUUID>,
          );
        return attempt.harness.queryRunner;
      });
      await expect(
        executeTrackedInbound(
          { createQueryRunner } as unknown as DataSource,
          attempts[0].fixture.claim,
        ),
      ).rejects.toMatchObject({ disposition });
      expect(createQueryRunner).toHaveBeenCalledTimes(count);
      attempts.forEach((attempt) => {
        expect(attempt.order).toContain('rollback');
        attempt.done();
      });
    },
  );

  it('does not retry after an unconfirmed rollback', async () => {
    const fixture = await transactionFixture();
    const index = fixture.fixture.steps.findIndex(
      (entry) => entry.sql === INBOUND_INSERT_MESSAGE_SQL,
    );
    fixture.fixture.steps[index].error = Object.assign(new Error('deadlock'), {
      code: '40P01',
    });
    fixture.fixture.steps.splice(index + 1);
    fixture.harness.runner.rollbackTransaction.mockRejectedValueOnce(
      new Error('connection lost') as never,
    );
    await expect(
      executeTrackedInbound(fixture.dataSource, fixture.fixture.claim),
    ).rejects.toMatchObject({ disposition: 'COMMIT_INDETERMINATE' });
    expect(fixture.source.createQueryRunner).toHaveBeenCalledTimes(1);
    fixture.done();
  });

  it('executes the source worker claim, causal unit and post-commit delivery together', async () => {
    const fixture = await transactionFixture();
    const queue = [identifier(28), ...fixture.fixture.ids];
    jest
      .mocked(randomUUID)
      .mockImplementation(
        () => queue.shift()! as ReturnType<typeof randomUUID>,
      );
    Object.assign(fixture.source, {
      transaction: jest.fn(async (_isolation, callback) =>
        callback({
          query: async (statement: string) => {
            expect(statement).toBe(INBOUND_CLAIM_SQL);
            fixture.order.push('claim-commit');
            return [{ id: identifier(27) }];
          },
        }),
      ),
      query: jest.fn(async (statement, values) => {
        expect(statement).toBe(INBOUND_JOB_IDENTITY_SQL);
        expect(values).toEqual([fixture.fixture.claim.receiptId]);
        const { leaseToken: _token, ...identity } = fixture.fixture.claim;
        return [identity];
      }),
    });
    const requestPublication = jest.fn(async () => {
      fixture.order.push('publish');
    });
    const result = await processTrackedInboundJob(
      fixture.source as unknown as DataSource,
      fixture.fixture.claim.receiptId,
      { requestPublication, requestMedia: jest.fn() },
    );
    expect(result.status).toBe('COMMITTED');
    expect(fixture.order.indexOf('claim-commit')).toBeLessThan(
      fixture.order.indexOf('begin'),
    );
    expect(fixture.order.indexOf('commit')).toBeLessThan(
      fixture.order.indexOf('publish'),
    );
    fixture.done();
  });

  it('keeps an indeterminate commit out of Receipt release/failure writes', async () => {
    const fixture = await transactionFixture(new Error('lost commit response'));
    const queue = [identifier(28), ...fixture.fixture.ids];
    jest
      .mocked(randomUUID)
      .mockImplementation(
        () => queue.shift()! as ReturnType<typeof randomUUID>,
      );
    const query = jest.fn();
    Object.assign(fixture.source, {
      transaction: async (
        _isolation: unknown,
        callback: (manager: unknown) => Promise<unknown>,
      ) => callback({ query: async () => [{ id: identifier(27) }] }),
      query,
    });
    await expect(
      processTrackedInboundReceipt(
        fixture.source as unknown as DataSource,
        fixture.fixture.claim,
        { requestPublication: jest.fn(), requestMedia: jest.fn() },
      ),
    ).rejects.toMatchObject({ disposition: 'COMMIT_INDETERMINATE' });
    expect(query).not.toHaveBeenCalled();
    fixture.done();
  });

  it('does not overwrite a different lease owner after rollback', async () => {
    const fixture = await causalFixture();
    const query = jest.fn(async (statement, parameters) => {
      expect(statement).toBe(INBOUND_RELEASE_SQL);
      expect(parameters.slice(0, 4)).toEqual(Object.values(fixture.claim));
      return [];
    });
    await expect(
      releaseTrackedInbound(
        { query } as unknown as DataSource,
        fixture.claim,
        true,
        'CAUSAL_UNIT_RETRY',
      ),
    ).resolves.toBe(false);
    expect(INBOUND_RELEASE_SQL).toContain(
      '"processingState" = \'PROCESSING\' AND "leaseToken" = $4::uuid',
    );
    expect(INBOUND_FINALIZE_RECEIPT_SQL).toContain(
      '"leaseExpiresAt" > clock_timestamp()',
    );
  });

  it('does not reclaim an unexpired lease when a duplicate worker arrives', async () => {
    const source = {
      transaction: async (
        _isolation: unknown,
        callback: (manager: unknown) => Promise<unknown>,
      ) => callback({ query: async () => [] }),
      query: jest.fn(async (statement) => {
        expect(statement).toBe(INBOUND_RECOVERY_STATE_SQL);
        return [
          {
            processingState: 'PROCESSING',
            leaseToken: identifier(99),
            leaseValid: true,
            attemptCount: 1,
          },
        ];
      }),
      createQueryRunner: jest.fn(),
    };
    const fixture = await causalFixture();
    await expect(
      processTrackedInboundReceipt(
        source as unknown as DataSource,
        fixture.claim,
        { requestPublication: jest.fn(), requestMedia: jest.fn() },
      ),
    ).resolves.toEqual({ status: 'BUSY' });
    expect(source.createQueryRunner).not.toHaveBeenCalled();
  });

  it('stops the recovery loop on an expired exhausted receipt with a conditional terminal write', async () => {
    const query = jest.fn().mockImplementation(async (statement) => {
      if (statement === INBOUND_RECOVERY_STATE_SQL)
        return [
          {
            processingState: 'PROCESSING',
            leaseToken: identifier(99),
            leaseValid: false,
            attemptCount: 10,
          },
        ];
      expect(statement).toBe(INBOUND_EXHAUSTED_SQL);
      return [{ id: identifier(27) }];
    });
    const source = {
      transaction: async (
        _isolation: unknown,
        callback: (manager: unknown) => Promise<unknown>,
      ) => callback({ query: async () => [] }),
      query,
    };
    const fixture = await causalFixture();
    await expect(
      processTrackedInboundReceipt(
        source as unknown as DataSource,
        fixture.claim,
        { requestPublication: jest.fn(), requestMedia: jest.fn() },
      ),
    ).rejects.toMatchObject({ disposition: 'INTERVENTION' });
    expect(query).toHaveBeenCalledTimes(2);
    expect(INBOUND_EXHAUSTED_SQL).toContain(
      '"leaseExpiresAt" <= clock_timestamp()',
    );
    expect(INBOUND_EXHAUSTED_SQL).toContain('"ingressContractVersion" = 1');
  });
});
