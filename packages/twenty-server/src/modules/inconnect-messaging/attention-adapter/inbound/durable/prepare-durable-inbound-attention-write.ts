import { admitDurableInbound } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/admit-durable-inbound';
import { type DurableInboundAttentionInput } from 'src/modules/inconnect-messaging/attention-adapter/inbound/durable/durable-inbound.types';
import { type AttentionWriterError } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/attention-writer.types';
import { prepareAttentionWrite } from 'src/modules/inconnect-messaging/attention-adapter/persistence/writer/prepare-attention-write';

export class DurableInboundAttentionPreparationFailure extends Error {
  readonly callerMustRollback = true;

  constructor(readonly failure: AttentionWriterError) {
    super(failure.code);
  }
}

// Inert private entry: no provider/caller registration. Caller must already hold
// Configuration SHARE -> Conversation UPDATE -> Epoch -> Receipt UPDATE before
// creating Message/attachments, in this exclusive caller-owned transaction.
export const prepareDurableInboundAttentionWrite = async (
  supplied: DurableInboundAttentionInput,
) => {
  const cause = { ...supplied, scope: { ...supplied.scope } };
  const { scope } = cause;
  const input = {
    scope,
    event: {
      kind: 'INBOUND_RECEIVED' as const,
      scope: {
        workspaceId: scope.workspaceId,
        conversationId: scope.conversationId,
        providerConnectionId: scope.providerConnectionId,
      },
      eventKey: JSON.stringify(['whatsapp-inbound-v1', cause.receiptId]),
      messageId: cause.messageId,
    },
  };
  const result = await prepareAttentionWrite({
    queryRunner: cause.queryRunner,
    input,
    causal: {
      webhook: { id: cause.receiptId, leaseToken: cause.leaseToken },
      providerStatusEventId: null,
    },
    admit: (context) => admitDurableInbound(context, input, cause),
  });
  if (!result.ok)
    throw new DurableInboundAttentionPreparationFailure(result.error);
  if (result.value.outcome.kind === 'CONFLICT')
    throw new DurableInboundAttentionPreparationFailure({
      code: 'CAUSAL_OPERATION_REJECTED',
      path: '$.inbound.conflict',
    });
  return result;
};
