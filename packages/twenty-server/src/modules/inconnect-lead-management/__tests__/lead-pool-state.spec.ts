import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import {
  parsePoolInput,
  storedPoolSchema,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-contract';
import {
  actor,
  makePoolHarness,
  poolId,
  poolInput,
} from './lead-pool.fixtures';

it.each(['missing', 'duplicate', 'wrong recipient', 'wrong version'])(
  'rejects corrupt durable state: %s',
  async (change) => {
    const harness = makePoolHarness(2);
    await harness.service.preview(actor, poolInput(2));
    const state = structuredClone([...harness.operations().values()][0].state);
    if (change === 'missing') state.items.pop();
    if (change === 'duplicate') state.items[1] = { ...state.items[0] };
    if (change === 'wrong recipient') state.items[0].recipientId = poolId(999);
    if (change === 'wrong version') state.version++;
    expect(() => parsePoolInput(storedPoolSchema, state)).toThrow();
  },
);
it('requires installed nondeferred identity uniqueness before advertising storage readiness', async () => {
  const query = jest
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ valid: false }]);
  const store = new LeadPoolStoreService({ query } as never, {} as never);
  expect(await store.ready()).toBe(false);
  expect(query.mock.calls[1][0]).toContain('constraint_row.condeferrable');
  expect(query.mock.calls[0][0]).toContain('"intentionId"');
});
it('rejects expired previews without transferring owners', async () => {
  const harness = makePoolHarness(1);
  const preview = await harness.service.preview(actor, poolInput(1));
  harness.operations().get(preview.id)!.state.expiresAt =
    '2000-01-01T00:00:00.000Z';
  await expect(
    harness.service.execute(actor, {
      operationId: preview.id,
      expectedVersion: 0,
    }),
  ).rejects.toThrow('expired');
  expect(harness.writes()).toBe(0);
});
