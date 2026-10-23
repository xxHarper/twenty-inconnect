import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DURABLE_INBOUND_FACT_SQL,
  DURABLE_INBOUND_RECEIPT_LOCK_SQL,
} from '../durable-inbound-sql';
import { admitDurableInbound } from '../admit-durable-inbound';
import { durableEvent, durableFixture } from './durable-inbound.fixtures';

import {
  identifier,
  scope,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import { type AttentionWriterInput } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { validateAttentionSnapshot } from 'src/modules/inconnect-messaging/attention-adapter/attention-contract-validation';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('private durable source boundary', () => {
  const messaging = resolve(__dirname, '../../../..');
  const read = (path: string) => readFileSync(join(messaging, path), 'utf8');
  const production = () =>
    readdirSync(resolve(__dirname, '..'))
      .filter((path) => path.endsWith('.ts'))
      .map((path) => readFileSync(join(__dirname, '..', path), 'utf8'))
      .join('\n');

  it('registers no operational caller or provider and preserves R2 DISABLED issuance', () => {
    for (const path of [
      'inconnect-messaging.module.ts',
      'services/inconnect-messaging-webhook-processing.service.ts',
      'services/inconnect-messaging-webhook-ingress.service.ts',
      'services/inconnect-messaging-outbox.service.ts',
      'attention-adapter/index.ts',
    ])
      expect(read(path)).not.toMatch(
        /prepareDurableInboundAttentionWrite|admitDurableInbound|inbound\/durable/,
      );
    expect(read('webhook-ingress/persist-authenticated-receipt.ts')).toContain(
      "gate[0].mode !== 'DISABLED'",
    );
  });

  it('delegates decisions and writes without a second reducer, transaction or external transport', () => {
    expect(production()).toContain('await prepareAttentionWrite(');
    expect(production()).not.toMatch(
      /transitionConversationAttention|evaluateAttentionProjection|startTransaction\(|commitTransaction\(|rollbackTransaction\(|createQueryRunner\(|getRepository\(|Redis|fetch\(|validateWebhookSignature|normalizeWebhook|consumeAuthenticatedInbound/,
    );
    expect(production()).not.toMatch(
      /INSERT INTO|UPDATE core\.|DELETE FROM|@Injectable|@Module/,
    );
    expect(production()).not.toMatch(
      /authToken|rawBody|serverReceivedAt: new Date/,
    );
  });

  it('has scoped parametrized joins, fresh post-lock clock and no ledger authority query', () => {
    expect(DURABLE_INBOUND_RECEIPT_LOCK_SQL).toContain('FOR UPDATE OF w');
    expect(DURABLE_INBOUND_FACT_SQL).toContain('clock_timestamp()');
    expect(DURABLE_INBOUND_FACT_SQL).toContain(
      'm."attentionTrackingEpochId" = $4::uuid',
    );
    expect(DURABLE_INBOUND_FACT_SQL).toContain(
      'c."attentionTrackingEpochId" = $4::uuid',
    );
    expect(DURABLE_INBOUND_FACT_SQL).toContain('w."id" = $5::uuid');
    expect(DURABLE_INBOUND_FACT_SQL).toContain('m."id" = $6::uuid');
    expect(DURABLE_INBOUND_FACT_SQL).toContain(
      'a."workspaceId" = m."workspaceId"',
    );
    expect(DURABLE_INBOUND_FACT_SQL).toContain(
      'candidate."inboundRoutingKey" = p."inboundRoutingKey"',
    );
    expect(DURABLE_INBOUND_FACT_SQL).not.toMatch(
      /LIMIT|SKIP LOCKED|AttentionEffect|AttentionReceipt/,
    );
  });

  it.each([
    'other-runner',
    'other-scope',
    'arbitrary-event-key',
    'other-message',
  ])('refuses private callback misbinding %s before SQL', async (kind) => {
    const fixture = await durableFixture();
    fixture.scenario.steps.splice(0);
    const harness = fixture.start();
    const input = { scope: { ...scope }, event: durableEvent() };
    const snapshot = validateAttentionSnapshot({
      scope,
      status: 'ATTENDED',
      revision: '0',
    });
    if (!snapshot.ok) throw new Error('Invalid test snapshot');
    const context: Parameters<AttentionWriterInput['admit']>[0] = {
      queryRunner: harness.queryRunner,
      input,
      snapshot: snapshot.value,
      consumption: 'NEW',
    };
    if (kind === 'other-runner')
      Object.assign(context, { queryRunner: { ...harness.queryRunner } });
    if (kind === 'other-scope') input.scope.workspaceId = identifier(99);
    if (kind === 'arbitrary-event-key')
      input.event.eventKey = 'force-new-event';
    if (kind === 'other-message') input.event.messageId = identifier(99);
    await expect(
      admitDurableInbound(context, input, harness.input),
    ).resolves.toBeNull();
    harness.done();
  });
});
