import { type DataSource, type EntityManager, type Repository } from 'typeorm';

import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import {
  receiptOriginFixture,
  originRequest,
  ORIGIN_TEST_TOKEN,
} from 'src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin.fixtures';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { InconnectMessagingWebhookIngressService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-ingress.service';
import { InconnectMessagingWebhookReceiptService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';
import { type InboundIngressPolicy } from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';
import {
  verifyTwilioWebhook,
  type VerifiedTwilioWebhook,
} from 'src/modules/inconnect-messaging/webhook-ingress/authenticated-inbound';
import {
  RECEIPT_INGRESS_SCHEMA_SQL,
  RECEIPT_INGRESS_GATE_SQL,
  RECEIPT_INGRESS_CONNECTION_SQL,
  RECEIPT_INGRESS_INSERT_SQL,
  RECEIPT_INGRESS_ORIGINAL_SQL,
} from 'src/modules/inconnect-messaging/webhook-ingress/persist-authenticated-receipt';

export const policy: InboundIngressPolicy = {
  mode: 'DIRECT_TLS_V1',
  publicOrigin: 'https://crm.example.test',
};
export const protectedRequest = () => {
  const request = originRequest();
  request.ingressTransport = {
    directTls: true,
    hasForwardedHeaders: false,
    validUtf8: true,
    host: 'crm.example.test',
    requestTarget: new URL(request.effectiveUrl).pathname,
  };
  return request;
};

// Scripted persistence I/O, not a database model. Verifier, routing, normalizer,
// capability, ingress and persister execute their real code. No network ports.
export const protectedFixture = () => {
  const legacy = receiptOriginFixture();
  legacy.connection.credentialsVersion = 1;
  const registry = new InconnectMessagingProviderRegistry();
  registry.register(legacy.provider);
  const routing = new InconnectMessagingProviderConnectionRoutingService(
    {
      find: legacy.findConnections,
    } as unknown as Repository<InconnectMessagingProviderConnectionEntity>,
    {
      decryptVersionedOrThrow: legacy.decrypt,
    } as unknown as SecretEncryptionService,
  );
  const state = {
    installed: true,
    compatible: true,
    mode: 'DISABLED',
    duplicate: false,
    version: 1 as unknown,
    fail: '',
    commitError: false,
    committed: false,
    original: null as Record<string, unknown> | null,
    connectionPresent: true,
  };
  const query = jest.fn(
    async (sql: string, parameters?: unknown[]): Promise<unknown> => {
      if (state.fail === sql) throw new Error('SQL unavailable');
      if (sql === RECEIPT_INGRESS_SCHEMA_SQL)
        return [{ installed: state.installed, compatible: state.compatible }];
      if (sql === RECEIPT_INGRESS_GATE_SQL) return [{ mode: state.mode }];
      if (sql === RECEIPT_INGRESS_CONNECTION_SQL) {
        expect(parameters?.slice(0, 3)).toEqual([
          legacy.connection.workspaceId,
          legacy.connection.id,
          'route-1',
        ]);
        return state.connectionPresent &&
          legacy.connection.lifecycleStatus === 'ENABLED' &&
          parameters?.[3] === legacy.connection.encryptedCredentials &&
          parameters?.[4] === legacy.connection.credentialsVersion
          ? [{ id: legacy.connection.id }]
          : [];
      }
      if (sql === RECEIPT_INGRESS_INSERT_SQL) {
        if (!state.original) {
          state.original = {
            id: '00000000-0000-0000-0000-000000000027',
            workspaceId: parameters?.[0],
            providerConnectionId: parameters?.[1],
            eventKind: 'INBOUND_MESSAGE',
            idempotencyKey: parameters?.[2],
            payloadHash: parameters?.[3],
            firstReceivedAt: parameters?.[4],
            normalizedMetadata: JSON.parse(String(parameters?.[5])),
            ingressContractVersion: state.version,
          };
        }
        if (!legacy.rows.length)
          legacy.rows.push(
            Object.assign(
              new InconnectMessagingWebhookReceiptEntity(),
              state.original,
              {
                firstReceivedAt: new Date(
                  String(state.original.firstReceivedAt),
                ),
                processingState: 'RECEIVED',
              },
            ),
          );
        return state.duplicate ? [] : [{ id: state.original.id }];
      }
      if (sql === RECEIPT_INGRESS_ORIGINAL_SQL)
        return state.original ? [state.original] : [];
      throw new Error('Unexpected SQL');
    },
  );
  const manager = {
    query,
    getRepository: () => legacy.repository,
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolationOrCallback: unknown,
      callback?: (manager: EntityManager) => Promise<unknown>,
    ) => {
      const operation =
        typeof isolationOrCallback === 'function'
          ? (isolationOrCallback as (
              manager: EntityManager,
            ) => Promise<unknown>)
          : callback;
      if (!operation) throw new Error('Missing operation');
      const result = await operation(manager);
      if (state.commitError) throw new Error('Commit outcome unconfirmed');
      state.committed = true;
      return result;
    },
  );
  const add = jest.fn(async () => {
    expect(state.committed).toBe(true);
  });
  const makeService = () =>
    new InconnectMessagingWebhookReceiptService(
      { transaction } as unknown as DataSource,
      legacy.repository as unknown as Repository<InconnectMessagingWebhookReceiptEntity>,
      { add } as unknown as MessageQueueService,
    );
  const service = makeService();
  const ingress = new InconnectMessagingWebhookIngressService(
    registry,
    routing,
    service,
    policy,
  );
  const verify = (
    request = protectedRequest(),
  ): Promise<VerifiedTwilioWebhook> =>
    verifyTwilioWebhook(request, registry, routing, policy);
  return {
    ...legacy,
    registry,
    routing,
    state,
    query,
    transaction,
    add,
    service,
    ingress,
    verify,
    makeService,
    manager,
    rotate: () => {
      legacy.connection.credentialsVersion = 2;
      legacy.decrypt.mockReturnValue(
        JSON.stringify({ authToken: ORIGIN_TEST_TOKEN + '-rotated' }),
      );
    },
  };
};
