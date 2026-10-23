import { type EntityManager } from 'typeorm';

import {
  protectedFixture,
  protectedRequest,
} from './authenticated-ingress.fixtures';
import {
  readReceiptIngressContract,
  READ_RECEIPT_INGRESS_CONTRACT_SQL,
} from 'src/modules/inconnect-messaging/webhook-ingress/read-receipt-ingress-contract';
import { RECEIPT_INGRESS_CONNECTION_SQL } from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

const existingFixture = async () => {
  const fixture = protectedFixture();
  await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
  fixture.state.duplicate = true;
  fixture.query.mockClear();
  fixture.add.mockClear();
  return fixture;
};

describe('retained original receipt and recovery', () => {
  it.each([1, null])(
    'retains duplicate version %s and the original arrival without promotion',
    async (version) => {
      const fixture = await existingFixture();
      fixture.state.original!.ingressContractVersion = version;
      const before = structuredClone(fixture.state.original);
      const request = protectedRequest();
      request.serverReceivedAt = new Date('2026-10-23T12:00:00Z');
      const verified = await fixture.verify(request);
      if (!verified.capability) throw new Error('Missing authentic capability');
      const result = await fixture.service.persistAuthenticatedInbound(
        verified.capability,
      );
      expect(result.admission).toBe(
        version === 1 ? 'DUPLICATE_V1' : 'DUPLICATE_LEGACY',
      );
      expect(fixture.state.original).toEqual(before);
      expect(
        fixture.query.mock.calls.every(([sql]) => !/UPDATE|DELETE/.test(sql)),
      ).toBe(true);
      expect(fixture.add).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves historical PROCESSED rather than claiming a new causal application', async () => {
    const fixture = await existingFixture();
    fixture.rows[0].processingState = 'PROCESSED';
    fixture.state.original!.ingressContractVersion = null;
    const verified = await fixture.verify();
    if (!verified.capability) throw new Error('Missing authentic capability');
    const result = await fixture.service.persistAuthenticatedInbound(
      verified.capability,
    );
    expect(result.admission).toBe('DUPLICATE_LEGACY');
    expect(result.receipt.processingState).toBe('PROCESSED');
    expect(fixture.state.original!.ingressContractVersion).toBeNull();
  });

  it('rejects a hash conflict without overwriting the original or changing identity', async () => {
    const fixture = await existingFixture();
    fixture.state.original!.payloadHash = '0'.repeat(64);
    const original = structuredClone(fixture.state.original);
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
    ).rejects.toMatchObject({ category: 'PAYLOAD_CONFLICT' });
    expect(fixture.state.original).toEqual(original);
    expect(fixture.add).not.toHaveBeenCalled();
  });

  it.each([
    'workspaceId',
    'providerConnectionId',
    'idempotencyKey',
    'eventKind',
    'normalizedMetadata',
    'firstReceivedAt',
  ])('rejects original inconsistency in %s', async (field) => {
    const fixture = await existingFixture();
    fixture.state.original![field] = 'corrupt';
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
    ).rejects.toBeDefined();
    expect(fixture.add).not.toHaveBeenCalled();
  });

  it.each([2, '1', undefined])(
    'refuses unknown or invalid durable version %s',
    async (version) => {
      const fixture = await existingFixture();
      fixture.state.original!.ingressContractVersion = version;
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
      ).rejects.toBeDefined();
      expect(fixture.add).not.toHaveBeenCalled();
    },
  );

  it('recovers only receiptId after a simulated service restart; version survives serialized storage', async () => {
    const fixture = await existingFixture();
    const restored = JSON.parse(JSON.stringify(fixture.state.original));
    const query = jest
      .fn()
      .mockResolvedValue([
        { installed: true, version: restored.ingressContractVersion },
      ]);
    expect(
      await readReceiptIngressContract({ query } as unknown as EntityManager, {
        receiptId: restored.id,
        workspaceId: restored.workspaceId,
        providerConnectionId: restored.providerConnectionId,
      }),
    ).toEqual({ kind: 'SUPPORTED', version: 1 });
    expect(query).toHaveBeenCalledWith(READ_RECEIPT_INGRESS_CONTRACT_SQL, [
      restored.id,
      restored.workspaceId,
      restored.providerConnectionId,
    ]);
    const restarted = fixture.makeService();
    expect(await restarted.recoverPendingReceipts()).toBe(1);
    expect(fixture.add.mock.calls[0]).toEqual([
      'InconnectMessagingWebhookProcessingJob',
      { receiptId: restored.id },
      expect.any(Object),
    ]);
    expect(restored).not.toHaveProperty('rawBody');
    expect(restored).not.toHaveProperty('authToken');
    expect(restored).not.toHaveProperty('signature');
    expect(fixture.external).not.toHaveBeenCalled();
  });

  it('does not claim serialization when a nonparticipating writer revokes after the last SELECT', async () => {
    const fixture = protectedFixture();
    let connectionReads = 0;
    const query = fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (sql, parameters) => {
      const result = await query(sql, parameters);
      if (sql === RECEIPT_INGRESS_CONNECTION_SQL && ++connectionReads === 2)
        fixture.connection.lifecycleStatus = 'DISABLED';
      return result;
    });
    // A second SELECT cannot close this gap; only all writers taking the gate can.
    await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
    expect(fixture.connection.lifecycleStatus).toBe('DISABLED');
    expect(fixture.state.original!.ingressContractVersion).toBe(1);
  });

  it.each([
    [{ installed: false, version: null }, 'PRE_DDL'],
    [{ installed: true, version: null }, 'LEGACY'],
    [{ installed: true, version: 12 }, 'UNKNOWN_VERSION'],
  ])('reads physical version projection %j as %s', async (row, kind) => {
    const query = jest.fn().mockResolvedValue([row]);
    expect(
      (
        await readReceiptIngressContract(
          { query } as unknown as EntityManager,
          {
            receiptId: 'id',
            workspaceId: 'workspace',
            providerConnectionId: 'connection',
          },
        )
      ).kind,
    ).toBe(kind);
  });

  it('never turns SQL errors, absence or partial projection into legacy', async () => {
    for (const rows of [
      [],
      [{ version: null }],
      [{ installed: true }, { installed: true }],
    ]) {
      await expect(
        readReceiptIngressContract(
          {
            query: jest.fn().mockResolvedValue(rows),
          } as unknown as EntityManager,
          {
            receiptId: 'id',
            workspaceId: 'workspace',
            providerConnectionId: 'connection',
          },
        ),
      ).rejects.toThrow();
    }
    await expect(
      readReceiptIngressContract(
        {
          query: jest.fn().mockRejectedValue(new Error('SQL error')),
        } as unknown as EntityManager,
        {
          receiptId: 'id',
          workspaceId: 'workspace',
          providerConnectionId: 'connection',
        },
      ),
    ).rejects.toThrow('SQL error');
  });
});
