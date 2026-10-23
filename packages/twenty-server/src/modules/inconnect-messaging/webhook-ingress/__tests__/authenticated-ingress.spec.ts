import {
  consumeAuthenticatedInbound,
  type AuthenticatedInboundCapability,
} from 'src/modules/inconnect-messaging/webhook-ingress/authenticated-inbound';
import { signOriginRequest } from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin.fixtures';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { decodeReceiptIngressContract } from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';
import {
  RECEIPT_INGRESS_INSERT_SQL,
  RECEIPT_INGRESS_ORIGINAL_SQL,
  RECEIPT_INGRESS_CONNECTION_SQL,
  RECEIPT_INGRESS_GATE_SQL,
  RECEIPT_INGRESS_SCHEMA_SQL,
} from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';
import {
  protectedFixture,
  protectedRequest,
  policy,
} from './authenticated-ingress.fixtures';

const requireCapability = (
  capability: AuthenticatedInboundCapability | null,
) => {
  if (!capability)
    throw new Error('Real authentication did not issue capability');
  return capability;
};

describe('T1 authenticated receipt issuance', () => {
  it('persists a signed Unicode inbound through real ingress and commits before enqueue', async () => {
    const fixture = protectedFixture();
    await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
    expect(fixture.state.original).toMatchObject({
      ingressContractVersion: 1,
      normalizedMetadata: { body: 'Hola 👋 café 漢字' },
    });
    expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
      RECEIPT_INGRESS_SCHEMA_SQL,
      RECEIPT_INGRESS_GATE_SQL,
      RECEIPT_INGRESS_CONNECTION_SQL,
      RECEIPT_INGRESS_INSERT_SQL,
      RECEIPT_INGRESS_ORIGINAL_SQL,
      RECEIPT_INGRESS_CONNECTION_SQL,
    ]);
    expect(fixture.add).toHaveBeenCalledTimes(1);
    expect(fixture.external).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'other-connection-token'])(
    'rejects signature %s without persisting',
    async (token) => {
      const fixture = protectedFixture();
      const request = signOriginRequest(protectedRequest(), token);
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook(request),
      ).rejects.toMatchObject({ status: 403 });
      expect(fixture.query).not.toHaveBeenCalled();
      expect(fixture.builder.values).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'origin',
      (request: ReturnType<typeof protectedRequest>) => {
        request.effectiveUrl = request.effectiveUrl.replace(
          'crm.example.test',
          'other.example.test',
        );
      },
    ],
    [
      'port',
      (request: ReturnType<typeof protectedRequest>) => {
        request.effectiveUrl = request.effectiveUrl.replace(
          '.test/',
          '.test:8443/',
        );
      },
    ],
    [
      'path',
      (request: ReturnType<typeof protectedRequest>) => {
        request.effectiveUrl = request.effectiveUrl.replace(
          'route-1/',
          'route-2/',
        );
      },
    ],
    [
      'query',
      (request: ReturnType<typeof protectedRequest>) => {
        request.effectiveUrl += '?a=1';
      },
    ],
    [
      'duplicate equal',
      (request: ReturnType<typeof protectedRequest>) => {
        request.rawBody += '&%42ody=Hola';
      },
    ],
    [
      'duplicate unknown',
      (request: ReturnType<typeof protectedRequest>) => {
        request.rawBody += '&New=x&%4Eew=x';
      },
    ],
    [
      'invalid UTF8',
      (request: ReturnType<typeof protectedRequest>) => {
        request.rawBody += '&New=%C3%28';
      },
    ],
    [
      'invalid percent',
      (request: ReturnType<typeof protectedRequest>) => {
        request.rawBody += '&New=%GG';
      },
    ],
    [
      'raw bytes invalid',
      (request: ReturnType<typeof protectedRequest>) => {
        request.ingressTransport = {
          ...request.ingressTransport!,
          validUtf8: false,
        };
      },
    ],
    [
      'forwarded',
      (request: ReturnType<typeof protectedRequest>) => {
        request.ingressTransport = {
          ...request.ingressTransport!,
          hasForwardedHeaders: true,
        };
      },
    ],
    [
      'plain HTTP peer',
      (request: ReturnType<typeof protectedRequest>) => {
        request.ingressTransport = {
          ...request.ingressTransport!,
          directTls: false,
        };
      },
    ],
    [
      'wrong Host',
      (request: ReturnType<typeof protectedRequest>) => {
        request.ingressTransport = {
          ...request.ingressTransport!,
          host: 'other.example.test',
        };
      },
    ],
    [
      'rewritten target',
      (request: ReturnType<typeof protectedRequest>) => {
        request.ingressTransport = {
          ...request.ingressTransport!,
          requestTarget: request.ingressTransport!.requestTarget + '/',
        };
      },
    ],
    [
      'nested form',
      (request: ReturnType<typeof protectedRequest>) => {
        request.rawBody += '&Body[x]=v';
      },
    ],
  ])(
    'keeps validly signed but ineligible %s on the unaccredited path',
    async (_name, change) => {
      const fixture = protectedFixture();
      const request = protectedRequest();
      change(request);
      signOriginRequest(request);
      const verified = await fixture.verify(request);
      expect(verified.capability).toBeNull();
      await fixture.ingress.acceptTwilioWhatsappWebhook(request);
      expect(fixture.query).not.toHaveBeenCalled();
      expect(fixture.builder.values.mock.calls[0][0]).not.toHaveProperty(
        'ingressContractVersion',
      );
    },
  );

  it('includes unknown scalar fields in the real signature verification', async () => {
    const fixture = protectedFixture();
    const request = protectedRequest();
    request.parameters.NewField = 'mañana';
    request.rawBody += '&NewField=ma%C3%B1ana';
    expect(
      (await fixture.verify(signOriginRequest(request))).capability,
    ).not.toBeNull();
    request.parameters.NewField = 'changed';
    request.rawBody = request.rawBody.replace('ma%C3%B1ana', 'changed');
    await expect(fixture.verify(request)).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each([
    {},
    { trusted: true },
    { authenticated: true },
    { workspaceId: 'other' },
  ])('refuses fabricated capability %j', async (fake) => {
    const fixture = protectedFixture();
    await expect(
      fixture.service.persistAuthenticatedInbound(
        fake as AuthenticatedInboundCapability,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it('binds the authorized scope and immutable snapshot, not the returned mutable data', async () => {
    const fixture = protectedFixture();
    const request = protectedRequest();
    const verified = await fixture.verify(request);
    const capability = requireCapability(verified.capability);
    request.parameters.Body = 'changed';
    request.rawBody = 'changed';
    request.serverReceivedAt.setFullYear(2000);
    verified.normalizedWebhook.idempotencyKey = 'changed';
    verified.connection.workspaceId = 'other-scope';
    const snapshot = consumeAuthenticatedInbound(capability);
    expect(JSON.parse(snapshot.normalizedJson).body).toBe('Hola 👋 café 漢字');
    expect(snapshot.workspaceId).not.toBe('other-scope');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => consumeAuthenticatedInbound(capability)).toThrow(
      'Unknown inbound capability',
    );
    expect(() => consumeAuthenticatedInbound({ ...capability })).toThrow();
  });

  it('never issues from the legacy persister even with an extra authority argument', async () => {
    const fixture = protectedFixture();
    const verified = await fixture.verify();
    await fixture.service.persistAndRequestProcessing({
      workspaceId: fixture.connection.workspaceId,
      providerConnectionId: fixture.connection.id,
      normalizedWebhook: verified.normalizedWebhook,
      rawBody: verified.request.rawBody,
      firstReceivedAt: verified.request.serverReceivedAt,
      ...{ ingressContractVersion: 1, trusted: true },
    });
    expect(fixture.builder.values.mock.calls[0][0]).not.toHaveProperty(
      'ingressContractVersion',
    );
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it('is dormant without a backend policy registration', async () => {
    const fixture = protectedFixture();
    const ingress = new InconnectMessagingWebhookIngressService(
      fixture.registry,
      fixture.routing,
      fixture.service,
    );
    await ingress.acceptTwilioWhatsappWebhook(protectedRequest());
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it('does not claim authority for unsupported or status webhooks', async () => {
    const fixture = protectedFixture();
    const unsupported = protectedRequest();
    delete unsupported.parameters.From;
    unsupported.rawBody = new URLSearchParams(
      unsupported.parameters as Record<string, string>,
    ).toString();
    expect(
      (await fixture.verify(signOriginRequest(unsupported))).capability,
    ).toBeNull();
    const status = protectedRequest();
    status.kind = 'STATUS_CALLBACK';
    expect(
      (await fixture.verify(signOriginRequest(status))).capability,
    ).toBeNull();
  });

  it('rejects partially installed incompatible schema instead of legacy fallback', async () => {
    const fixture = protectedFixture();
    fixture.state.compatible = false;
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
    ).rejects.toBeDefined();
    expect(fixture.builder.values).not.toHaveBeenCalled();
    expect(fixture.add).not.toHaveBeenCalled();
  });

  it('continues pre-DDL via legacy SQL with no reference to a new column', async () => {
    const fixture = protectedFixture();
    fixture.state.installed = false;
    await fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest());
    expect(fixture.query.mock.calls).toEqual([[RECEIPT_INGRESS_SCHEMA_SQL]]);
    expect(fixture.builder.values.mock.calls[0][0]).not.toHaveProperty(
      'ingressContractVersion',
    );
    expect(fixture.add).toHaveBeenCalledTimes(1);
  });

  it.each(['PREPARING', 'SUSPENDED', 'ENABLED', 'UNKNOWN'])(
    'rejects %s before receipt INSERT without fallback',
    async (mode) => {
      const fixture = protectedFixture();
      fixture.state.mode = mode;
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
      ).rejects.toBeDefined();
      expect(fixture.query).not.toHaveBeenCalledWith(
        RECEIPT_INGRESS_INSERT_SQL,
        expect.anything(),
      );
      expect(fixture.builder.values).not.toHaveBeenCalled();
      expect(fixture.add).not.toHaveBeenCalled();
    },
  );

  it.each([
    RECEIPT_INGRESS_SCHEMA_SQL,
    RECEIPT_INGRESS_INSERT_SQL,
    RECEIPT_INGRESS_ORIGINAL_SQL,
  ])(
    'propagates SQL failure without enqueue or legacy fallback',
    async (sql) => {
      const fixture = protectedFixture();
      fixture.state.fail = sql;
      await expect(
        fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
      ).rejects.toThrow('SQL unavailable');
      expect(fixture.add).not.toHaveBeenCalled();
      expect(fixture.builder.values).not.toHaveBeenCalled();
    },
  );

  it('does not enqueue when transaction commit is unconfirmed', async () => {
    const fixture = protectedFixture();
    fixture.state.commitError = true;
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
    ).rejects.toThrow('Commit outcome unconfirmed');
    expect(fixture.add).not.toHaveBeenCalled();
  });

  it('denies disabled routing before issuing a capability', async () => {
    const fixture = protectedFixture();
    fixture.connection.lifecycleStatus = 'DISABLED';
    await expect(fixture.verify()).rejects.toMatchObject({
      category: 'CONNECTION_DISABLED',
    });
  });

  it('rejects credential rotation between capability issue and persistence', async () => {
    const fixture = protectedFixture();
    const verified = await fixture.verify();
    fixture.rotate();
    await expect(
      fixture.service.persistAuthenticatedInbound(
        requireCapability(verified.capability),
      ),
    ).rejects.toBeDefined();
    expect(fixture.add).not.toHaveBeenCalled();
    await expect(fixture.verify()).rejects.toMatchObject({ status: 403 });
  });

  it('detects visible revocation after INSERT, while not claiming commit serialization', async () => {
    const fixture = protectedFixture();
    const originalQuery = fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (sql, parameters) => {
      const result = await originalQuery(sql, parameters);
      if (sql === RECEIPT_INGRESS_INSERT_SQL)
        fixture.connection.lifecycleStatus = 'DISABLED';
      return result;
    });
    await expect(
      fixture.ingress.acceptTwilioWhatsappWebhook(protectedRequest()),
    ).rejects.toBeDefined();
    expect(fixture.add).not.toHaveBeenCalled();
  });

  it.each([
    [false, undefined, 'PRE_DDL'],
    [false, 1, 'INVALID'],
    [true, null, 'LEGACY'],
    [true, 1, 'SUPPORTED'],
    [true, 2, 'UNKNOWN_VERSION'],
    [true, '1', 'INVALID'],
    [true, undefined, 'INVALID'],
    [true, true, 'INVALID'],
    [true, 0, 'INVALID'],
  ])(
    'decodes installed=%s value=%s strictly as %s',
    (installed, value, kind) => {
      expect(
        decodeReceiptIngressContract(installed as boolean, value).kind,
      ).toBe(kind);
    },
  );

  it('does not accept a noncanonical configured origin or infer SERVER_URL', async () => {
    const fixture = protectedFixture();
    const { verifyTwilioWebhook } =
      await import('src/modules/inconnect-messaging/webhook-ingress/authenticated-inbound');
    for (const publicOrigin of [
      'http://crm.example.test',
      policy.publicOrigin + '/',
      policy.publicOrigin + ':443',
      'https://crm.example.test@evil.test',
    ]) {
      expect(
        (
          await verifyTwilioWebhook(
            protectedRequest(),
            fixture.registry,
            fixture.routing,
            { ...policy, publicOrigin },
          )
        ).capability,
      ).toBeNull();
    }
  });
});
