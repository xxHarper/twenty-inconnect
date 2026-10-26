import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';

import {
  identifier,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { DURABLE_INBOUND_FACT_SQL } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound-sql';
import { READ_RECEIPT_INGRESS_CONTRACT_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';
import {
  writerScript,
  writerRunner,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/__tests__/attention-writer.fixtures';
import { readAdmissionSqlState } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-admission-diagnostic';
import { processTrackedInboundReceipt } from '../process-tracked-inbound-receipt';
import {
  INBOUND_INSERT_MESSAGE_SQL,
  INBOUND_FINALIZE_RECEIPT_SQL,
} from '../tracked-inbound-sql';
import { causalFixture } from './tracked-inbound.fixtures';
import {
  errorDriver,
  failAdmission,
} from './tracked-inbound-error-driver.fixtures';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));
const driverError = (code?: string) =>
  Object.assign(
    new Error('PRIVATE SQL payload credentials WhatsApp'),
    code ? { code } : {},
  );
const dependencies = () => ({
  requestPublication: jest.fn(),
  requestMedia: jest.fn(),
});

beforeEach(() =>
  jest
    .mocked(randomUUID)
    .mockReturnValue(identifier(28) as ReturnType<typeof randomUUID>),
);

describe('F2 admission SQLSTATE survives real driver and III-A without public changes', () => {
  it.each(
    [DURABLE_INBOUND_FACT_SQL, READ_RECEIPT_INGRESS_CONTRACT_SQL].flatMap(
      (statement) =>
        ['40P01', '40001', '55P03', '57014'].map((code) => ({
          statement,
          code,
        })),
    ),
  )(
    'preserves $code from admission query $# through owner rollback and scoped worker release',
    async ({ statement, code }) => {
      const count = ['40P01', '40001'].includes(code) ? 3 : 1;
      const fixtures = await Promise.all(
        Array.from({ length: count }, () =>
          failAdmission(statement, driverError(code)),
        ),
      );
      const harness = errorDriver(
        fixtures.map((fixture) => ({ fixture })),
        true,
      );
      const work = dependencies();
      await expect(
        processTrackedInboundReceipt(harness.source, fixtures[0].claim, work),
      ).rejects.toMatchObject({ disposition: 'RETRY', sqlState: code });
      expect(harness.releases).toHaveLength(1);
      expect(harness.releases[0]).toEqual([
        ...Object.values(fixtures[0].claim),
        true,
        'CAUSAL_UNIT_RETRY',
      ]);
      expect(
        harness.order.filter((statement) => statement === 'ROLLBACK'),
      ).toHaveLength(count);
      expect(
        harness.order.filter((statement) => statement === 'COMMIT'),
      ).toHaveLength(1); // Transport claim only.
      expect(work.requestPublication).not.toHaveBeenCalled();
      expect(harness.order).not.toContain(INBOUND_FINALIZE_RECEIPT_SQL);
      harness.done();
    },
  );

  it.each(['40P01', '40001'])(
    'starts a new real runner after %s and preserves durable identities',
    async (code) => {
      const failed = await failAdmission(
        DURABLE_INBOUND_FACT_SQL,
        driverError(code),
      );
      const success = await causalFixture();
      const harness = errorDriver(
        [{ fixture: failed }, { fixture: success }],
        true,
      );
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          failed.claim,
          dependencies(),
        ),
      ).resolves.toMatchObject({ status: 'COMMITTED' });
      expect(harness.runners).toHaveLength(3); // Claim + two causal units.
      expect(harness.order.indexOf('ROLLBACK')).toBeLessThan(
        harness.order.indexOf('acquire-1'),
      );
      expect(harness.releases).toEqual([]);
      harness.done();
    },
  );

  it.each(['XXXXX', '42501', '23514', undefined])(
    'does not presume retryable admission SQLSTATE %s',
    async (code) => {
      const fixture = await failAdmission(
        DURABLE_INBOUND_FACT_SQL,
        driverError(code),
      );
      const harness = errorDriver([{ fixture }], true);
      const failure = await processTrackedInboundReceipt(
        harness.source,
        fixture.claim,
        dependencies(),
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        disposition: 'INTERVENTION',
        sqlState: code,
      });
      expect(JSON.stringify(failure)).not.toMatch(
        /PRIVATE|payload|credentials|WhatsApp|SELECT/,
      );
      expect(harness.releases[0][4]).toBe(false);
      harness.done();
    },
  );

  it.each([
    driverError('40P01'),
    { cause: driverError('40P01') },
    { failure: { code: 'QUERY_FAILED', sqlState: '40P01' } },
    Object.create({ code: '40P01' }) as object,
  ])(
    'does not trust arbitrary or forged callback causes %#',
    async (error: unknown) => {
      const scenario = writerScript();
      scenario.steps.splice(scenario.readerLength + 2);
      const harness = writerRunner(scenario.steps);
      const result = await prepareAttentionWrite({
        queryRunner: harness.queryRunner,
        input: { scope, event: scenario.event },
        causal: scenario.cause,
        admit: async () => {
          throw error;
        },
      });
      expect(result).toEqual({
        ok: false,
        callerMustRollback: true,
        error: { code: 'ADMISSION_FAILED', path: '$.admission' },
      });
      if (result.ok) throw new Error('Unexpected admission');
      expect(readAdmissionSqlState(result.error)).toBeUndefined();
      harness.done();
    },
  );

  it('preserves the exact III-A result and keeps diagnostic identity internal and nonserializable', async () => {
    const scenario = writerScript();
    scenario.steps.splice(scenario.readerLength + 2);
    const harness = writerRunner(scenario.steps);
    const result = await prepareAttentionWrite({
      queryRunner: harness.queryRunner,
      input: { scope, event: scenario.event },
      causal: scenario.cause,
      admit: async () => {
        throw new QueryFailedError(
          'PRIVATE SQL',
          ['PRIVATE payload'],
          driverError('40P01'),
        );
      },
    });
    expect(result).toEqual({
      ok: false,
      callerMustRollback: true,
      error: { code: 'ADMISSION_FAILED', path: '$.admission' },
    });
    if (result.ok) throw new Error('Unexpected admission');
    expect(Reflect.ownKeys(result.error)).toEqual(['code', 'path']);
    expect(readAdmissionSqlState(result.error)).toBe('40P01');
    expect(readAdmissionSqlState({ ...result.error })).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|40P01/);
    harness.done();
  });

  it.each(['authority', 'corruption', 'unknown-version', 'missing-version'])(
    'keeps genuine %s definitive in the worker',
    async (kind) => {
      const fixture = await causalFixture();
      const statement = kind.endsWith('version')
        ? READ_RECEIPT_INGRESS_CONTRACT_SQL
        : DURABLE_INBOUND_FACT_SQL;
      const index = fixture.steps.findIndex((step) => step.sql === statement);
      if (kind.endsWith('version'))
        fixture.steps[index].rows = [
          { installed: true, version: kind === 'missing-version' ? null : 2 },
        ];
      else
        Object.assign(
          fixture.durable.fact,
          kind === 'authority'
            ? { leaseToken: identifier(99) }
            : {
                normalizedMetadata: {
                  ...fixture.durable.normalized,
                  body: 'contradictory',
                },
              },
        );
      if (kind.endsWith('version')) {
        const session = fixture.steps[index + 1];
        fixture.steps.splice(index + 2);
        fixture.steps.push(session);
      } else fixture.steps.splice(index + 3);
      const harness = errorDriver([{ fixture }], true);
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          fixture.claim,
          dependencies(),
        ),
      ).rejects.toMatchObject({ disposition: 'INTERVENTION' });
      expect(harness.releases[0][4]).toBe(false);
      harness.done();
    },
  );
});

describe('F3 acquisition, rollback and commit phases with real PostgresQueryRunner', () => {
  it.each(['ECONNREFUSED', 'ETIMEDOUT'])(
    'reconnects after %s before BEGIN in a new runner',
    async (code) => {
      const success = await causalFixture();
      const harness = errorDriver(
        [{ acquisitionError: driverError(code) }, { fixture: success }],
        true,
      );
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          success.claim,
          dependencies(),
        ),
      ).resolves.toMatchObject({ status: 'COMMITTED' });
      expect(
        harness.order.filter((statement) => statement === 'ROLLBACK'),
      ).toEqual([]);
      expect(harness.runners).toHaveLength(3);
      harness.done();
    },
  );
  it.each(['ECONNREFUSED', 'ETIMEDOUT'])(
    'bounds acquisition %s to three and releases the Receipt for recovery',
    async (code) => {
      const fixture = await causalFixture();
      const harness = errorDriver(
        Array.from({ length: 3 }, () => ({
          acquisitionError: driverError(code),
        })),
        true,
      );
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          fixture.claim,
          dependencies(),
        ),
      ).rejects.toMatchObject({ disposition: 'RETRY', connectionCode: code });
      expect(harness.releases[0][4]).toBe(true);
      expect(
        harness.order.filter((statement) => statement === 'START TRANSACTION'),
      ).toHaveLength(1);
      harness.done();
    },
  );
  it.each(['UNKNOWN_NODE_CODE', 'ERR_TLS_CERT_ALTNAME_INVALID', undefined])(
    'rejects unknown acquisition %s',
    async (code) => {
      const fixture = await causalFixture();
      const harness = errorDriver(
        [{ acquisitionError: driverError(code) }],
        true,
      );
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          fixture.claim,
          dependencies(),
        ),
      ).rejects.toMatchObject({ disposition: 'INTERVENTION' });
      expect(harness.releases[0][4]).toBe(false);
      harness.done();
    },
  );
  it('does not apply pre-BEGIN connectivity policy to a failure in an active transaction', async () => {
    const fixture = await failAdmission(
      INBOUND_INSERT_MESSAGE_SQL,
      driverError('ECONNREFUSED'),
    );
    const harness = errorDriver([{ fixture }], true);
    await expect(
      processTrackedInboundReceipt(
        harness.source,
        fixture.claim,
        dependencies(),
      ),
    ).rejects.toMatchObject({ disposition: 'INTERVENTION' });
    expect(harness.order).toContain('ROLLBACK');
    expect(harness.releases[0][4]).toBe(false);
    harness.done();
  });
  it('keeps uncertain rollback out of release/failure', async () => {
    const fixture = await failAdmission(
      DURABLE_INBOUND_FACT_SQL,
      driverError('40P01'),
    );
    const harness = errorDriver(
      [{ fixture, rollbackError: driverError('08006') }],
      true,
    );
    await expect(
      processTrackedInboundReceipt(
        harness.source,
        fixture.claim,
        dependencies(),
      ),
    ).rejects.toMatchObject({ disposition: 'COMMIT_INDETERMINATE' });
    expect(harness.releases).toEqual([]);
    expect(
      harness.order.filter((statement) => statement === 'COMMIT'),
    ).toHaveLength(1);
    harness.done();
  });
  it.each(['08006', '23514', 'ETIMEDOUT'])(
    'does not disambiguate COMMIT %s with successful ROLLBACK',
    async (code) => {
      const fixture = await causalFixture();
      const harness = errorDriver(
        [{ fixture, commitError: driverError(code) }],
        true,
      );
      await expect(
        processTrackedInboundReceipt(
          harness.source,
          fixture.claim,
          dependencies(),
        ),
      ).rejects.toMatchObject({ disposition: 'COMMIT_INDETERMINATE' });
      expect(harness.releases).toEqual([]);
      expect(harness.order).toContain('ROLLBACK');
      harness.done();
    },
  );
  it('does not overwrite another processor on scoped release after admission failure', async () => {
    const fixture = await failAdmission(
      DURABLE_INBOUND_FACT_SQL,
      driverError('55P03'),
    );
    const harness = errorDriver([{ fixture }], true);
    fixture.steps[fixture.steps.length - 1].onQuery = async () =>
      harness.replaceOwner();
    await expect(
      processTrackedInboundReceipt(
        harness.source,
        fixture.claim,
        dependencies(),
      ),
    ).rejects.toMatchObject({ disposition: 'RETRY' });
    expect(harness.releases[0][3]).toBe(fixture.claim.leaseToken);
    harness.done();
  });
});
