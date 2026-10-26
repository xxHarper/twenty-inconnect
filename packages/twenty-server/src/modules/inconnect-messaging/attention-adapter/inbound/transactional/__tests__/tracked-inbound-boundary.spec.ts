import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { type EntityManager } from 'typeorm';

import {
  requireLegacyInboundRoute,
  INBOUND_ROUTE_SQL,
} from '../inbound-route-boundary';
import { trackedInboundReleaseBlockers } from '../tracked-inbound-contract';
import { legacyInboundFixture } from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/legacy-inbound.fixtures';
import {
  scope,
  identifier,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { ATTENTION_CONFIGURATION_SQL } from 'src/modules/inconnect-messaging/attention-adapter/persistence/reader/attention-reader-sql';
import { causalFixture } from './tracked-inbound.fixtures';
import * as sql from '../tracked-inbound-sql';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service',
  () => ({ InconnectMessagingOutboxService: class {} }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-media-ingestion.service',
  () => ({ InconnectMessagingMediaIngestionService: class {} }),
);

describe('route selection fails closed until cutover is accepted', () => {
  it.each([
    { columns: 0, mode: null },
    {
      columns: 3,
      mode: 'DISABLED',
      protocolVersion: null,
      gateUpdatedAt: null,
    },
  ])('allows only pre-DDL or DISABLED compatibility %j', async (gate) => {
    const query = jest.fn().mockResolvedValue([gate]);
    await expect(
      requireLegacyInboundRoute(
        { query } as unknown as EntityManager,
        scope.workspaceId,
      ),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(INBOUND_ROUTE_SQL, [scope.workspaceId]);
    expect(INBOUND_ROUTE_SQL).toContain('FOR SHARE');
  });

  it.each([
    { columns: 3, mode: 'ENABLED' },
    { columns: 3, mode: 'PREPARING' },
    { columns: 3, mode: 'SUSPENDED' },
    { columns: 1, mode: 'DISABLED' },
    { columns: 2, mode: 'DISABLED' },
    { columns: 3, mode: null },
    { columns: 3, mode: 'other' },
  ])('rejects %j without a legacy fallback', async (gate) => {
    await expect(
      requireLegacyInboundRoute(
        { query: async () => [gate] } as unknown as EntityManager,
        scope.workspaceId,
      ),
    ).rejects.toMatchObject({
      category: 'RECEIPT_NOT_PROCESSABLE',
      retryable: false,
    });
  });

  it.each([
    [],
    [
      { columns: 0, mode: null },
      { columns: 0, mode: null },
    ],
    {},
  ])('does not infer legacy from incomplete results %j', async (rows) => {
    await expect(
      requireLegacyInboundRoute(
        { query: async () => rows } as unknown as EntityManager,
        scope.workspaceId,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('connects the real operational worker to the closed boundary before the Receipt lock', async () => {
    const fixture = legacyInboundFixture();
    const query = jest.fn(async (statement, values) => {
      expect(statement).toBe(INBOUND_ROUTE_SQL);
      expect(values).toEqual([scope.workspaceId]);
      return [
        {
          columns: 3,
          mode: 'ENABLED',
          protocolVersion: 1,
          gateUpdatedAt: '2026-10-26T12:00:00.000Z',
        },
      ];
    });
    const originalTransaction = fixture.transaction.getMockImplementation()!;
    fixture.transaction.mockImplementation(async (callback) =>
      originalTransaction(async (manager) => {
        Object.assign(manager, { query });
        return callback(manager);
      }),
    );
    await fixture.service.processReceipt(fixture.receipt.id);
    expect(fixture.writes).toEqual([]);
    expect(fixture.receiptUpdate).toHaveBeenCalledTimes(1);
    expect(fixture.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fixture.receipt.id,
        workspaceId: fixture.receipt.workspaceId,
        providerConnectionId: fixture.receipt.providerConnectionId,
        processingState: 'RECEIVED',
        attemptCount: 0,
      }),
      expect.objectContaining({
        processingState: 'RECEIVED',
        leaseToken: null,
        leaseExpiresAt: null,
        error: { category: 'INBOUND_ROUTE_PAUSED' },
        updatedAt: expect.any(Function),
      }),
    );
    expect(fixture.releaseUpdate).not.toHaveBeenCalled();
    expect(fixture.receipt.processingState).toBe('RECEIVED');
    expect(fixture.receipt.attemptCount).toBe(0);
  });

  it('does not turn a Configuration SQL error into legacy', async () => {
    await expect(
      requireLegacyInboundRoute(
        {
          query: async () => {
            throw new Error('timeout');
          },
        } as unknown as EntityManager,
        scope.workspaceId,
      ),
    ).rejects.toThrow('timeout');
  });

  it('has no activation registration, transport duplication, CRM writer or user-controlled cutover flag', () => {
    const messaging = resolve(__dirname, '../../../..');
    const module = readFileSync(
      join(messaging, 'inconnect-messaging.module.ts'),
      'utf8',
    );
    expect(module).not.toMatch(
      /transactional|executeTrackedInbound|processTrackedInboundReceipt|INBOUND_INGRESS_POLICY/,
    );
    const sources = readdirSync(resolve(__dirname, '..'))
      .filter((path) => path.endsWith('.ts'))
      .map((path) => readFileSync(join(__dirname, '..', path), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(
      /@Injectable|@Processor|@Process\(|process\.env|fetch\(|\.dispatch\(|AutomationRecordCreate|CommonCreate|RecordAccessAuthorization/,
    );
    expect(sources).not.toMatch(
      /pg_current_xact_id\(\)|xmin|attentionCreatedTransactionId"\s*[,)]/,
    );
    expect(trackedInboundReleaseBlockers).toContain(
      'ALL_CONNECTION_WRITERS_GATE_FIRST',
    );
    expect(trackedInboundReleaseBlockers).toContain(
      'INGRESS_ENABLED_V1_AND_LEGACY_DRAIN',
    );
  });

  it('rereads a uniqueness winner and never bootstraps that existing Conversation', async () => {
    const fixture = await causalFixture({ fresh: false });
    fixture.ids[0] = identifier(99);
    const insert = fixture.steps.find(
      (entry) => entry.sql === sql.INBOUND_CREATE_CONVERSATION_SQL,
    )!;
    insert.parameters = [
      ...insert.parameters.slice(0, 3),
      identifier(99),
      insert.parameters[4],
    ];
    const harness = fixture.start();
    await harness.prepare();
    harness.done();
    expect(
      harness.calls.some((entry) => entry.sql === sql.INBOUND_CREATE_EPOCH_SQL),
    ).toBe(false);
    expect(
      harness.calls.findIndex(
        (entry) => entry.sql === ATTENTION_CONFIGURATION_SQL,
      ),
    ).toBeLessThan(
      harness.calls.findIndex(
        (entry) => entry.sql === sql.INBOUND_CREATE_CONVERSATION_SQL,
      ),
    );
  });
});
