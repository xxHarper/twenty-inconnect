import { ForbiddenException } from '@nestjs/common';

import { createHash } from 'node:crypto';

import {
  type InconnectMessagingNormalizedWebhook,
  type InconnectMessagingWebhookRequest,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import {
  TwilioWhatsappMessagingProvider,
  TWILIO_WHATSAPP_PROVIDER_KEY,
} from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { type InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';
import { type InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import {
  INBOUND_INGRESS_CONTRACT_VERSION,
  type InboundIngressPolicy,
} from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';
import { matchesInboundUrlPolicy } from 'src/modules/inconnect-messaging/webhook-ingress/inbound-url-policy';

declare const authenticatedInbound: unique symbol;
export type AuthenticatedInboundCapability = Readonly<{
  [authenticatedInbound]: true;
}>;

export type AuthenticatedInboundSnapshot = Readonly<{
  ingressContractVersion: typeof INBOUND_INGRESS_CONTRACT_VERSION;
  publicOrigin: string;
  effectiveUrl: string;
  workspaceId: string;
  providerConnectionId: string;
  routingKey: string;
  encryptedCredentials: string;
  credentialsVersion: number;
  payloadHash: string;
  firstReceivedAt: string;
  rawBody: string;
  normalizedJson: string;
  idempotencyKey: string;
}>;

const snapshots = new WeakMap<
  AuthenticatedInboundCapability,
  AuthenticatedInboundSnapshot
>();

export type VerifiedTwilioWebhook = {
  connection: InconnectMessagingProviderConnectionEntity;
  normalizedWebhook: InconnectMessagingNormalizedWebhook;
  capability: AuthenticatedInboundCapability | null;
  request: InconnectMessagingWebhookRequest;
};

// No issue(snapshot) operation exists. The only producer performs the complete
// routing, policy, real provider verification and normalization sequence itself.
export const verifyTwilioWebhook = async (
  supplied: InconnectMessagingWebhookRequest,
  providerRegistry: InconnectMessagingProviderRegistry,
  routing: InconnectMessagingProviderConnectionRoutingService,
  policy?: InboundIngressPolicy,
): Promise<VerifiedTwilioWebhook> => {
  const request = {
    ...supplied,
    parameters: Object.fromEntries(
      Object.entries(supplied.parameters).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
    ingressTransport: supplied.ingressTransport && {
      ...supplied.ingressTransport,
    },
    serverReceivedAt: new Date(supplied.serverReceivedAt.getTime()),
  };
  const capturedPolicy = policy && { ...policy };
  const provider = providerRegistry.resolve(TWILIO_WHATSAPP_PROVIDER_KEY);
  const { connection, credentials } = await routing.resolveEnabledConnection({
    providerKey: provider.key,
    routingHints: provider.getWebhookRoutingHints(request),
  });
  const eligible =
    provider instanceof TwilioWhatsappMessagingProvider &&
    capturedPolicy !== undefined &&
    matchesInboundUrlPolicy(request, capturedPolicy);
  if (!provider.validateWebhookSignature({ credentials, request }))
    throw new ForbiddenException('Invalid Twilio webhook signature');
  const payloadHash = createHash('sha256')
    .update(request.rawBody, 'utf8')
    .digest('hex');
  const normalizedWebhook = provider.normalizeWebhook({ request, payloadHash });
  let capability: AuthenticatedInboundCapability | null = null;
  if (
    eligible &&
    capturedPolicy !== undefined &&
    normalizedWebhook.kind === 'INBOUND_MESSAGE' &&
    connection.provider === 'TWILIO' &&
    connection.channel === 'WHATSAPP' &&
    connection.lifecycleStatus === 'ENABLED' &&
    connection.inboundRoutingKey === request.routingKey &&
    connection.encryptedCredentials !== null &&
    Number.isSafeInteger(connection.credentialsVersion) &&
    connection.credentialsVersion !== null &&
    connection.credentialsVersion > 0
  ) {
    capability = Object.freeze({}) as AuthenticatedInboundCapability;
    snapshots.set(
      capability,
      Object.freeze({
        ingressContractVersion: INBOUND_INGRESS_CONTRACT_VERSION,
        publicOrigin: capturedPolicy.publicOrigin,
        effectiveUrl: request.effectiveUrl,
        workspaceId: connection.workspaceId,
        providerConnectionId: connection.id,
        routingKey: connection.inboundRoutingKey,
        encryptedCredentials: connection.encryptedCredentials,
        credentialsVersion: connection.credentialsVersion,
        payloadHash,
        firstReceivedAt: request.serverReceivedAt.toISOString(),
        rawBody: request.rawBody,
        normalizedJson: JSON.stringify(normalizedWebhook),
        idempotencyKey: normalizedWebhook.idempotencyKey,
      }),
    );
  }
  return { connection, normalizedWebhook, capability, request };
};

// The consumer supplies no substitute fact or scope. Snapshot values are strings,
// not mutable Dates/objects; neither the returned normalizer output nor caller
// request can change this authorization after issue.
export const consumeAuthenticatedInbound = (
  capability: AuthenticatedInboundCapability,
): AuthenticatedInboundSnapshot => {
  const snapshot = snapshots.get(capability);
  if (!snapshot) throw new ForbiddenException('Unknown inbound capability');
  snapshots.delete(capability);
  return snapshot;
};
