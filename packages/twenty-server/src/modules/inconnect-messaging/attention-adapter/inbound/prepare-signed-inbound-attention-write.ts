import { type QueryRunner } from 'typeorm';

import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type AttentionTrackingScope } from 'src/modules/inconnect-messaging/attention-adapter/attention-adapter.types';
import { admitSignedInbound } from 'src/modules/inconnect-messaging/attention-adapter/inbound/admit-signed-inbound';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';
import { type AttentionWriterError } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';

export class InboundAttentionPreparationFailure extends Error {
  readonly callerMustRollback = true;

  constructor(readonly failure: AttentionWriterError) {
    super(failure.code);
  }
}

// Inert: no Nest registration or operational caller. The caller MUST have taken
// Configuration -> Conversation -> Receipt before inserting the causal Message
// in this same unit. Reacquiring locks in the writer cannot repair an inversion.
// This does not finalize Receipt, create the inbound Outbox, or commit anything.
export const prepareSignedInboundAttentionWrite = async ({
  queryRunner,
  scope,
  messageId,
  webhook,
  request,
  providerRegistry,
  secretEncryptionService,
}: {
  queryRunner: QueryRunner;
  scope: AttentionTrackingScope;
  messageId: string;
  webhook: Readonly<{ id: string; leaseToken: string }>;
  request: InconnectMessagingWebhookRequest;
  providerRegistry: InconnectMessagingProviderRegistry;
  secretEncryptionService: SecretEncryptionService;
}) => {
  const capturedRequest = {
    ...request,
    serverReceivedAt: new Date(request.serverReceivedAt.getTime()),
    parameters: Object.fromEntries(
      Object.entries(request.parameters).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
  };
  const capturedWebhook = { ...webhook };
  const capturedScope = { ...scope };
  const input = {
    scope: capturedScope,
    event: {
      kind: 'INBOUND_RECEIVED' as const,
      scope: {
        workspaceId: scope.workspaceId,
        conversationId: scope.conversationId,
        providerConnectionId: scope.providerConnectionId,
      },
      eventKey: JSON.stringify(['whatsapp-inbound-v1', capturedWebhook.id]),
      messageId,
    },
  };
  const result = await prepareAttentionWrite({
    queryRunner,
    input,
    causal: { webhook: capturedWebhook, providerStatusEventId: null },
    admit: (context) =>
      context.queryRunner !== queryRunner
        ? Promise.resolve(null)
        : admitSignedInbound({
            context,
            expected: input,
            request: capturedRequest,
            webhook: capturedWebhook,
            providerRegistry,
            secretEncryptionService,
          }),
  });
  if (!result.ok) throw new InboundAttentionPreparationFailure(result.error);
  if (result.value.outcome.kind === 'CONFLICT')
    throw new InboundAttentionPreparationFailure({
      code: 'CAUSAL_OPERATION_REJECTED',
      path: '$.inbound.conflict',
    });
  return result;
};
